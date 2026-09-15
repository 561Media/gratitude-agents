/**
 * Gratitude agent portal eval runner.
 *
 *   npm run eval                          live run (Anthropic API, budgeted)
 *   npm run eval:mock                     replay saved transcripts through graders, no API calls
 *
 * Options:
 *   --out <dir>            results dir (live default: evals/results/<date>)
 *   --from <dir>           transcripts to replay in --mock (default: evals/results/2026-09-15)
 *   --only <id,id>         run only these case ids
 *   --agents <a,b>         run only these agents
 *   --failed-from <file>   run only cases that failed in a results.json
 *   --base <dir>           when writing a rerun, also rebuild <dir>/summary.md with before/after
 *   --max-calls <n>        hard cap on model calls, grader included (default 200)
 *   --concurrency <n>      parallel cases (default 2)
 *   --no-grader            skip the LLM rubric grader
 *   --dry-run              routing and prompt assembly only, no API calls
 *   --strict               exit 1 when any critical check fails
 *
 * The API key is read from EVAL_ENV_PATH (default ~/gratitude-agents/.env.local)
 * at runtime and passed to the client directly; it is never written or printed.
 * Nothing here touches the database, Blob storage, or the image provider.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import {
  buildSystemPrompt,
  buildTurnBrandContext,
  CHAT_MAX_TOKENS,
  chatModel,
  FINAL_TURN_INSTRUCTION,
  formatExamplesSection,
  formatKbSection,
  GENERATE_IMAGE_TOOL,
  resolveTurnRouting,
} from "@/lib/chat-prompt";
import { IMAGE_ASPECT_RATIOS, type ImageAspectRatio } from "@/lib/image-canvas";
import { CASES } from "./cases";
import { KB_FIXTURES } from "./fixtures";
import { runDeterministicChecks, worstFailure } from "./graders";
import { GRADER_MODEL, gradeWithLlm, graderSystemPrompt, llmCheck } from "./llm-grader";
import { buildSummary, estimateCost } from "./report";
import { runSelfTest } from "./selftest";
import type { CaseResult, EvalCase, RoutingRecord, RunResults, ToolCallRecord, Transcript, TurnRecord } from "./types";

const ROOT = process.cwd();
const RUN_ID = "2026-09-15";
const MAX_TOOL_TURNS = 4; // same as app/api/chat/route.ts
const MAX_IMAGES_PER_RUN = 2; // CHAT_MAX_IMAGES_PER_RUN default

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

interface Prepared {
  routing: RoutingRecord;
  systemPrompt: string;
  sha: string;
}

/** The production assembly for one case, with frozen KB and no examples. */
export function prepareCase(c: EvalCase): Prepared {
  const agentId = "gratitude";
  const history = c.turns.map((t) => ({ role: t.role, content: t.content }));
  const routing = resolveTurnRouting(agentId, history);
  const brandContext = buildTurnBrandContext(routing);
  const systemPrompt = buildSystemPrompt({
    brandContext,
    kbSection: formatKbSection(KB_FIXTURES),
    examplesSection: formatExamplesSection([]),
    agentBody: routing.agent!.body,
    specialistBody: routing.specialistBody,
  });
  return {
    systemPrompt,
    sha: crypto.createHash("sha256").update(systemPrompt).digest("hex").slice(0, 16),
    routing: {
      agentId,
      domain: routing.detectedDomain,
      presentation: routing.requestContext.presentation,
      investor: routing.requestContext.investor,
      brandContextHasInvestorCore: brandContext.includes("## investor core"),
      brandContextHasVisualSystem: brandContext.includes("## Visual System"),
    },
  };
}

class Budget {
  underTest = 0;
  grader = 0;
  constructor(private underTestCap: number, private graderCap: number) {}
  takeUnderTest() {
    if (this.underTest >= this.underTestCap) return false;
    this.underTest++;
    return true;
  }
  takeGrader() {
    if (this.grader >= this.graderCap) return false;
    this.grader++;
    return true;
  }
}

class BudgetExhausted extends Error {}

