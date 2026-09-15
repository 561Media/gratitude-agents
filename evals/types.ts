export type CaseKind =
  | "approved_fact"
  | "missing_fact"
  | "retired_trap"
  | "injection"
  | "specialist"
  | "routing";

export type Severity = "critical" | "major" | "minor";

export type CheckType =
  | "routing"
  | "completion"
  | "latency_budget"
  | "em_dash"
  | "retired_language"
  | "false_claim"
  | "invented_number"
  | "needs_input"
  | "injection"
  | "deck_schema"
  | "artifact"
  | "required_fact"
  | "llm_rubric";

export interface Pattern {
  pattern: string;
  flags?: string;
  label: string;
}

export interface CaseExpect {
  /** Specialist the production router must pick (null = orchestrator only) */
  domain: string | null;
  presentation?: boolean;
  investor?: boolean;
  /** Missing fact: output must carry a [NEEDS INPUT] marker */
  needsInput?: boolean;
  /** Output must contain slide JSON that the exporters accept */
  deck?: boolean;
  /** Output must contain a self-contained HTML block */
  html?: boolean;
  /** The model should call generate_image */
  image?: boolean;
  mustInclude?: Pattern[];
  /** Injection canary that must never be echoed as instructed */
  canary?: string;
}

export interface EvalCase {
  id: string;
  /** The agent this case is scored against */
  agent: string;
  kind: CaseKind;
  title: string;
  /** Conversation, oldest first; the last entry is the current user message */
  turns: { role: "user" | "assistant"; content: string }[];
  expect: CaseExpect;
  /** What a good answer does, for the LLM grader */
  rubric: string;
}

export interface CheckResult {
  check: string;
  type: CheckType;
  pass: boolean;
  severity: Severity;
  detail?: string;
}

export interface ToolCallRecord {
  name: string;
  input: unknown;
  result: string;
  isError: boolean;
}

export interface TurnRecord {
  turn: number;
  stopReason: string | null;
  durationMs: number;
  content: unknown;
  usage: { input_tokens: number; output_tokens: number };
}

export interface LlmGrade {
  model: string;
  brand_voice: number;
  task_quality: number;
  fact_discipline: number;
  critical_issues: string[];
  reasons: string;
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  error?: string;
}

export interface RoutingRecord {
  agentId: string;
  domain: string | null;
  presentation: boolean;
  investor: boolean;
  brandContextHasInvestorCore: boolean;
  brandContextHasVisualSystem: boolean;
}

export interface Transcript {
  caseId: string;
  agent: string;
  kind: CaseKind;
  model: string;
  startedAt: string;
  durationMs: number;
  routing: RoutingRecord;
  systemPromptSha256: string;
  systemPromptChars: number;
  turns: TurnRecord[];
  toolCalls: ToolCallRecord[];
  finalText: string;
  incomplete: string | null;
  error?: string;
  grade?: LlmGrade;
}

export interface CaseResult {
  caseId: string;
  agent: string;
  kind: CaseKind;
  title: string;
  checks: CheckResult[];
  llm?: LlmGrade;
  pass: boolean;
  worstSeverity: Severity | null;
  skipped?: string;
}

export interface RunResults {
  runId: string;
  generatedAt: string;
  mode: "live" | "mock";
  model: string;
  graderModel: string;
  calls: { underTest: number; grader: number; cap: number };
  usage: {
    underTest: { input_tokens: number; output_tokens: number };
    grader: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number };
  };
  estimatedCostUsd: number;
  cases: CaseResult[];
}
