"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { PortalUploadError, uploadFileToPortal } from "@/lib/client-upload";
import ChatMessage from "./ChatMessage";
import GratitudeMark from "./GratitudeMark";
import { toast } from "./Toaster";
import { extractSlides } from "@/lib/slide-schema";
import { SseParser } from "@/lib/sse";

export interface ChatAttachment {
  resourceId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

// Markdown appended to the user's message so attachments render in the
// conversation (images inline, other files as links)
export function attachmentMarkdown(attachments: ChatAttachment[]): string {
  if (attachments.length === 0) return "";
  return (
    "\n\n" +
    attachments
      .map((a) =>
        a.mimeType.startsWith("image/")
          ? `![${a.fileName}](/api/resources/${a.resourceId}/download?inline=1)`
          : `[Attached: ${a.fileName}](/api/resources/${a.resourceId}/download)`
      )
      .join("\n")
  );
}

function timeOfDayGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

interface StarterTask {
  label: string;
  hint: string;
  prompt: string;
  icon: React.ReactNode;
}

// 16px stroke icons, consistent 1.5 weight
const starterTasks: StarterTask[] = [
  {
    label: "Content calendar",
    hint: "Plan next week's posts across channels",
    prompt: "Build a content calendar for next week",
    icon: (
      <>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </>
    ),
  },
  {
    label: "Pitch deck",
    hint: "Slides you can export to PowerPoint or PDF",
    prompt: "Create a pitch deck for prospective funders",
    icon: (
      <>
        <line x1="6" y1="20" x2="6" y2="14" />
        <line x1="12" y1="20" x2="12" y2="8" />
        <line x1="18" y1="20" x2="18" y2="4" />
      </>
    ),
  },
  {
    label: "Nurture email sequence",
    hint: "A multi-touch sequence in the Gratitude voice",
    prompt: "Write a nurture email sequence",
    icon: (
      <>
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <polyline points="22 6 12 13 2 6" />
      </>
    ),
  },
  {
    label: "Trend research",
    hint: "What's moving in corporate social impact",
    prompt: "Research latest trends in corporate social impact",
    icon: (
      <>
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </>
    ),
  },
  {
    label: "Landing page copy",
    hint: "Headlines, sections, and calls to action",
    prompt: "Draft copy for our landing page",
    icon: (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </>
    ),
  },
  {
    label: "Social rollout plan",
    hint: "Channel-by-channel launch schedule",
    prompt: "Generate a social media rollout plan",
    icon: (
      <>
        <path d="M3 11l18-5v12L3 14v-3z" />
        <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
      </>
    ),
  },
];

interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
}

interface ChatInterfaceProps {
  agentId: string;
  conversationId: string | null;
  onConversationCreated: (id: string) => void;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
}

type ExportFormat = "md" | "docx" | "pdf" | "pptx" | "csv" | "xlsx";

async function downloadConversation(messages: Message[], format: ExportFormat) {
  const assistants = messages.filter((m) => m.role === "assistant" && m.content);
  // Decks export the most recent assistant message that actually CONTAINS a
  // deck, so a later "looks good" reply can never replace the slides
  const latestDeck = [...assistants].reverse().find((m) => extractSlides(m.content));
  const lastAssistant = assistants[assistants.length - 1];

  let title = "Conversation transcript";
  let content: string;

  if ((format === "pptx" || format === "pdf") && latestDeck) {
    content = latestDeck.content;
    title = extractSlides(latestDeck.content)?.title || "Gratitude Presentation";
  } else if ((format === "csv" || format === "xlsx") && lastAssistant) {
    content = lastAssistant.content;
    title = "Gratitude Export";
  } else {
    // Explicitly labeled transcript export
    content =
      `# Conversation transcript\n\n` +
      messages
        .map((m) => (m.role === "user" ? `## You\n\n${m.content}` : `## Gratitude\n\n${m.content}`))
        .join("\n\n---\n\n");
  }

  let res: Response;
  try {
    res = await fetch("/api/exports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content, format }),
    });
  } catch {
    toast(`${format.toUpperCase()} export failed. Check your connection and try again.`);
    return;
  }

  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
    toast(res.status === 429 && errBody?.error ? errBody.error : `${format.toUpperCase()} export failed. Please try again.`);
    return;
  }

  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download =
    match?.[1] || `gratitude-conversation-${Date.now()}.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}

type ConversationContentType = "document" | "spreadsheet" | "presentation" | "mixed";

function detectConversationContentType(messages: Message[]): ConversationContentType {
  const assistantMessages = messages.filter((m) => m.role === "assistant");
  if (assistantMessages.length === 0) return "document";

  let hasPresentation = false;
  let hasSpreadsheet = false;

  for (const msg of assistantMessages) {
    const c = msg.content;

    // Check for slide JSON (every slide validated)
    if (extractSlides(c)) hasPresentation = true;

    // Check for CSV
    const csvMatch = c.match(/```(?:csv)?\s*\n[\s\S]*?\n```/);
    if (csvMatch) hasSpreadsheet = true;
  }

  if (hasPresentation && hasSpreadsheet) return "mixed";
  if (hasPresentation) return "presentation";
  if (hasSpreadsheet) return "spreadsheet";
  return "document";
}

function HeaderExportButton({
  label,
  onClick,
  accent,
}: {
  label: string;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] transition-all ${
        accent
          ? "text-brand-pink/50 hover:text-brand-pink hover:bg-brand-pink/[0.06]"
          : "text-white/35 hover:text-white/60 hover:bg-white/[0.04]"
      }`}
      title={`Download as ${label}`}
    >
      {label}
    </button>
  );
}