/** Mirrors the route's tool loop: 4 turns, last turn tool-free, image tool mocked. */
async function runModel(client: Anthropic, c: EvalCase, prep: Prepared, budget: Budget): Promise<Transcript> {
  const startedAt = new Date();
  const turns: TurnRecord[] = [];
  const toolCalls: ToolCallRecord[] = [];
  let fullResponse = "";
  let incomplete: string | null = null;
  let imagesThisRun = 0;
  const generated: string[] = [];
  let loopMessages: Anthropic.Messages.MessageParam[] = c.turns.map((t) => ({ role: t.role, content: t.content }));
  const tools = [GENERATE_IMAGE_TOOL] as Anthropic.Messages.ToolUnion[]; // web search disabled
  let error: string | undefined;

  try {
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      const finalTurn = turn === MAX_TOOL_TURNS - 1;
      if (!budget.takeUnderTest()) throw new BudgetExhausted("model call budget exhausted");
      const t0 = Date.now();
      const stream = client.messages.stream({
        model: chatModel(),
        max_tokens: CHAT_MAX_TOKENS,
        system: prep.systemPrompt,
        messages: loopMessages,
        tools,
        ...(finalTurn ? { tool_choice: { type: "none" as const } } : {}),
      });
      const msg = await stream.finalMessage();
      turns.push({
        turn,
        stopReason: msg.stop_reason,
        durationMs: Date.now() - t0,
        content: msg.content,
        usage: { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens },
      });
      for (const b of msg.content) if (b.type === "text") fullResponse += b.text;

      const stop = msg.stop_reason;
      if (stop === "end_turn" || stop === "stop_sequence") break;
      if (stop === "max_tokens" || stop === "refusal") {
        incomplete = stop;
        break;
      }
      if (stop !== "tool_use") {
        incomplete = stop || "error";
        break;
      }
      if (finalTurn) {
        incomplete = "tool_limit";
        break;
      }

      const results: Anthropic.Messages.ContentBlockParam[] = [];
      for (const tu of msg.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use")) {
        let content: string;
        let isError = false;
        if (tu.name === "generate_image") {
          const input = tu.input as { prompt?: string; aspect_ratio?: string };
          if (imagesThisRun >= MAX_IMAGES_PER_RUN) {
            isError = true;
            content = `The image limit for a single reply (${MAX_IMAGES_PER_RUN}) has been reached. Do not call generate_image again in this reply. Tell the user they can ask for more images in their next message.`;
          } else {
            imagesThisRun++;
            const id = crypto.randomUUID();
            const ratio = IMAGE_ASPECT_RATIOS.includes(input.aspect_ratio as ImageAspectRatio) ? input.aspect_ratio : "1:1";
            const title = `Gratitude ${ratio} image`;
            generated.push(id);
            content = `Image generated successfully and is already shown to the user. You may embed it with exactly this markdown: ![${title}](/api/resources/${id}/download?inline=1)`;
          }
        } else {
          isError = true;
          content = `Unknown tool: ${tu.name}`;
        }
        toolCalls.push({ name: tu.name, input: tu.input, result: content, isError });
        results.push({ type: "tool_result", tool_use_id: tu.id, content, ...(isError ? { is_error: true } : {}) });
      }
      if (turn + 1 === MAX_TOOL_TURNS - 1) results.push({ type: "text", text: FINAL_TURN_INSTRUCTION });
      loopMessages = [...loopMessages, { role: "assistant", content: msg.content }, { role: "user", content: results }];
    }
  } catch (e) {
    if (e instanceof BudgetExhausted) throw e;
    error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    incomplete = incomplete || "error";
  }

  const missing = generated.filter((id) => !fullResponse.includes(`/api/resources/${id}/`));
  if (missing.length) fullResponse += (fullResponse ? "\n\n" : "") + missing.map((id) => `![image](/api/resources/${id}/download?inline=1)`).join("\n\n");

  return {
    caseId: c.id,
    agent: c.agent,
    kind: c.kind,
    model: chatModel(),
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    routing: prep.routing,
    systemPromptSha256: prep.sha,
    systemPromptChars: prep.systemPrompt.length,
    turns,
    toolCalls,
    finalText: fullResponse,
    incomplete,
    ...(error ? { error } : {}),
  };
}

function gradeCase(c: EvalCase, t: Transcript, prep: Prepared): CaseResult {
  const corpus = prep.systemPrompt + "\n" + c.turns.map((x) => x.content).join("\n");
  const checks = [...runDeterministicChecks(c, t, { corpus, routing: prep.routing }), ...llmCheck(t.grade)];
  const worst = worstFailure(checks);
  return {
    caseId: c.id,
    agent: c.agent,
    kind: c.kind,
    title: c.title,
    checks,
    llm: t.grade,
    pass: worst !== "critical" && worst !== "major",
    worstSeverity: worst,
  };
}

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    })
  );
}

function selectCases(): EvalCase[] {
  let cases = CASES;
  const only = arg("only");
  if (only) cases = cases.filter((c) => only.split(",").includes(c.id));
  const agents = arg("agents");
  if (agents) cases = cases.filter((c) => agents.split(",").includes(c.agent));
  const failedFrom = arg("failed-from");
  if (failedFrom) {
    const prev = JSON.parse(fs.readFileSync(failedFrom, "utf8")) as RunResults;
    const failed = new Set(prev.cases.filter((c) => !c.pass).map((c) => c.caseId));
    cases = cases.filter((c) => failed.has(c.id));
  }
  return cases;
}

