import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startupStatus } from "../src/startup.js";
import { saveCollaborationPreference } from "../src/preferences.js";
import { api } from "../src/api.js";
import { recoveryAdvice } from "@vibe-git/protocol";
import type { ClientConfig } from "../src/config.js";

vi.mock("../src/local-workspace.js", () => ({ inspectWorkspace: vi.fn(async (path: string) => ({ path, valid: true })) }));
const previous = process.env.VIBE_GIT_HOME;
let root: string, config: ClientConfig;
beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), "vibe-startup-")); process.env.VIBE_GIT_HOME = resolve(root, "user");
  config = { hostUrl: "http://fixture.invalid", nodeId: "fixture", nodeToken: "fixture-only", workspace: resolve(root, "project"), workTransport: "auto", daemonPid: null, connectedAt: "now" };
});
afterEach(async () => {
  vi.unstubAllGlobals();
  if (previous === undefined) delete process.env.VIBE_GIT_HOME; else process.env.VIBE_GIT_HOME = previous;
  if (!root.startsWith(resolve(tmpdir(), "vibe-startup-"))) throw new Error("Unsafe cleanup");
  await rm(root, { recursive: true, force: true });
});
function connected(role: "captain" | "member", available = 0) {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ roomId: "room", seq: 1, data: { viewer: { id: config.nodeId, role }, auditPool: { available } } })));
  vi.stubGlobal("fetch", fetch); return fetch;
}
it("成员只检查本人使用条件，未选择偏好不阻止查询，也不创建或启动作业", async () => {
  const fetch = connected("member");
  const status = await startupStatus(config);
  expect(status.ready).toBe(true); expect(status.preference).toEqual({ mode: "assisted", configured: false });
  expect(status.checks.some(check => check.key === "ai")).toBe(false);
  expect(fetch.mock.calls).toHaveLength(1);
});
it("队长检查 AI 就绪，偏好跨调用保留；结果不包含凭据", async () => {
  connected("captain"); expect((await startupStatus(config)).ready).toBe(false);
  await saveCollaborationPreference(config.workspace, "automatic");
  connected("captain", 1);
  const status = await startupStatus(config);
  expect(status.ready).toBe(true); expect(status.preference.mode).toBe("automatic");
  expect(JSON.stringify(status)).not.toContain(config.nodeToken);
});
it("未连接或服务失联时返回可恢复条件，不擅自初始化房间", async () => {
  const fetch = vi.fn(async () => { throw new TypeError("offline"); }); vi.stubGlobal("fetch", fetch);
  expect((await startupStatus(null, config.workspace)).checks.find(check => check.key === "connection")!.ready).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
  const status = await startupStatus(config); expect(status.ready).toBe(false); expect(status.role).toBeNull();
});
it("写入后断线只报告未知结果，不自动重发；读取错误和版本冲突给出对应恢复步骤", async () => {
  const fetch = vi.fn(async () => { throw new TypeError("connection lost after commit"); }); vi.stubGlobal("fetch", fetch);
  await expect(api(config, "/write", { method: "POST", body: "{}" })).rejects.toMatchObject({ code: "WRITE_UNCERTAIN" });
  expect(fetch).toHaveBeenCalledTimes(1);
  await expect(api(config, "/read")).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  expect(recoveryAdvice("WRITE_UNCERTAIN")).toMatchObject({ syncFirst: true });
  expect(recoveryAdvice("REVISION_CONFLICT").next).toContain("核对最新版本");
  expect(recoveryAdvice(undefined, 403).next).toContain("角色");
});
