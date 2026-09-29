import type { MarkdownDocument, Notification, StageTask, StageTaskStatus } from "./v20.js";
import type { TaskExecutionPackage } from "./coordination.js";

export type AgileProvider = "codex" | "api";
export interface LocalComputeStatus {
  provider: AgileProvider; baseUrl: string; model: string; configured: boolean; ready: boolean;
  keySource: "local" | "environment" | "none";
  connection: { status: "passed" | "failed"; checkedAt: string; error?: string } | null;
}
export interface LocalCodexStatus {
  status: "available" | "connecting" | "login_required" | "unavailable";
  reason?: string; verificationUrl?: string; userCode?: string;
  rateLimits: import("./v20.js").RateLimitWindow[];
}
export type AgilePhase = "AGILE_ANALYZE" | "AGILE_DIALOGUE" | "AGILE_REQUIREMENT" | "AGILE_ALLOCATE";
export type AgileStatus = "ANALYZING" | "DECIDING" | "DRAFT" | "PLANNING" | "READY" | "PUBLISHED" | "FAILED" | "CANCELLED" | "REJECTED";
export interface AgileIssue {
  id: string; title: string; reason: string;
  evidence: Array<{ sourceId: string; excerpt: string }>;
  options: [AgileOption, AgileOption, AgileOption];
  answer: { kind: "option"; optionId: string } | { kind: "custom"; text: string } | null;
}
export interface AgileOption { id: string; label: string; impact: string }
export interface AgileDecision { changeId: string; verdict: "accept" | "reject"; rationale: string }
export interface AgileTaskDraft {
  key: string; sourceTaskId: string | null; title: string; goal: string; boundary: string;
  acceptance: string[]; assigneeNodeId: string; dependencies: string[];
  ownedPaths: string[]; excludedPaths: string[]; requirementRefs: string[];
}
export interface AgileDraftVersion { revision: number; markdown: string; editorNodeId: string; createdAt: string }
export interface AgileFlow {
  id: string; kind: "initial" | "review"; status: AgileStatus; phase: AgilePhase; revision: number;
  baseRequirementRevision: number; baseRequirementMarkdown: string; stageId: string | null;
  stageSnapshot?: { status: import("./v20.js").DevelopmentStage["status"]; completedAt: string | null };
  participantNodeIds: string[]; planSnapshot: MarkdownDocument[];
  changeSnapshot: Array<{ id: string; submitterNodeId: string; baseRequirementRevision: number; document: MarkdownDocument;
    source?: "agile_pr" | "legacy_pr" | "legacy_change"; sourceRevision?: number; title?: string;
    taskIds?: string[]; contractIds?: string[]; requirementRefs?: string[] }>;
  taskSnapshot: StageTask[]; taskDigests: Record<string, string>;
  issues: AgileIssue[]; decisions: AgileDecision[]; affectedTaskIds: string[];
  pausedTaskStates: Record<string, StageTaskStatus>;
  pausedTaskReasons: Record<string, string | null>;
  summary: string; draftMarkdown: string; draftRevision: number; draftHistory: AgileDraftVersion[];
  tasks: AgileTaskDraft[]; removedTaskIds: string[]; allocationDraftRevision: number | null;
  agentJobId: string | null; error: string | null; publishedRequirementRevision: number | null;
  createdAt: string; updatedAt: string;
}
export interface AgileSnapshot {
  enabled: boolean; compute: { provider: AgileProvider; executorNodeId: string | null };
  batchReviewEnabled?: boolean;
  flows: AgileFlow[]; activeFlow: AgileFlow | null; archivedTasks: StageTask[];
}
export interface AgileTaskReport {
  reportId: string; taskRevision: number; requirementRevision: number;
  action: "started" | "progress" | "blocked" | "completed";
  summary: string; evidence?: string[];
}
export interface AgileInbox {
  requirementRevision: number; notifications: Notification[];
  tasks: Array<{ task: StageTask; package: TaskExecutionPackage }>;
  instructions: string;
}

const str = { type: "string" };
const strings = { type: "array", items: str };
const object = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const option = object({ id: str, label: str, impact: str });
const issue = object({ id: str, title: str, reason: str,
  evidence: { type: "array", items: object({ sourceId: str, excerpt: str }) },
  options: { type: "array", minItems: 3, maxItems: 3, items: option } });
export const AGILE_OUTPUT_SCHEMAS: Record<AgilePhase, Record<string, unknown>> = {
  AGILE_ANALYZE: object({ summary: str, affectedTaskIds: strings,
    decisions: { type: "array", items: object({ changeId: str, verdict: { type: "string", enum: ["accept", "reject"] }, rationale: str }) },
    issues: { type: "array", items: issue } }),
  AGILE_DIALOGUE: object({ summary: str, followUp: { anyOf: [issue, { type: "null" }] } }),
  AGILE_REQUIREMENT: object({ markdown: str, summary: str }),
  AGILE_ALLOCATE: object({ summary: str, removedTaskIds: strings, tasks: { type: "array", items: object({
    key: str, sourceTaskId: { type: ["string", "null"] }, title: str, goal: str, boundary: str,
    acceptance: strings, assigneeNodeId: str, dependencies: strings, ownedPaths: strings, excludedPaths: strings, requirementRefs: strings
  }) } })
};

// Model runners and the Host both validate structured output before use.
export function assertJsonSchema(value: unknown, schema: Record<string, unknown>, path = "result"): void {
  if (Array.isArray(schema.anyOf)) {
    for (const candidate of schema.anyOf) { try { assertJsonSchema(value, candidate as Record<string, unknown>, path); return; } catch { /* another branch */ } }
    throw new Error(`${path} 不符合输出结构`);
  }
  const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (schema.type && !types.includes(actual)) throw new Error(`${path} 类型无效`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) throw new Error(`${path} 选项无效`);
  if (actual === "object") {
    const record = value as Record<string, unknown>, props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    for (const key of (schema.required ?? []) as string[]) if (!(key in record)) throw new Error(`${path}.${key} 缺失`);
    for (const [key, item] of Object.entries(record)) {
      if (!props[key] && schema.additionalProperties === false) throw new Error(`${path}.${key} 为未知字段`);
      if (props[key]) assertJsonSchema(item, props[key], `${path}.${key}`);
    }
  }
  if (actual === "array") {
    const list = value as unknown[];
    if ((typeof schema.minItems === "number" && list.length < schema.minItems) || (typeof schema.maxItems === "number" && list.length > schema.maxItems)) throw new Error(`${path} 数量无效`);
    for (let i = 0; i < list.length; i++) if (schema.items) assertJsonSchema(list[i], schema.items as Record<string, unknown>, `${path}[${i}]`);
  }
}
