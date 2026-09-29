import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { ClientConfig } from "../src/config.js";
import type { TaskRevisionDraftInput, V20BootstrapPayload } from "@vibe-git/protocol";
import { runStructuredJob } from "../src/agile-ai.js";
import { generateTaskRevisionDraft } from "../src/task-revision-draft.js";
import { startLocalPanel } from "../src/local-panel.js";

vi.mock("../src/agile-ai.js", async () => ({ ...await vi.importActual<typeof import("../src/agile-ai.js")>("../src/agile-ai.js"), runStructuredJob: vi.fn() }));
const config: ClientConfig = { hostUrl: "http://draft-host.test", nodeId: "captain", nodeToken: "fixture-node-token", workspace: "D:/fixture-project",
  daemonPid: null, workTransport: "auto", connectedAt: new Date().toISOString() };
const input: TaskRevisionDraftInput = { expectedRevision: 1, expectedRequirementRevision: 3, taskIds: ["task-1"], taskRevisions: { "task-1": 4 } };
function bootstrap(): V20BootstrapPayload {
  return { viewer: { id: "captain", role: "captain" }, room: { id: "fixture-room", requirementRevision: 3, currentRequirementMarkdown: "# 原需求\n提交伴学需求草案", seq: 1 },
    stages: [{ id: "stage-1", status: "ACTIVE", reviewId: null }],
    tasks: [{ id: "task-1", stageId: "stage-1", title: "伴学需求草案", revision: 4, goal: "说明教学流程", boundary: "本轮只交付需求文本", acceptance: ["教学流程完整"], assigneeNodeId: "captain", dependencies: [], status: "PUBLISHED" }],
    coordination: { changes: [{ id: "change-1", stageId: "stage-1", title: "补充变更闭环", content: "增加任务修订、差异预览与版本历史的需求说明", baseRequirementRevision: 3, revision: 1, status: "PENDING", taskIds: ["task-1"], contractIds: [], requirementRefs: [], affectedTaskIds: [],
      suggestion: { status: "READY", jobId: "old-job", error: null, taskRevisions: { "task-1": 4 }, findings: [{ taskId: "task-1", impact: "affected", reason: "需求规格增加变更闭环" }] } }], readiness: {}, intents: [] }
  } as unknown as V20BootstrapPayload;
}
const revised = () => ({ updates: [{ taskId: "task-1", update: { goal: "说明教学流程与任务变更闭环", boundary: "本轮只交付需求文本", acceptance: ["教学流程完整", "包含任务修订前后示例和版本历史规则"] } }] });
const networkFetch = globalThis.fetch;
let root: string;
beforeEach(async () => { root = await mkdtemp(resolve(tmpdir(), "vibe-task-revision-")); vi.stubEnv("VIBE_GIT_HOME", root); });
afterEach(async () => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks();
  if (!resolve(root).startsWith(resolve(tmpdir(), "vibe-task-revision-"))) throw new Error("Invalid fixture cleanup target");
  await rm(root, { recursive: true, force: true });
});
function serve(state: V20BootstrapPayload) {
  const fetch = vi.fn(async (..._args: unknown[]) => new Response(JSON.stringify(state)));
  vi.stubGlobal("fetch", fetch); return fetch;
}
describe("具体任务修订草稿", () => {
  it("旧影响建议没有 update 时，生成具体草稿但不发布需求或改动原任务", async () => {
    const state = bootstrap(), original = JSON.stringify(state), fetch = serve(state);
    vi.mocked(runStructuredJob).mockResolvedValue(revised());
    const result = await generateTaskRevisionDraft(config, "change-1", input);
    expect(result).toMatchObject({ changeId: "change-1", changeRevision: 1, requirementRevision: 3, taskRevisions: { "task-1": 4 }, updates: revised().updates });
    expect(JSON.stringify(state)).toBe(original);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetch.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect(url).toBe("http://draft-host.test/api/v1/bootstrap"); expect(init.method).toBeUndefined();
    }
    const [, provider, prompt] = vi.mocked(runStructuredJob).mock.calls[0]!;
    expect(provider).toBe("codex"); expect(prompt).toContain("说明教学流程"); expect(prompt).toContain("任务修订、差异预览与版本历史");
    expect(prompt).not.toContain(config.nodeToken);
  });
  it("采用队长本机选定的 API，返回内容不带配置凭据", async () => {
    serve(bootstrap()); vi.mocked(runStructuredJob).mockResolvedValue(revised());
    const local = { ...config, aiProvider: "api" as const, openaiApiKey: "fixture-private-api-key", openaiModel: "model-1" };
    const result = await generateTaskRevisionDraft(local, "change-1", input);
    expect(vi.mocked(runStructuredJob).mock.calls[0]![1]).toBe("api");
    expect(JSON.stringify(result)).not.toContain(local.openaiApiKey);
    expect(vi.mocked(runStructuredJob).mock.calls[0]![2]).not.toContain(local.openaiApiKey);
  });
  it("成员、过期提案、过期任务以及跨阶段任务不能启动生成", async () => {
    const cases: Array<(state: V20BootstrapPayload) => void> = [
      state => { state.viewer.role = "member"; }, state => { state.room.requirementRevision++; },
      state => { state.tasks[0]!.revision++; }, state => { state.tasks[0]!.stageId = "other-stage"; },
      state => { state.coordination!.changes[0]!.status = "APPLIED"; }
    ];
    for (const change of cases) { const state = bootstrap(); change(state); serve(state); await expect(generateTaskRevisionDraft(config, "change-1", input)).rejects.toThrow(); }
    expect(runStructuredJob).not.toHaveBeenCalled();
  });
  it("拒绝原文、空字段、漏任务、重复任务和不属于选择范围的修订", async () => {
    const old = bootstrap().tasks[0]!;
    const cases = [
      { updates: [{ taskId: "task-1", update: { goal: " " + old.goal + " ", boundary: old.boundary, acceptance: old.acceptance } }] },
      { updates: [{ taskId: "task-1", update: { ...revised().updates[0]!.update, goal: " " } }] },
      { updates: [] }, { updates: [...revised().updates, ...revised().updates] },
      { updates: [{ ...revised().updates[0]!, taskId: "other-task" }] },
      { updates: [{ taskId: "task-1", update: { goal: "new", boundary: "new", acceptance: [] } }] }
    ];
    for (const raw of cases) { serve(bootstrap()); vi.mocked(runStructuredJob).mockResolvedValue(raw); await expect(generateTaskRevisionDraft(config, "change-1", input)).rejects.toThrow(); }
  });
  it("生成期间任务或需求变化时拒绝旧结果，模型失败后可用同一份输入重试", async () => {
    const state = bootstrap(); serve(state);
    vi.mocked(runStructuredJob).mockImplementation(async () => { state.tasks[0]!.revision++; return revised(); });
    await expect(generateTaskRevisionDraft(config, "change-1", input)).rejects.toThrow("任务版本已变化");
    const stable = bootstrap(); serve(stable);
    vi.mocked(runStructuredJob).mockRejectedValueOnce(new Error("模型暂不可用")).mockResolvedValueOnce(revised());
    await expect(generateTaskRevisionDraft(config, "change-1", input)).rejects.toThrow("模型暂不可用");
    expect(await generateTaskRevisionDraft(config, "change-1", input)).toMatchObject({ updates: revised().updates });
    expect(stable.tasks[0]!.goal).toBe("说明教学流程"); expect(stable.room.requirementRevision).toBe(3);
  });
  it("本机修订接口要求有效会话与同源请求，成功只返回待审核草稿", async () => {
    const state = bootstrap(); vi.mocked(runStructuredJob).mockResolvedValue(revised());
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => String(url).startsWith(config.hostUrl) ? new Response(JSON.stringify(state)) : networkFetch(url, init)));
    const panel = await startLocalPanel({ ...config });
    try {
      const base = "http://127.0.0.1:" + panel.port, path = base + "/api/local/changes/change-1/revision-draft";
      expect((await fetch(path, { method: "POST", headers: { origin: base }, body: JSON.stringify(input) })).status).toBe(403);
      const ticket = await (await fetch(base + "/_local/ticket", { method: "POST", headers: { "x-vibe-git-control": config.nodeToken } })).json() as { url: string };
      const opened = await fetch(ticket.url, { redirect: "manual" }), cookie = opened.headers.get("set-cookie")!.split(";")[0]!;
      expect((await fetch(path, { method: "POST", headers: { cookie, origin: "https://other.test" }, body: JSON.stringify(input) })).status).toBe(403);
      const response = await fetch(path, { method: "POST", headers: { cookie, origin: base, "content-type": "application/json" }, body: JSON.stringify(input) });
      expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ updates: revised().updates, requirementRevision: 3 });
    } finally { await panel.close(); }
  });
});