function writeResults(outDir: string, results: RunResults, baseDir?: string) {
  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2));
  if (baseDir && path.resolve(baseDir) !== path.resolve(outDir)) {
    const base = JSON.parse(fs.readFileSync(path.join(baseDir, "results.json"), "utf8")) as RunResults;
    fs.writeFileSync(path.join(baseDir, "summary.md"), buildSummary(base, results));
    fs.writeFileSync(path.join(outDir, "summary.md"), buildSummary(results));
  } else {
    fs.writeFileSync(path.join(outDir, "summary.md"), buildSummary(results));
  }
}

async function main() {
  const mock = flag("mock");
  const cases = selectCases();
  const concurrency = Number(arg("concurrency") || 2);
  const maxCalls = Number(arg("max-calls") || 200);

  if (flag("dry-run")) {
    let bad = 0;
    for (const c of cases) {
      const prep = prepareCase(c);
      const ok = prep.routing.domain === c.expect.domain;
      if (!ok) bad++;
      console.log(`${ok ? "ok  " : "MISS"} ${c.id} -> ${prep.routing.domain ?? "none"}${prep.routing.investor ? " +investor" : ""}${prep.routing.presentation ? " +deck" : ""} (${prep.systemPrompt.length} chars)`);
    }
    console.log(`${cases.length} cases, ${bad} routing misses`);
    return;
  }

  if (mock) {
    const from = arg("from") || path.join(ROOT, "evals", "results", RUN_ID);
    const outDir = arg("out") || fs.mkdtempSync(path.join(os.tmpdir(), "gratitude-evals-mock-"));
    fs.mkdirSync(outDir, { recursive: true });
    const selftest = runSelfTest();
    console.log(`grader selftest: ${selftest.passed} passed, ${selftest.failures.length} failed`);
    for (const f of selftest.failures) console.log(`  selftest FAIL ${f}`);
    if (selftest.failures.length) process.exit(1);

    const savedFile = path.join(from, "results.json");
    if (!fs.existsSync(savedFile)) {
      // No live transcripts yet: prove every case still assembles, report routing
      let misses = 0;
      for (const c of cases) if (prepareCase(c).routing.domain !== c.expect.domain) misses++;
      console.log(`no saved transcripts in ${from}; prompt assembly OK for ${cases.length} cases, ${misses} routing misses vs expectations (informational)`);
      return;
    }
    const saved = JSON.parse(fs.readFileSync(savedFile, "utf8")) as RunResults;
    const results: CaseResult[] = [];
    let drift = 0;
    for (const c of cases) {
      const file = path.join(from, "transcripts", `${c.id}.json`);
      if (!fs.existsSync(file)) {
        results.push({ caseId: c.id, agent: c.agent, kind: c.kind, title: c.title, checks: [], pass: false, worstSeverity: null, skipped: "no saved transcript" });
        continue;
      }
      const t = JSON.parse(fs.readFileSync(file, "utf8")) as Transcript;
      const prep = prepareCase(c);
      if (prep.routing.domain !== t.routing.domain) {
        drift++;
        console.log(`routing drift: ${c.id} saved ${t.routing.domain} now ${prep.routing.domain}`);
      }
      results.push(gradeCase(c, t, prep));
    }
    const run: RunResults = { ...saved, mode: "mock", generatedAt: new Date().toISOString(), cases: results };
    writeResults(outDir, run);
    const critical = results.filter((r) => r.worstSeverity === "critical").length;
    console.log(`mock replay: ${results.length} cases, ${results.filter((r) => r.pass).length} pass, ${critical} critical, ${drift} routing drift. Summary: ${path.join(outDir, "summary.md")}`);
    if (flag("strict") && critical > 0) process.exit(1);
    return;
  }

  // Live run
  const envPath = process.env.EVAL_ENV_PATH || path.join(os.homedir(), "gratitude-agents", ".env.local");
  const apiKey = process.env.ANTHROPIC_API_KEY || dotenv.parse(fs.readFileSync(envPath)).ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error(`ANTHROPIC_API_KEY not found in environment or ${envPath}`);
  const client = new Anthropic({ apiKey, maxRetries: 3 });

  const outDir = arg("out") || path.join(ROOT, "evals", "results", RUN_ID);
  fs.mkdirSync(path.join(outDir, "transcripts"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "prompts"), { recursive: true });

  const useGrader = !flag("no-grader");
  const graderCap = useGrader ? Math.min(cases.length, Math.floor(maxCalls * 0.45)) : 0;
  const budget = new Budget(maxCalls - graderCap, graderCap);
  const graderSystem = useGrader ? graderSystemPrompt(ROOT) : "";
  const usage = {
    underTest: { input_tokens: 0, output_tokens: 0 },
    grader: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
  const results = new Map<string, CaseResult>();
  let done = 0;

  console.log(`live run: ${cases.length} cases, model ${chatModel()}, grader ${useGrader ? GRADER_MODEL : "off"}, cap ${maxCalls} calls, concurrency ${concurrency}`);

  await pool(cases, concurrency, async (c) => {
    const prep = prepareCase(c);
    const promptFile = path.join(outDir, "prompts", `${prep.sha}.txt`);
    if (!fs.existsSync(promptFile)) fs.writeFileSync(promptFile, prep.systemPrompt);

    let t: Transcript;
    try {
      t = await runModel(client, c, prep, budget);
    } catch (e) {
      if (e instanceof BudgetExhausted) {
        results.set(c.id, { caseId: c.id, agent: c.agent, kind: c.kind, title: c.title, checks: [], pass: false, worstSeverity: null, skipped: "call budget exhausted" });
        console.log(`skip ${c.id}: budget`);
        return;
      }
      throw e;
    }
    for (const turn of t.turns) {
      usage.underTest.input_tokens += turn.usage.input_tokens;
      usage.underTest.output_tokens += turn.usage.output_tokens;
    }

    if (useGrader && !t.error && budget.takeGrader()) {
      try {
        t.grade = await gradeWithLlm(client, graderSystem, c, t);
        const gu = t.grade.usage;
        if (gu) {
          usage.grader.input_tokens += gu.input_tokens;
          usage.grader.output_tokens += gu.output_tokens;
          usage.grader.cache_read_input_tokens += gu.cache_read_input_tokens ?? 0;
          usage.grader.cache_creation_input_tokens += gu.cache_creation_input_tokens ?? 0;
        }
      } catch (e) {
        t.grade = { model: GRADER_MODEL, brand_voice: 0, task_quality: 0, fact_discipline: 0, critical_issues: [], reasons: "", error: e instanceof Error ? e.message.slice(0, 200) : "grader failed" };
      }
    }

    fs.writeFileSync(path.join(outDir, "transcripts", `${c.id}.json`), JSON.stringify(t, null, 2));
    const r = gradeCase(c, t, prep);
    results.set(c.id, r);
    done++;
    console.log(`[${done}/${cases.length}] ${r.pass ? "pass" : `FAIL(${r.worstSeverity})`} ${c.id} (${Math.round(t.durationMs / 1000)}s, calls ${budget.underTest}+${budget.grader})`);
  });

  const run: RunResults = {
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    mode: "live",
    model: chatModel(),
    graderModel: GRADER_MODEL,
    calls: { underTest: budget.underTest, grader: budget.grader, cap: maxCalls },
    usage,
    estimatedCostUsd: 0,
    cases: cases.map((c) => results.get(c.id)!).filter(Boolean),
  };

  // --merge: batches written to the same dir accumulate into one run
  // (a single foreground command is time-limited, so live runs go in batches)
  const prevFile = path.join(outDir, "results.json");
  if (flag("merge") && fs.existsSync(prevFile)) {
    const prev = JSON.parse(fs.readFileSync(prevFile, "utf8")) as RunResults;
    const ids = new Set(run.cases.map((c) => c.caseId));
    const byId = new Map([...prev.cases.filter((c) => !ids.has(c.caseId)), ...run.cases].map((c) => [c.caseId, c]));
    run.cases = CASES.map((c) => byId.get(c.id)).filter((c): c is CaseResult => !!c);
    run.calls = { underTest: prev.calls.underTest + run.calls.underTest, grader: prev.calls.grader + run.calls.grader, cap: prev.calls.cap + run.calls.cap };
    run.usage.underTest.input_tokens += prev.usage.underTest.input_tokens;
    run.usage.underTest.output_tokens += prev.usage.underTest.output_tokens;
    for (const k of ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"] as const) {
      run.usage.grader[k] += prev.usage.grader[k];
    }
  }
  run.estimatedCostUsd = estimateCost(run);
  writeResults(outDir, run, arg("base"));
  const critical = run.cases.filter((r) => r.worstSeverity === "critical").length;
  console.log(`done: ${run.cases.filter((r) => r.pass).length}/${run.cases.length} pass, ${critical} critical, calls ${budget.underTest}+${budget.grader}, est $${run.estimatedCostUsd.toFixed(2)}. Summary: ${path.join(outDir, "summary.md")}`);
  if (flag("strict") && critical > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