function HeaderExportButtons({
  messages,
  downloadConversation,
}: {
  messages: Message[];
  downloadConversation: (msgs: Message[], fmt: ExportFormat) => Promise<void>;
}) {
  const type = detectConversationContentType(messages);

  const btn = (label: string, fmt: ExportFormat, accent?: boolean) => (
    <HeaderExportButton
      key={fmt}
      label={label}
      onClick={() => void downloadConversation(messages, fmt)}
      accent={accent}
    />
  );

  return (
    <div className="flex items-center gap-1 shrink-0">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/25 mr-1">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      {type === "presentation" && (
        <>{btn("PPTX", "pptx", true)}{btn("PDF", "pdf")}</>
      )}
      {type === "spreadsheet" && (
        <>{btn("Excel", "xlsx", true)}{btn("CSV", "csv")}</>
      )}
      {type === "document" && (
        <>{btn("MD", "md")}{btn("DOCX", "docx")}{btn("PDF", "pdf")}</>
      )}
      {type === "mixed" && (
        <>{btn("PPTX", "pptx", true)}{btn("Excel", "xlsx", true)}{btn("PDF", "pdf")}{btn("MD", "md")}</>
      )}
    </div>
  );
}

export default function ChatInterface({
  agentId,
  conversationId,
  onConversationCreated,
  messages,
  setMessages,
}: ChatInterfaceProps) {
  const [input, setInput] = useState("");
  const [firstName, setFirstName] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [generatingImage, setGeneratingImage] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    // Only auto-scroll when there is a conversation; scrolling on mount
    // clips the top of the empty-state greeting
    if (messages.length > 0) scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [agentId]);

  // First name for the empty-state greeting
  useEffect(() => {
    fetch("/api/session")
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        const name: string | undefined = data?.user?.name;
        if (name) setFirstName(name.split(" ")[0]);
      })
      .catch(() => {});
  }, []);

  // Guide "Try asking" / "Try this workflow" buttons stash their prompt in
  // sessionStorage before navigating here - prefill it so the user lands with
  // the prompt ready to send (previously the key was written but never read)
  useEffect(() => {
    const starter = sessionStorage.getItem("gratitude_starter_prompt");
    if (starter) {
      sessionStorage.removeItem("gratitude_starter_prompt");
      setInput(starter);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.style.height = "auto";
          el.style.height = Math.min(el.scrollHeight, 200) + "px";
        }
      });
    }
  }, []);

  function resizeTextarea() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }

  // Attach files from the composer: upload straight to blob (same client
  // path as the Files page), record a resource row, and hold the reference
  // until send. The agent reads images and PDFs directly.
  async function handleFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const incoming = Array.from(fileList);

    if (attachments.length + incoming.length > MAX_ATTACHMENTS) {
      toast(`Up to ${MAX_ATTACHMENTS} attachments per message.`);
      return;
    }
    const oversized = incoming.find((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (oversized) {
      toast(`"${oversized.name}" is over the 25MB attachment limit.`);
      return;
    }

    setUploadingAttachment(true);
    try {
      for (const f of incoming) {
        const resource = await uploadFileToPortal<{ id: string; mimeType: string | null }>(
          f,
          "chat",
          { title: f.name, visibility: "private", tags: ["chat-upload"] }
        );
        setAttachments((prev) => [
          ...prev,
          {
            resourceId: resource.id,
            fileName: f.name,
            mimeType: resource.mimeType || f.type || "application/octet-stream",
            sizeBytes: f.size,
          },
        ]);
      }
    } catch (e) {
      console.error("Attachment upload failed:", e);
      toast(e instanceof PortalUploadError ? e.message : "Attachment upload failed. Please try again.");
    } finally {
      setUploadingAttachment(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSend(overrideMessage?: string) {
    const trimmed = (overrideMessage || input).trim();
    if ((!trimmed && attachments.length === 0) || streaming || uploadingAttachment) return;

    const sentAttachments = attachments;
    setAttachments([]);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    const displayContent =
      (trimmed || "Please review the attached file(s).") +
      attachmentMarkdown(sentAttachments);
    setMessages((prev) => [...prev, { role: "user", content: displayContent }]);
    setStreaming(true);

    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed || "Please review the attached file(s).",
          agentId,
          conversationId,
          attachments: sentAttachments,
        }),
      });

      if (!res.ok) {
        // Limits (429) and validation errors carry a readable message
        const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
        if (errBody?.error) toast(errBody.error);
        throw new Error("Chat failed");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader");

      const appendText = (text: string) =>
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === "assistant") {
            updated[updated.length - 1] = { ...last, content: last.content + text };
          }
          return updated;
        });

      let sawDone = false;
      let sawIncomplete = false;
      let createdNotified = false;

      const handleEvent = (data: string) => {
        if (data === "[DONE]") {
          sawDone = true;
          return;
        }
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(data);
        } catch {
          console.error("Unparseable stream event", data.slice(0, 200));
          return;
        }
        if (parsed.searching) {
          setSearching(true);
          setSearchQuery("");
        }
        if (typeof parsed.searchQuery === "string") setSearchQuery(parsed.searchQuery);
        if (parsed.generatingImage) setGeneratingImage(true);
        if (parsed.imageReady) setGeneratingImage(false);
        if (typeof parsed.imageError === "string") {
          setGeneratingImage(false);
          toast(`Image issue: ${parsed.imageError}`);
        }
        if (typeof parsed.text === "string") {
          setSearching(false);
          setSearchQuery("");
          setGeneratingImage(false);
          appendText(parsed.text);
        }
        if (parsed.incomplete) {
          sawIncomplete = true;
          toast("This response did not finish. Ask Gratitude to continue.");
        }
        if (typeof parsed.error === "string") {
          toast(parsed.error);
        }
        if (typeof parsed.conversationId === "string" && !conversationId && !createdNotified) {
          createdNotified = true;
          onConversationCreated(parsed.conversationId);
        }
      };

      // Persistent buffer: events split across network chunks (and multibyte
      // characters split across chunks) are reassembled before parsing
      const parser = new SseParser();
      while (true) {
        const { value, done } = await reader.read();
        if (value) parser.push(value).forEach(handleEvent);
        if (done) break;
      }
      parser.flush().forEach(handleEvent);

      if (!sawDone && !sawIncomplete) {
        // Connection dropped before the server finished: never look complete
        appendText("\n\n_The connection dropped before this response finished. Ask Gratitude to continue._");
        toast("The response was interrupted before it finished.");
      }
    } catch (err) {
      console.error("Stream error:", err);
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "assistant") {
          updated[updated.length - 1] = {
            ...last,
            content: last.content
              ? `${last.content}\n\n_This response was interrupted before it finished. Ask Gratitude to continue._`
              : "Sorry, something went wrong. Please try again.",
          };
        }
        return updated;
      });
    } finally {
      setStreaming(false);
      setSearching(false);
      setSearchQuery("");
      setGeneratingImage(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const hasMessages = messages.length > 0;

  return (
    <div className="flex-1 flex flex-col h-screen bg-dark-950">
      {/* Header */}
      <div className="shrink-0 h-[52px] px-6 border-b border-white/[0.06] bg-dark-900/50 flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 bg-white/[0.03] border border-white/[0.08]">
            <GratitudeMark size={13} className="text-white/80" />
          </div>
          <h2 className="text-[13px] font-medium text-white/85">Gratitude</h2>
        </div>

        {hasMessages && (
          <HeaderExportButtons messages={messages} downloadConversation={downloadConversation} />
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto"
      >
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
          {!hasMessages && (
            <div className="pt-8 sm:pt-12 pb-8">
              <h3 className="font-display uppercase text-[26px] sm:text-[30px] leading-[1.05] tracking-[-0.01em] text-white">
                {timeOfDayGreeting()}
                {firstName && <span className="text-white/40">, {firstName}</span>}
              </h3>
              <p className="mt-3 text-[14px] text-white/45 leading-relaxed max-w-md">
                Draft copy, build a deck, plan a campaign, or pull research.
                Describe the deliverable and Gratitude gets to work.
              </p>

              <div className="mt-9 max-w-md">
                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-white/25 mb-2 px-3">
                  Start with a task
                </p>
                <div className="flex flex-col">
                  {starterTasks.map((task) => (
                    <button
                      key={task.label}
                      onClick={() => handleSend(task.prompt)}
                      className="group flex items-center gap-3.5 px-3 py-2.5 rounded-lg text-left transition-colors hover:bg-white/[0.04]"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0 text-white/30 group-hover:text-white/70 transition-colors"
                      >
                        {task.icon}
                      </svg>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] text-white/75 group-hover:text-white transition-colors">
                          {task.label}
                        </span>
                        <span className="block text-[12px] text-white/30 truncate">
                          {task.hint}
                        </span>
                      </span>
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0 text-white/40 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all"
                      >
                        <path d="M5 12h14" />
                        <path d="m12 5 7 7-7 7" />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <ChatMessage
              key={i}
              role={msg.role}
              content={msg.content}
              agentName="Gratitude"
              conversationId={conversationId}
              isStreaming={streaming && i === messages.length - 1 && msg.role === "assistant"}
            />
          ))}

          {streaming && (messages[messages.length - 1]?.content === "" || searching || generatingImage) && (
            <div className="flex items-start gap-2.5 px-1">
              <div className="flex gap-1 mt-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-brand-pink/70 animate-pulse" />
                <div
                  className="w-1.5 h-1.5 rounded-full bg-brand-coral/70 animate-pulse"
                  style={{ animationDelay: "150ms" }}
                />
                <div
                  className="w-1.5 h-1.5 rounded-full bg-brand-orange/70 animate-pulse"
                  style={{ animationDelay: "300ms" }}
                />
              </div>
              <div>
                <span className="text-[11px] text-white/25">
                  {generatingImage
                    ? "Creating your image..."
                    : searching
                      ? "Searching the web..."
                      : "Gratitude is working on it..."}
                </span>
                {searching && searchQuery && (
                  <p className="text-[11px] text-brand-pink/40 mt-0.5 italic">
                    &ldquo;{searchQuery}&rdquo;
                  </p>
                )}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-white/[0.06] bg-dark-900/30">
        <div className="max-w-3xl mx-auto px-6 py-4">
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {attachments.map((a) => (
                <span
                  key={a.resourceId}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] text-white/60 bg-white/[0.04] border border-white/[0.08]"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                  </svg>
                  {a.fileName.length > 28 ? a.fileName.slice(0, 25) + "..." : a.fileName}
                  <button
                    onClick={() =>
                      setAttachments((prev) => prev.filter((x) => x.resourceId !== a.resourceId))
                    }
                    className="text-white/30 hover:text-white/70 transition-colors"
                    title="Remove attachment"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </span>
              ))}
              {uploadingAttachment && (
                <span className="px-2.5 py-1 rounded-lg text-[11px] text-white/35 bg-white/[0.02] border border-white/[0.05]">
                  Uploading...
                </span>
              )}
            </div>
          )}
          <div className="flex items-end gap-3 rounded-2xl px-4 py-3 bg-white/[0.03] border border-white/[0.07] transition-colors focus-within:border-white/[0.16] focus-within:bg-white/[0.04]">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              accept="image/png,image/jpeg,image/webp,image/gif,.pdf,.txt,.md,.csv"
              onChange={(e) => void handleFilesSelected(e.target.files)}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={streaming || uploadingAttachment}
              className="shrink-0 pb-1 text-white/30 hover:text-white/70 disabled:opacity-30 transition-colors"
              title="Attach files (images, PDFs, text)"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                resizeTextarea();
              }}
              onKeyDown={handleKeyDown}
              placeholder="Tell Gratitude what you need..."
              rows={1}
              className="flex-1 resize-none bg-transparent text-white/85 text-[15px] leading-relaxed placeholder:text-white/25 focus:outline-none"
              style={{ maxHeight: "200px" }}
              disabled={streaming}
            />
            <div className="flex items-center gap-2 shrink-0 pb-0.5">
              <span className="text-[10px] text-white/15 hidden sm:block">
                {streaming ? "Streaming..." : "Enter to send"}
              </span>
              <button
                onClick={() => handleSend()}
                disabled={(!input.trim() && attachments.length === 0) || streaming || uploadingAttachment}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-white transition-all duration-200 disabled:opacity-20 hover:-translate-y-0.5 active:translate-y-0"
                style={{
                  background:
                    (input.trim() || attachments.length > 0) && !streaming
                      ? "linear-gradient(135deg, #FE3184 0%, #FF6B35 50%, #ec7211 100%)"
                      : "rgba(255,255,255,0.04)",
                  boxShadow:
                    (input.trim() || attachments.length > 0) && !streaming
                      ? "0 4px 20px rgba(254, 49, 132, 0.25)"
                      : "none",
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
