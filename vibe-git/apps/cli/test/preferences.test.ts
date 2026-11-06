import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { collaborationPreference, saveCollaborationPreference } from "../src/preferences.js";
import { startLocalPanel } from "../src/local-panel.js";
import type { ClientConfig } from "../src/config.js";

let root: string | undefined;
const previousHome = process.env.VIBE_GIT_HOME;
afterEach(async () => {
  if (previousHome === undefined) delete process.env.VIBE_GIT_HOME; else process.env.VIBE_GIT_HOME = previousHome;
  if (root) {
    if (!root.startsWith(resolve(tmpdir(), "vibe-preference-"))) throw new Error("非法清理目录");
    await rm(root, { recursive: true, force: true }); root = undefined;
  }
});
it("未选择不自动授权；按本机用户和规范项目路径保存，重连与其他项目隔离", async () => {
  root = await mkdtemp(resolve(tmpdir(), "vibe-preference-")); process.env.VIBE_GIT_HOME = resolve(root, "user");
  const project = resolve(root, "project");
  expect(await collaborationPreference(project)).toEqual({ mode: "assisted", configured: false });
  await expect(saveCollaborationPreference(project, "yes")).rejects.toThrow();
  await saveCollaborationPreference(project, "automatic");
  expect(await collaborationPreference(resolve(project, "."))).toEqual({ mode: "automatic", configured: true });
  expect((await collaborationPreference(resolve(root, "other"))).configured).toBe(false);
  await saveCollaborationPreference(project, "assisted");
  expect(await collaborationPreference(project)).toEqual({ mode: "assisted", configured: true });
  process.env.VIBE_GIT_HOME = resolve(root, "other-user");
  expect((await collaborationPreference(project)).configured).toBe(false);
});
it("本机设置接口与 CLI 共享偏好，拒绝未登录、跨站和非法模式", async () => {
  root = await mkdtemp(resolve(tmpdir(), "vibe-preference-")); process.env.VIBE_GIT_HOME = resolve(root, "user");
  const config: ClientConfig = { hostUrl: "http://127.0.0.1:1", nodeId: "fixture", nodeToken: "fixture-only", workspace: resolve(root, "project"), workTransport: "auto", daemonPid: null, connectedAt: "now" };
  const panel = await startLocalPanel(config);
  const base = "http://127.0.0.1:" + panel.port;
  try {
    expect((await fetch(base + "/api/local/preference")).status).toBe(403);
    const ticket = await (await fetch(base + "/_local/ticket", { method: "POST", headers: { "x-vibe-git-control": config.nodeToken } })).json() as { url: string };
    const opened = await fetch(ticket.url, { redirect: "manual" });
    const cookie = opened.headers.get("set-cookie")!.split(";")[0]!;
    const put = (mode: string, origin = base) => fetch(base + "/api/local/preference", { method: "PUT", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ mode }) });
    expect((await put("automatic", "https://external.invalid")).status).toBe(403);
    expect((await put("invalid")).status).toBe(400);
    expect((await put("automatic")).status).toBe(200);
    expect(await collaborationPreference(config.workspace)).toEqual({ mode: "automatic", configured: true });
    await saveCollaborationPreference(config.workspace, "assisted");
    expect(await (await fetch(base + "/api/local/preference", { headers: { cookie } })).json()).toEqual({ mode: "assisted", configured: true });
  } finally { await panel.close(); }
});
