import { after } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { conversations, messages } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { searchKnowledge } from "@/lib/kb";
import { ENRICH_EVERY_N_MESSAGES, ENRICH_MIN_MESSAGES } from "@/lib/enrich";
import { getAgent } from "@/lib/agents";
import {
  buildSystemPrompt,
  buildTurnBrandContext,
  CHAT_FINAL_TURN_RESERVE_MS,
  CHAT_MAX_TOKENS,
  CHAT_MIN_IMAGE_WINDOW_MS,
  CHAT_SAFETY_MARGIN_MS,
  CHAT_TOOLS,
  chatModel,
  FINAL_TURN_INSTRUCTION,
  formatExamplesSection,
  formatKbSection,
  resolveTurnRouting,
} from "@/lib/chat-prompt";
import { enrichConversation } from "@/lib/enrich";
import { getSession } from "@/lib/auth";
import {
  canWriteConversation,
  defaultVisibilityForRole,
  resourceAccessSql,
} from "@/lib/permissions";
import { generateImage, IMAGE_ASPECT_RATIOS, IMAGE_TIMEOUT_MS, type ImageAspectRatio } from "@/lib/image-gen";
import { readBlobBytes } from "@/lib/blob-store";
import { matchesSignature, sniffImageType } from "@/lib/upload-policy";
import {
  CHAT_MAX_IMAGES_PER_RUN,
  CHAT_MAX_MESSAGE_CHARS,
  consumeBudgets,
  rateLimitResponse,
} from "@/lib/rate-limit";

// Attachment bytes sent to the model (provider base64 limits)
const ATTACHMENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const ATTACHMENT_PDF_MAX_BYTES = 20 * 1024 * 1024;
const ATTACHMENT_TEXT_MAX_BYTES = 1024 * 1024;

// Private blobs are read through the SDK from our own store only (never a
// fetch of a stored URL), with a byte cap and a timeout
async function readAttachmentBytes(blobUrl: string, maxBytes: number) {
  try {
    return await readBlobBytes(blobUrl, { maxBytes, timeoutMs: 10000 });
  } catch (e) {
    console.error("Attachment read failed:", e instanceof Error ? e.name : e);
    return null;
  }
}

// Function ceiling. 300s REQUIRES Vercel Fluid compute on the project (without
// it Hobby caps at 60s). Must stay a literal for Next.js static analysis and
// must equal CHAT_MAX_DURATION_S in lib/chat-prompt.ts (checked in checks/).
export const maxDuration = 300;

// Keep headroom for persistence and the final model turn (lib/chat-prompt.ts)
const SAFETY_MARGIN_MS = CHAT_SAFETY_MARGIN_MS;
const FINAL_TURN_RESERVE_MS = CHAT_FINAL_TURN_RESERVE_MS;
const MIN_IMAGE_WINDOW_MS = CHAT_MIN_IMAGE_WINDOW_MS;
const MAX_TOOL_TURNS = 4;

const INCOMPLETE_NOTES: Record<string, string> = {
  max_tokens: "This response hit its length limit before it finished. Ask me to continue and I will pick up where it stopped.",
  refusal: "I could not complete this response.",
  time: "This response ran out of time before it finished. Ask me to continue and I will pick up where it stopped.",
  tool_limit: "I ran out of steps before finishing this response. Ask me to continue and I will pick up where it stopped.",
  error: "Something went wrong before this response finished. Ask me to continue, or try again.",
};

