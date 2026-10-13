import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig, saveConfig, hostProcessPath, writeJson, type ClientConfig } from "../src/config.js";
import { ensureGitWorkspace } from "../src/local-workspace.js";
import { projectController, rememberProject, savedProjectConnection } from "../src/projects.js";
import { api, post } from "../src/api.js";
const { buildApp } = await import(new URL("../../host/dist/app.js", import.meta.url).href);
const { ensureV20Runtime } = await import(new URL("../../host/dist/v20/runtime-secrets.js", import.meta.url).href);
import type { V20BootstrapPayload } from "@vibe-git/protocol";
let root: string;
beforeEach(async () => { root = await mkdtemp(resolve(tmpdir(), "vibe-projects-")); vi.stubEnv("VIBE_GIT_HOME", resolve(root, "settings")); });
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); if (!resolve(root).startsWith(resolve(tmpdir(), "vibe-projects-"))) throw new Error("Invalid cleanup target"); await rm(root, { recursive: true, force: true }); });
async function setup() {
  const first = (await ensureGitWorkspace(resolve(root, "first"))).path;
  const config: ClientConfig = { hostUrl: "http://127.0.0.1:8787", nodeId: "node-first", nodeToken: "token-first", workspace: first, daemonPid: 123,
    connectedAt: "initial", workTransport: "auto", openaiApiKey: "private-old-key", openaiModel: "api-old" };
  const data = (value: ClientConfig) => ({ room: { id: "room-" + value.nodeId, requirementRevision: 2, currentRequirementMarkdown: "原需求", seq: 0 },
    viewer: { id: value.nodeId, role: value.nodeId.startsWith("member") ? "member" : "captain", label: "队长" } }) as V20BootstrapPayload;
  const configs = new Map([[config.nodeToken, { ...config }]]);
  let blocked = false;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const token = (init?.headers as Record<string, string>)?.authorization?.slice(7), current = configs.get(token ?? "");
    if (!current) return new Response('{"error":"身份无效"}', { status: 403 });
    if (_url.endsWith("/prepare") && blocked) return new Response('{"error":"仍有未结束作业"}', { status: 409 });
    return new Response(JSON.stringify(data(current)), { headers: { "content-type": "application/json" } });
  }));
  const info = (path: string, roomId: string) => ({ pid: 456, hostUrl: config.hostUrl, startedAt: "now", root, workspace: path, dataRoot: resolve(path, ".vibe-git/host"), roomId });
  await saveConfig(config); await writeJson(hostProcessPath(), info(first, data(config).room.id)); await rememberProject(config, data(config));
  const lifecycle = {
    startHost: vi.fn(async (path: string, previous?: ClientConfig | null, _dataRoot?: string) => {
      const next = previous ? { ...previous, daemonPid: null } : { ...config, nodeId: "node-" + basename(path), nodeToken: "token-" + basename(path), workspace: path, daemonPid: null };
      if (!previous) { delete next.openaiApiKey; delete next.openaiModel; }
      configs.set(next.nodeToken, next);
      const host = info(path, data(next).room.id); await writeJson(hostProcessPath(), host);
      return { config: next, info: host, roomId: data(next).room.id };
    }),
    stopHost: vi.fn(async (_config: ClientConfig | null) => { await rm(hostProcessPath(), { force: true }); }),
    startTunnel: vi.fn(async (_config: ClientConfig) => null)
  };
  const controls = { busy: vi.fn((): string | null => null), beforeSwitch: vi.fn(async (): Promise<void> => undefined), changed: vi.fn(async (): Promise<void> => undefined) };
  return { config, data, configs, lifecycle, controls, controller: projectController(config, controls, lifecycle), block: () => { blocked = true; } };
}
describe("独立项目连接", () => {
  it("切换新项目并切回，恢复原身份和 API 配置，返回值不暴露凭据", async () => {
    const { config, data, lifecycle, controller } = await setup(), before = { ...config };
    const next = await controller.select(resolve(root, "second"), data(config).room.id);
    expect(next.projects).toHaveLength(2); expect(config.nodeId).toBe("node-second"); expect(config.openaiApiKey).toBeUndefined(); expect(config.daemonPid).toBe(123);
    expect(JSON.stringify(next)).not.toContain("token-first"); expect(JSON.stringify(next)).not.toContain("private-old-key");
    await controller.select(before.workspace, data(config).room.id);
    expect(config).toMatchObject(before); expect(await loadConfig()).toMatchObject(before);
    expect(lifecycle.stopHost).toHaveBeenCalledTimes(2);
    expect((await savedProjectConnection(data(before).room.id))?.nodeToken).toBe(before.nodeToken);
  }, 20000);
  it("新项目启动失败时恢复旧服务、身份和配置", async () => {
    const { config, data, lifecycle, controller } = await setup(), before = { ...config };
    lifecycle.startHost.mockRejectedValueOnce(new Error("测试启动失败"));
    await expect(controller.select(resolve(root, "failed"), data(config).room.id)).rejects.toThrow("原项目已恢复");
    expect(config).toMatchObject(before); expect(await loadConfig()).toMatchObject(before);
    expect(lifecycle.startHost).toHaveBeenLastCalledWith(before.workspace, before, resolve(before.workspace, ".vibe-git/host"));
  });
  it("运行作业、过期项目标识和非法目录都不会停止旧服务", async () => {
    const { config, data, lifecycle, controller, controls, block } = await setup();
    controls.busy.mockReturnValueOnce("test-job");
    await expect(controller.select(resolve(root, "next"), data(config).room.id)).rejects.toThrow("正在执行");
    await expect(controller.select(resolve(root, "next"), "wrong-room")).rejects.toThrow("已变化");
    await expect(controller.select(resolve(root, "..", "..", "..", ".."), data(config).room.id)).rejects.toThrow();
    block(); await expect(controller.select(resolve(root, "next"), data(config).room.id)).rejects.toThrow("未结束作业");
    expect(lifecycle.stopHost).not.toHaveBeenCalled();
  });
  it("切换互斥，失败恢复连接后允许再次切换", async () => {
    const { config, data, controller, controls } = await setup();
    let release!: () => void;
    controls.beforeSwitch.mockImplementationOnce(() => new Promise<void>(done => { release = done; }));
    const switching = controller.select(resolve(root, "second"), data(config).room.id);
    await expect(controller.select(resolve(root, "third"), data(config).room.id)).rejects.toThrow("正在切换");
    release(); await switching; expect(controller.isSwitching()).toBe(false);
  });
  it("成员不能通过新目录创建队长房间", async () => {
    const { config, data, configs, lifecycle, controls } = await setup();
    config.nodeId = "member-first"; configs.set(config.nodeToken, config);
    const controller = projectController(config, controls, lifecycle);
    await expect(controller.select(resolve(root, "unjoined"), data(config).room.id)).rejects.toThrow("已连接");
    expect(lifecycle.startHost).not.toHaveBeenCalled();
  });
  it("迟到的旧项目读取不能把新身份写进旧连接记录", async () => {
    const { config, data, controller } = await setup(), before = { ...config };
    const original = globalThis.fetch;
    let release!: () => void, delayed = false;
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      if (!delayed && input.endsWith("/bootstrap")) { delayed = true; await new Promise<void>(done => { release = done; }); }
      return original(input, init);
    });
    const listing = controller.list();
    await controller.select(resolve(root, "second"), data(config).room.id);
    release(); await listing;
    expect((await savedProjectConnection(data(before).room.id))?.nodeToken).toBe(before.nodeToken);
    expect((await savedProjectConnection(data(config).room.id))?.nodeToken).toBe(config.nodeToken);
  }, 20000);
  it("真实 HTTP 与 SQLite 房间切换后内容隔离，切回恢复原计划与节点", async () => {
    let current: Awaited<ReturnType<typeof buildApp>> | undefined;
    const lifecycle = {
      async startHost(path: string, _previous?: ClientConfig | null, dataRoot = resolve(path, ".vibe-git/host")) {
        const dataDir = resolve(dataRoot, "v20");
        current = await buildApp({ dbPath: resolve(dataRoot, "workspace.db"), dataDir, backupDatabase: false,
          cloudflareManager: { status: async () => null, close: async () => undefined } as never });
        const url = await current.listen({ host: "127.0.0.1", port: 0 });
        const service = current.v20Service, runtime = await ensureV20Runtime(service.repo, dataDir);
        const config: ClientConfig = { hostUrl: url, nodeId: runtime.captain.nodeId, nodeToken: runtime.captain.nodeToken, workspace: path, daemonPid: null, workTransport: "auto", connectedAt: "now" };
        const info = { hostUrl: url, pid: process.pid, root, workspace: path, dataRoot, roomId: runtime.captain.roomId, startedAt: "now" };
        await writeJson(hostProcessPath(), info);
        return { config, info, roomId: runtime.captain.roomId };
      },
      async stopHost(_config: ClientConfig | null) { await current?.close(); current = undefined; await rm(hostProcessPath(), { force: true }); },
      async startTunnel(_config: ClientConfig) { return null; }
    };
    try {
      const path = (await ensureGitWorkspace(resolve(root, "real-first"))).path;
      const { config, roomId } = await lifecycle.startHost(path), originalNodeId = config.nodeId;
      await saveConfig(config); await api(config, "/api/v1/agile/plan", { method: "PUT", body: JSON.stringify({ expectedRevision: 0, content: "原项目目标", filename: "goal.md" }) });
      const controller = projectController(config, { busy: () => null, beforeSwitch: async () => undefined, changed: async () => undefined }, lifecycle);
      await controller.select(resolve(root, "real-second"), roomId);
      const second = await api<V20BootstrapPayload>(config, "/api/v1/bootstrap");
      expect(second.room.id).not.toBe(roomId); expect(second.plans).toHaveLength(0);
      await controller.select(path, second.room.id);
      const restored = await api<V20BootstrapPayload>(config, "/api/v1/bootstrap");
      expect(restored.room.id).toBe(roomId); expect(config.nodeId).toBe(originalNodeId); expect(restored.plans[0]?.content).toBe("原项目目标");
    } finally { await current?.close(); }
  }, 20000);
});
