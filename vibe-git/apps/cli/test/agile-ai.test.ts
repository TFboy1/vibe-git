import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { computeStatus, responsesUrl, runResponses, runStructuredJob, saveCompute, savePanelCompute, testCompute } from "../src/agile-ai.js";
import { handleAgileCommand, waitForAgile } from "../src/agile-command.js";
import { loadConfig, type ClientConfig } from "../src/config.js";
import { runAudit } from "../src/codex.js";
vi.mock("../src/codex.js", () => ({ runAudit: vi.fn() }));
const config: ClientConfig = { hostUrl: "http://host.test", nodeId: "captain", nodeToken: "test-node-token", workspace: "D:/test-project",
  daemonPid: null, workTransport: "auto", connectedAt: new Date().toISOString(), openaiApiKey: "x", openaiBaseUrl: "https://proxy.test/custom/", openaiModel: "provider/model" };
const schema = { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean", enum: [true] } } };
const completed = { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: '{"ok":true}' }] }] };
let root: string;
beforeEach(async () => { root = await mkdtemp(resolve(tmpdir(), "vibe-ai-")); vi.stubEnv("VIBE_GIT_HOME", root); });
afterEach(async () => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks();
  if (!resolve(root).startsWith(resolve(tmpdir(), "vibe-ai-"))) throw new Error("Invalid cleanup target");
  await rm(root, { recursive: true, force: true });
});
describe("原生 Responses 协作算力", () => {
  it("只追加 /responses，不自动补 /v1，兼容模型名和短 Key", async () => {
    expect(responsesUrl("https://proxy.test/custom///")).toBe("https://proxy.test/custom/responses");
    expect(responsesUrl("http://127.0.0.1:9000")).toBe("http://127.0.0.1:9000/responses");
    expect(() => responsesUrl("https://key@proxy.test/v1")).toThrow();
    expect(() => responsesUrl("https://proxy.test/v1/responses")).toThrow();
    const fetch = vi.fn(async (..._args: unknown[]) => new Response(JSON.stringify(completed), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    expect(await runResponses(config, "test", schema)).toEqual({ ok: true });
    const [url, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://proxy.test/custom/responses"); expect((init.headers as Record<string, string>).authorization).toBe("Bearer x");
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "provider/model", store: false, stream: true, text: { format: { type: "json_schema", strict: true } } });
  });
  it("支持 SSE 结果，拒绝提前结束、无效 JSON 和不符合 schema 的结果", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("data: " + JSON.stringify({ type: "response.output_text.delta", delta: '{"ok":true}' }) + "\n\n" +
      "data: " + JSON.stringify({ type: "response.completed", response: completed }) + "\n\n", { headers: { "content-type": "text/event-stream" } })));
    expect(await runResponses(config, "test", schema)).toEqual({ ok: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response('data: {"type":"response.output_text.delta","delta":"{}"}\n\n', { headers: { "content-type": "text/event-stream" } })));
    await expect(runResponses(config, "test", schema)).rejects.toThrow("提前结束");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ output_text: "not json" }))));
    await expect(runResponses(config, "test", schema)).rejects.toThrow("有效 JSON");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ output_text: '{"ok":false}' }))));
    await expect(runResponses(config, "test", schema)).rejects.toThrow("选项无效");
  });
  it("连接测试覆盖原生协议与结构化输出，错误信息及状态不回显 Key", async () => {
    const secret = "test-private-api-key", testConfig = { ...config, openaiApiKey: secret };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(completed))));
    expect(await testCompute(testConfig)).toMatchObject({ ok: true, model: "provider/model" });
    expect(JSON.stringify(computeStatus(testConfig))).not.toContain(secret);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "invalid Bearer " + secret } }), { status: 401 })));
    try { await runResponses(testConfig, "test", schema); throw new Error("Expected failure"); } catch (error) {
      expect(String(error)).toContain("401"); expect(String(error)).not.toContain(secret);
    }
  });
  it("Codex 和 API 使用同一结构化执行入口", async () => {
    vi.mocked(runAudit).mockResolvedValue({ ok: true });
    expect(await runStructuredJob(config, "codex", "prompt", schema)).toEqual({ ok: true });
    expect(runAudit).toHaveBeenCalledOnce();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(completed))));
    expect(await runStructuredJob(config, "api", "prompt", schema)).toEqual({ ok: true });
    expect(runAudit).toHaveBeenCalledOnce();
  });
  it("配置仅保存在队长本机，查询不含 Key，成员不能保存", async () => {
    const local = { ...config };
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"viewer":{"role":"captain"}}')));
    const result = await saveCompute(local, { provider: "api", apiKey: "tiny", model: "vendor/new-model", baseUrl: "https://proxy.test/v2" });
    expect(result).toMatchObject({ provider: "api", configured: true, baseUrl: "https://proxy.test/v2", model: "vendor/new-model" });
    expect(JSON.stringify(result)).not.toContain("tiny"); expect(local.openaiApiKey).toBe("tiny");
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"viewer":{"role":"member"}}')));
    await expect(saveCompute(local, { provider: "api", apiKey: "other" })).rejects.toThrow("队长");
    expect(local.openaiApiKey).toBe("tiny");
  });
  it("Codex 设置不受空 API 模型和地址影响，也不会清空已保存的 API 配置", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"viewer":{"role":"captain"}}')));
    const local = { ...config, aiProvider: "api" as const };
    const result = await saveCompute(local, { provider: "codex", model: "", baseUrl: "" });
    expect(result.provider).toBe("codex");
    expect(local.openaiModel).toBe(config.openaiModel); expect(local.openaiBaseUrl).toBe(config.openaiBaseUrl);
    expect(local.openaiApiKey).toBe(config.openaiApiKey);
    const fresh: ClientConfig = { ...config };
    delete fresh.openaiApiKey; delete fresh.openaiModel; delete fresh.openaiBaseUrl;
    expect(await saveCompute(fresh, { provider: "codex", model: "" })).toMatchObject({ provider: "codex", ready: false });
    await expect(saveCompute(fresh, { provider: "api", model: "", apiKey: "x" })).rejects.toThrow("模型名称");
  });
  it("旧 Host 不调用不存在的 agile 接口，支持批量审核的历史房间也同步算力", async () => {
    const local = { ...config }, changed = vi.fn(async () => undefined);
    const legacyFetch = vi.fn(async () => new Response('{"viewer":{"role":"captain"}}'));
    vi.stubGlobal("fetch", legacyFetch);
    expect(await savePanelCompute(local, { provider: "codex" }, changed)).toMatchObject({ provider: "codex" });
    expect(changed).toHaveBeenCalledOnce();
    expect(legacyFetch.mock.calls.every(call => !String((call as unknown[])[0]).includes("/agile/"))).toBe(true);
    const modernFetch = vi.fn(async (..._args: unknown[]) => new Response('{"viewer":{"role":"captain"},"agile":{"enabled":true}}'));
    vi.stubGlobal("fetch", modernFetch);
    await savePanelCompute(local, { provider: "api" }, changed);
    const [url, init] = modernFetch.mock.calls.at(-1)! as unknown as [string, RequestInit];
    expect(url).toBe("http://host.test/api/v1/agile/compute");
    expect(init.method).toBe("PUT"); expect(JSON.parse(String(init.body))).toEqual({ provider: "api" });
    const upgradedFetch = vi.fn(async (..._args: unknown[]) => new Response('{"viewer":{"role":"captain"},"agile":{"enabled":false,"batchReviewEnabled":true}}'));
    vi.stubGlobal("fetch", upgradedFetch);
    await savePanelCompute(local, { provider: "api" }, changed);
    expect(String((upgradedFetch.mock.calls.at(-1)! as unknown[])[0])).toBe("http://host.test/api/v1/agile/compute");
  });
  it("API 连接测试状态可恢复，切换 Codex 保留状态，修改 API 配置则使旧测试失效", async () => {
    const local: ClientConfig = { ...config, aiProvider: "api" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(completed))));
    await testCompute(local);
    expect(computeStatus(local).connection).toMatchObject({ status: "passed" });
    expect(computeStatus((await loadConfig())!).connection?.status).toBe("passed");
    expect(JSON.stringify(computeStatus(local))).not.toContain("signature");
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"viewer":{"role":"captain"}}')));
    await saveCompute(local, { provider: "codex" });
    expect(computeStatus(local).connection?.status).toBe("passed");
    await saveCompute(local, { provider: "api", model: "changed-model" });
    expect(computeStatus(local).connection).toBeNull();
    expect((await loadConfig())?.apiConnection).toBeUndefined();
  });
  it("失败的连接测试记录脱敏原因，测试中修改配置不会写入旧连接结果", async () => {
    const secret = "connection-private-key", local: ClientConfig = { ...config, openaiApiKey: secret };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "invalid Bearer " + secret } }), { status: 401 })));
    await expect(testCompute(local)).rejects.toThrow("401");
    expect(computeStatus(local).connection).toMatchObject({ status: "failed" });
    expect(JSON.stringify(computeStatus(local))).not.toContain(secret);
    expect(JSON.stringify((await loadConfig())?.apiConnection)).not.toContain(secret);
    let finish!: (response: Response) => void;
    const newer: ClientConfig = { ...config };
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    const testing = testCompute(newer);
    newer.openaiModel = "new-model-during-test";
    finish(new Response(JSON.stringify(completed)));
    await expect(testing).rejects.toThrow("配置已变化");
    expect(newer.apiConnection).toBeUndefined();
  });
  it("task report 不给旧结果自动补填新版本，task inbox 读取真实状态", async () => {
    const path = resolve(root, "report.json");
    await writeFile(path, JSON.stringify({ reportId: "r1", taskRevision: 1, requirementRevision: 1, action: "completed", summary: "old", evidence: ["passed"] }), "utf8");
    const fetch = vi.fn(async (..._args: unknown[]) => new Response('{"ok":true}')); vi.stubGlobal("fetch", fetch);
    const bootstrap = async () => ({ config, data: { room: { requirementRevision: 2 }, agile: { enabled: true } } as never });
    const out = vi.fn();
    expect(await handleAgileCommand(["task", "report", "task-1", path], bootstrap, out)).toBe(true);
    const [, request] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toMatchObject({ taskRevision: 1, requirementRevision: 1 });
    expect(await handleAgileCommand(["task", "inbox"], bootstrap, out)).toBe(true);
    expect(fetch.mock.calls[1]![0]).toContain("/agile/inbox");
  });
  it("CLI 批量审核传递队长选中的多个 PR，不替换为全部待审记录", async () => {
    const fetch = vi.fn(async (..._args: unknown[]) => new Response('{"ok":true}')); vi.stubGlobal("fetch", fetch);
    const bootstrap = async () => ({ config, data: { room: { requirementRevision: 3 }, agile: { enabled: false, batchReviewEnabled: true } } as never });
    await handleAgileCommand(["agile", "review", "CHANGE-a", "PR-b"], bootstrap, vi.fn());
    const [url, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("http://host.test/api/v1/agile/reviews");
    expect(JSON.parse(String(init.body))).toEqual({ expectedRequirementRevision: 3, changeIds: ["CHANGE-a", "PR-b"] });
  });
  it("agile wait 用 SSE 阻塞至流程需要操作，不进行周期性查询", async () => {
    let bootstrapCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/events")) return new Response('data: {"entityId":"flow-1"}\n\n', { headers: { "content-type": "text/event-stream" } });
      bootstrapCalls++;
      return new Response(JSON.stringify({ room: { seq: 9 }, agile: { flows: [{ id: "flow-1", status: bootstrapCalls === 1 ? "ANALYZING" : "DECIDING" }] } }));
    }));
    expect((await waitForAgile(config, "flow-1", 2)).status).toBe("DECIDING"); expect(bootstrapCalls).toBe(2);
  });
});