export async function POST(request: Request) {
  const startedAt = Date.now();
  const deadline = startedAt + maxDuration * 1000 - SAFETY_MARGIN_MS;
  const timeLeft = () => deadline - Date.now();

  try {
    const session = await getSession();

    if (!session) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = await request.json();
    const { message, conversationId } = body as {
      message: string;
      agentId?: string;
      conversationId?: string;
      attachments?: {
        resourceId: string;
        fileName: string;
        mimeType: string;
      }[];
    };

    // Validate attachments: only resources the requester actually owns can be
    // attached (client sends ids, never trust them)
    let attachments: { resourceId: string; fileName: string; mimeType: string; blobUrl: string | null; textContent: string | null }[] = [];
    if (Array.isArray(body.attachments) && body.attachments.length > 0) {
      const ids = body.attachments
        .slice(0, 4)
        .map((a: { resourceId: string }) => a.resourceId)
        .filter((id: string) => /^[0-9a-f-]{36}$/.test(id));
      if (ids.length > 0) {
        const rows = await db.execute(sql`
          SELECT id, file_name, mime_type, blob_url, text_content
          FROM resources
          WHERE owner_id = ${session.userId}
            AND id = ANY(ARRAY[${sql.join(ids.map((id: string) => sql`${id}::uuid`), sql`, `)}])
        `);
        attachments = (rows.rows as unknown as {
          id: string;
          file_name: string | null;
          mime_type: string | null;
          blob_url: string | null;
          text_content: string | null;
        }[]).map((r) => ({
          resourceId: r.id,
          fileName: r.file_name || "file",
          mimeType: r.mime_type || "application/octet-stream",
          blobUrl: r.blob_url,
          textContent: r.text_content,
        }));
      }
    }

    // Accept agentId for backward compat but default to "gratitude"
    const agentId = body.agentId || "gratitude";

    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ error: "Missing message" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const maxChars = CHAT_MAX_MESSAGE_CHARS();
    if (message.length > maxChars) {
      return new Response(
        JSON.stringify({
          error: `Message is too long. Please keep it under ${maxChars.toLocaleString()} characters.`,
          code: "message_too_long",
        }),
        { status: 413, headers: { "Content-Type": "application/json" } }
      );
    }

    // Per-user budget, enforced before any model call
    const chatLimited = await consumeBudgets(session.userId, ["chat_hour", "chat_day"]);
    if (chatLimited) return rateLimitResponse(chatLimited);

    // For the unified "gratitude" agent, use orchestrator as the base
    const resolvedAgentId = agentId === "gratitude" ? "orchestrator" : agentId;
    const agent = getAgent(resolvedAgentId);
    if (!agent) {
      return new Response(JSON.stringify({ error: "Agent not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Create or load conversation
    let convId = conversationId;
    if (!convId) {
      const title = message.slice(0, 100) + (message.length > 100 ? "..." : "");
      const [conv] = await db
        .insert(conversations)
        .values({
          ownerId: session.userId,
          agentId,
          title,
          visibility: defaultVisibilityForRole(session),
        })
        .returning();
      convId = conv.id;
    } else {
      const [conv] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, convId))
        .limit(1);

      if (!conv) {
        return new Response(JSON.stringify({ error: "Conversation not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Write check: appending a message mutates the conversation, so this is
      // stricter than the view permission used elsewhere
      if (!canWriteConversation(session, conv)) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Save user message (attachment links appended so history and the UI
    // render them - images inline, other files as download links)
    const attachmentNote =
      attachments.length > 0
        ? "\n\n" +
          attachments
            .map((a) =>
              a.mimeType.startsWith("image/")
                ? `![${a.fileName}](/api/resources/${a.resourceId}/download?inline=1)`
                : `[Attached: ${a.fileName}](/api/resources/${a.resourceId}/download)`
            )
            .join("\n")
        : "";

    await db.insert(messages).values({
      conversationId: convId,
      role: "user",
      content: message + attachmentNote,
    });

    // Load conversation history - most recent messages only, so long
    // conversations don't grow the context (and the bill) without bound
    const HISTORY_LIMIT = 40;
    const history = (
      await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, convId))
        .orderBy(desc(messages.createdAt))
        .limit(HISTORY_LIMIT)
    ).reverse();

    const apiMessages: Anthropic.Messages.MessageParam[] = history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // Attachments become native model input for THIS turn: images and PDFs as
    // base64 blocks read from private storage (bytes must match the type),
    // small text files inlined. Earlier turns keep markdown links only.
    if (attachments.length > 0 && apiMessages.length > 0) {
      const last = apiMessages[apiMessages.length - 1];
      const blocks: Anthropic.Messages.ContentBlockParam[] = [
        { type: "text", text: typeof last.content === "string" ? last.content : message },
      ];
      const unreadable = (fileName: string): Anthropic.Messages.ContentBlockParam => ({
        type: "text",
        text: `\n\n[The user attached "${fileName}" but its contents could not be read.]`,
      });
      for (const a of attachments) {
        if (a.mimeType.startsWith("image/") && a.mimeType !== "image/svg+xml" && a.blobUrl) {
          const bytes = await readAttachmentBytes(a.blobUrl, ATTACHMENT_IMAGE_MAX_BYTES);
          const mediaType = bytes ? sniffImageType(bytes) : null;
          blocks.push(
            bytes && mediaType
              ? {
                  type: "image",
                  source: { type: "base64", media_type: mediaType, data: Buffer.from(bytes).toString("base64") },
                }
              : unreadable(a.fileName)
          );
        } else if (a.mimeType === "application/pdf" && a.blobUrl) {
          const bytes = await readAttachmentBytes(a.blobUrl, ATTACHMENT_PDF_MAX_BYTES);
          blocks.push(
            bytes && matchesSignature("pdf", bytes)
              ? {
                  type: "document",
                  source: { type: "base64", media_type: "application/pdf", data: Buffer.from(bytes).toString("base64") },
                }
              : unreadable(a.fileName)
          );
        } else if (
          a.mimeType.startsWith("text/") ||
          /\.(md|csv|txt)$/i.test(a.fileName)
        ) {
          let text = a.textContent;
          if (!text && a.blobUrl) {
            const bytes = await readAttachmentBytes(a.blobUrl, ATTACHMENT_TEXT_MAX_BYTES);
            if (bytes && matchesSignature("text", bytes.subarray(0, 512))) {
              text = new TextDecoder().decode(bytes);
            }
          }
          blocks.push({
            type: "text",
            text: text
              ? `\n\n[Contents of attached file "${a.fileName}"]:\n${text.slice(0, 50000)}`
              : `\n\n[The user attached "${a.fileName}" but its contents could not be read.]`,
          });
        } else {
          blocks.push({
            type: "text",
            text: `\n\n[The user attached "${a.fileName}" (${a.mimeType}). This file type cannot be read directly yet - acknowledge the attachment and work from the user's description of it.]`,
          });
        }
      }
      last.content = blocks;
    }

    // Classify the request: artifact type (presentation) and audience
    // (investor) are independent of which writing specialist applies, and
    // both are honored for every agent, not only the unified one.
    // (Pure assembly lives in lib/chat-prompt.ts so evals build the same prompt.)
    const plainHistory = history.map((m) => ({ role: m.role, content: m.content }));
    const routing = resolveTurnRouting(agentId, plainHistory);
    const { detectedDomain, specialistBody } = routing;

    // Build system prompt
    const brandContext = buildTurnBrandContext(routing);

    // Semantic KB retrieval: the most RELEVANT approved learnings for THIS
    // request (ACL + freshness applied inside; falls back to recency if
    // embeddings are unavailable). Framed as data, not instructions, so
    // stored content cannot steer the agent.
    const kbHits = await searchKnowledge({
      queryText: message,
      session,
      agentId: agentId === "gratitude" ? null : agentId,
      limit: 12,
    });

    const kbSection = formatKbSection(kbHits);

    // Team example library: reference material (images, decks, ads) the team
    // has submitted. Uses the SAME access predicate as downloads
    // (lib/permissions.ts), so a user is never shown an example title,
    // description, or link they are not allowed to open.
    let examplesSection = "";
    try {
      const exampleRows = await db.execute(sql`
        SELECT id, title, description, tags
        FROM resources
        WHERE EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(tags) t
            WHERE t LIKE 'example:%'
          )
          AND ${resourceAccessSql(session)}
        ORDER BY created_at DESC
        LIMIT 12
      `);
      const examples = exampleRows.rows as unknown as {
        id: string;
        title: string;
        description: string | null;
        tags: string[];
      }[];
      examplesSection = formatExamplesSection(examples);
    } catch (e) {
      console.error("Example library fetch failed:", e);
    }

    const systemPrompt = buildSystemPrompt({
      brandContext,
      kbSection,
      examplesSection,
      agentBody: agent.body,
      specialistBody,
    });

    // Stream response with web search + image generation enabled.
    // Image generation is a client tool, so the model can stop with
    // stop_reason "tool_use" - we run the tool, feed back the result, and
    // continue. The LAST turn is always tool-free so tool results never go
    // unanswered.
    const anthropic = new Anthropic();
    const tools = CHAT_TOOLS;

    let fullResponse = "";
    const citations: { url: string; title: string }[] = [];
    const maxImagesThisRun = CHAT_MAX_IMAGES_PER_RUN();
    let imagesThisRun = 0;
    // Generated images are recorded independently of the model's prose so
    // they render even if the final reply never repeats the markdown
    const generatedImages: { resourceId: string; title: string }[] = [];

    const readableStream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (payload: Record<string, unknown>) =>
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ ...payload, conversationId: convId })}\n\n`)
          );
        const emitText = (text: string) => {
          fullResponse += text;
          send({ text });
        };

        let incompleteReason: string | null = null;

        try {
          let loopMessages: Anthropic.Messages.MessageParam[] = [...apiMessages];

          for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
            const finalTurn = turn === MAX_TOOL_TURNS - 1 || timeLeft() < FINAL_TURN_RESERVE_MS;

            const stream = anthropic.messages.stream(
              {
                model: chatModel(),
                max_tokens: CHAT_MAX_TOKENS,
                system: systemPrompt,
                messages: loopMessages,
                tools,
                ...(finalTurn ? { tool_choice: { type: "none" as const } } : {}),
              },
              { signal: AbortSignal.timeout(Math.max(5_000, timeLeft())) }
            );

            let searchQueryBuffer = "";
            let inServerToolUse = false;

            for await (const event of stream) {
              if (event.type === "content_block_start") {
                const block = event.content_block as { type: string };
                if (block.type === "server_tool_use") {
                  inServerToolUse = true;
                  searchQueryBuffer = "";
                  send({ searching: true });
                } else {
                  inServerToolUse = false;
                }
              }

              if (event.type === "content_block_delta") {
                const delta = event.delta as { type: string; text?: string; partial_json?: string };

                // Capture search query from input_json_delta
                if (delta.type === "input_json_delta" && inServerToolUse && delta.partial_json) {
                  searchQueryBuffer += delta.partial_json;
                  const qMatch = searchQueryBuffer.match(/"query"\s*:\s*"([^"]+)/);
                  if (qMatch) {
                    send({ searchQuery: qMatch[1] });
                  }
                }

                if (delta.type === "text_delta" && delta.text) {
                  emitText(delta.text);
                }
              }
            }

            const finalMessage = await stream.finalMessage();

            // Collect citations from this turn's text blocks
            for (const block of finalMessage.content) {
              if (block.type === "text" && "citations" in block && Array.isArray(block.citations)) {
                for (const cite of block.citations) {
                  if ("url" in cite && "title" in cite) {
                    const url = cite.url as string;
                    const title = cite.title as string;
                    if (!citations.some((c) => c.url === url)) {
                      citations.push({ url, title });
                    }
                  }
                }
              }
            }

            const stopReason = finalMessage.stop_reason;

            if (stopReason === "end_turn" || stopReason === "stop_sequence") {
              break;
            }
            if (stopReason === "max_tokens") {
              incompleteReason = "max_tokens";
              break;
            }
            if (stopReason === "refusal") {
              incompleteReason = "refusal";
              break;
            }
            if (stopReason === "pause_turn") {
              // Server tool (web search) paused a long turn: resume it
              if (finalTurn) {
                incompleteReason = "time";
                break;
              }
              loopMessages = [...loopMessages, { role: "assistant", content: finalMessage.content }];
              continue;
            }
            if (stopReason !== "tool_use") {
              incompleteReason = "error";
              break;
            }
            if (finalTurn) {
              // Should not happen with tool_choice none, but never report it as done
              incompleteReason = "tool_limit";
              break;
            }

            // Run requested client tools, feed results back, continue the loop
            const toolUses = finalMessage.content.filter(
              (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
            );
            const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

            for (const toolUse of toolUses) {
              if (toolUse.name === "generate_image") {
                const input = toolUse.input as {
                  prompt?: string;
                  aspect_ratio?: string;
                  include_logo?: boolean;
                };

                // Only start an image if it can finish AND leave room for the
                // reply. Checked before the budgets so a skipped image never
                // consumes the user's daily allowance.
                const imageWindow = timeLeft() - FINAL_TURN_RESERVE_MS;
                if (imageWindow < MIN_IMAGE_WINDOW_MS) {
                  const reason = "Not enough time left in this request to create the image.";
                  send({ imageError: reason });
                  toolResults.push({
                    type: "tool_result",
                    tool_use_id: toolUse.id,
                    is_error: true,
                    content: `${reason} Tell the user briefly and offer to create it in a new message.`,
                  });
                  continue;
                }

                // Budgets: a per-reply cap, then the user's daily allowance,
                // both checked before the paid image call
                if (imagesThisRun >= maxImagesThisRun) {
                  toolResults.push({
                    type: "tool_result",
                    tool_use_id: toolUse.id,
                    is_error: true,
                    content: `The image limit for a single reply (${maxImagesThisRun}) has been reached. Do not call generate_image again in this reply. Tell the user they can ask for more images in their next message.`,
                  });
                  continue;
                }
                const imageLimited = await consumeBudgets(session.userId, ["image_day"]);
                if (imageLimited) {
                  toolResults.push({
                    type: "tool_result",
                    tool_use_id: toolUse.id,
                    is_error: true,
                    content: "This user has reached today's image generation limit. Tell them plainly that they can generate more images tomorrow, and continue helping with the rest of the request.",
                  });
                  continue;
                }
                imagesThisRun++;

                send({ generatingImage: true });
                try {
                  const image = await generateImage({
                    prompt: input.prompt || "",
                    aspectRatio: IMAGE_ASPECT_RATIOS.includes(input.aspect_ratio as ImageAspectRatio)
                      ? (input.aspect_ratio as ImageAspectRatio)
                      : "1:1",
                    ownerId: session.userId,
                    conversationId: convId,
                    includeLogo: input.include_logo !== false,
                    // Never longer than the provider ceiling, never past the reply reserve
                    timeoutMs: Math.min(imageWindow, IMAGE_TIMEOUT_MS),
                  });
                  generatedImages.push({ resourceId: image.resourceId, title: image.title });
                  send({ imageReady: { resourceId: image.resourceId, title: image.title } });
                  if (image.logoError) send({ imageError: image.logoError });
                  toolResults.push({
                    type: "tool_result",
                    tool_use_id: toolUse.id,
                    content:
                      `Image generated successfully and is already shown to the user. You may embed it with exactly this markdown: ![${image.title}](/api/resources/${image.resourceId}/download?inline=1)` +
                      (image.logoError ? ` Note: ${image.logoError} Tell the user.` : ""),
                  });
                } catch (imageErr) {
                  console.error("Image generation failed:", imageErr);
                  const reason =
                    imageErr instanceof Error ? imageErr.message.slice(0, 300) : "unknown error";
                  send({ imageError: reason });
                  toolResults.push({
                    type: "tool_result",
                    tool_use_id: toolUse.id,
                    is_error: true,
                    content: `Image generation failed (${reason}). Briefly let the user know the image could not be created right now and continue helping with the rest of their request.`,
                  });
                }
              } else {
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: toolUse.id,
                  is_error: true,
                  content: `Unknown tool: ${toolUse.name}`,
                });
              }
            }

            const nextIsFinal = turn + 1 === MAX_TOOL_TURNS - 1 || timeLeft() < FINAL_TURN_RESERVE_MS;
            const userContent: Anthropic.Messages.ContentBlockParam[] = [...toolResults];
            if (nextIsFinal) {
              userContent.push({
                type: "text",
                text: FINAL_TURN_INSTRUCTION,
              });
            }

            loopMessages = [
              ...loopMessages,
              { role: "assistant", content: finalMessage.content },
              { role: "user", content: userContent },
            ];
          }
        } catch (err) {
          console.error("Chat stream failed:", err);
          incompleteReason = incompleteReason || "error";
          send({ error: "The response was interrupted." });
        }

        try {
          // Images the model did not embed are appended so they always render
          const missing = generatedImages.filter((img) => !fullResponse.includes(`/api/resources/${img.resourceId}/`));
          if (missing.length > 0) {
            emitText(
              (fullResponse ? "\n\n" : "") +
                missing.map((img) => `![${img.title}](/api/resources/${img.resourceId}/download?inline=1)`).join("\n\n")
            );
          }

          if (incompleteReason) {
            emitText(`${fullResponse ? "\n\n" : ""}_${INCOMPLETE_NOTES[incompleteReason] || INCOMPLETE_NOTES.error}_`);
            send({ incomplete: incompleteReason });
          }

          if (citations.length > 0) {
            send({ citations });
            // Append citation links to the saved response
            fullResponse +=
              "\n\n---\n**Sources:** " +
              citations.map((c) => `[${c.title}](${c.url})`).join(" | ");
          }

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } finally {
          controller.close();
        }
      },
    });

    // After stream completes, save assistant message and maybe enrich
    after(async () => {
      if (fullResponse) {
        await db.insert(messages).values({
          conversationId: convId!,
          role: "assistant",
          content: fullResponse,
        });

        await db
          .update(conversations)
          .set({ updatedAt: new Date() })
          .where(eq(conversations.id, convId!));

        // Enrichment cadence: first pass once the conversation has substance,
        // then every N new messages past the watermark - long conversations
        // keep contributing learnings instead of being read once
        const msgCount = await db
          .select()
          .from(messages)
          .where(eq(messages.conversationId, convId!));

        const [conv] = await db
          .select()
          .from(conversations)
          .where(eq(conversations.id, convId!));

        const total = msgCount.length;
        const through = conv?.enrichedThrough || 0;
        const shouldEnrich =
          (through === 0 && total >= ENRICH_MIN_MESSAGES) ||
          (through > 0 && total - through >= ENRICH_EVERY_N_MESSAGES);

        if (shouldEnrich) {
          // Use detected domain for KB tagging so entries get meaningful labels
          const enrichAgentId = detectedDomain || resolvedAgentId;
          await enrichConversation(convId!, enrichAgentId, {
            ownerId: session.userId,
            role: session.role,
          });
        }
      }
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("Chat error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
