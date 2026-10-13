import { resolve } from "node:path";
import type { LocalProjects, V20BootstrapPayload } from "@vibe-git/protocol";
import { api, post } from "./api.js";
import { readJson, saveConfig, vibeHome, writeJson, hostProcessPath, type ClientConfig } from "./config.js";
import { assertProjectWorkspacePath, inspectWorkspace, startupWorkspace } from "./local-workspace.js";
import { startHost, stopHost, startTunnel, type HostProcess } from "./host-process.js";
interface SavedProject { path: string; name: string; roomId: string; role: "captain" | "member"; config: ClientConfig; host?: HostProcess }
const projectsPath = () => resolve(vibeHome(), "projects.json");
const pathKey = (path: string) => process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
export async function savedProjectConnection(roomId: string): Promise<ClientConfig | null> {
  const saved = (await readJson<SavedProject[]>(projectsPath()) ?? []).find(project => project.roomId === roomId);
  return saved ? { ...saved.config } : null;
}
let profileWrite: Promise<unknown> = Promise.resolve();
export async function rememberProject(config: ClientConfig, data: Pick<V20BootstrapPayload, "room" | "viewer">): Promise<SavedProject> {
  config = { ...config };
  const write = profileWrite.then(async () => {
  const projects = await readJson<SavedProject[]>(projectsPath()) ?? [];
  const candidate = data.viewer.role === "captain" ? await readJson<HostProcess>(hostProcessPath()) : null;
  const host = candidate && (!candidate.roomId || candidate.roomId === data.room.id) ? candidate : projects.find(project => project.roomId === data.room.id)?.host;
  const path = host?.workspace ?? config.workspace;
  const project: SavedProject = { path, name: (await inspectWorkspace(path)).name, roomId: data.room.id,
    role: data.viewer.role, config: { ...config, daemonPid: null }, ...(host ? { host } : {}) };
  await writeJson(projectsPath(), [project, ...projects.filter(p => p.roomId !== project.roomId)]);
  return project;
  });
  profileWrite = write.catch(() => undefined);
  return write;
}
export function projectController(config: ClientConfig, controls: { busy(): string | null; beforeSwitch(): Promise<void>; changed(): Promise<void> },
  lifecycle = { startHost, stopHost, startTunnel }) {
  let switching = false;
  const snapshot = () => api<V20BootstrapPayload>(config, "/api/v1/bootstrap");
  const list = async (): Promise<LocalProjects> => {
    const connection = { ...config };
    const current = await rememberProject(connection, await api<V20BootstrapPayload>(connection, "/api/v1/bootstrap"));
    const projects = await readJson<SavedProject[]>(projectsPath()) ?? [];
    const visible = projects.map(p => ({ path: p.path, name: p.name, roomId: p.roomId, role: p.role, current: p.roomId === current.roomId }));
    return { current: visible.find(p => p.current)!, projects: visible };
  };
  return {
    isSwitching: () => switching, list,
    async select(path: string, expectedRoomId: string) {
      if (switching) throw new Error("项目正在切换");
      if (controls.busy()) throw new Error("本机 AI 作业正在执行，请结束后再切换项目");
      switching = true;
      const previous = { ...config };
      let old: SavedProject | undefined, prepared = false, stopped = false, nextConfig: ClientConfig | undefined;
      try {
        await controls.beforeSwitch();
        const data = await snapshot();
        if (data.room.id !== expectedRoomId) throw new Error("当前项目已变化，请刷新后重试");
        old = await rememberProject(config, data);
        const targetPath = assertProjectWorkspacePath(path);
        if (pathKey(targetPath) === pathKey(old.path)) return { ...(await list()), warning: null };
        const saved = (await readJson<SavedProject[]>(projectsPath()) ?? []).find(p => pathKey(p.path) === pathKey(targetPath));
        if (old.role !== "captain" && !saved) throw new Error("成员只能切换已连接的项目，请先使用队长的邀请命令连接");
        if (saved?.role === "member") await api(saved.config, "/api/v1/bootstrap");
        const selected = await startupWorkspace(saved?.config.workspace ?? targetPath);
        if (old.role === "captain") { await post(config, "/api/v1/local/project-switch/prepare"); prepared = true; }
        if (controls.busy()) throw new Error("本机刚接到新作业，请结束后再切换");
        if (old.role === "captain") { await lifecycle.stopHost(previous); stopped = true; }
        let next: ClientConfig;
        if (saved?.role === "member") next = { ...saved.config };
        else { next = (await lifecycle.startHost(selected.path, saved?.config, saved?.host?.dataRoot ?? resolve(targetPath, ".vibe-git/host"))).config; nextConfig = next; }
        next.daemonPid = previous.daemonPid;
        const targetData = await api<V20BootstrapPayload>(next, "/api/v1/bootstrap");
        await saveConfig(next);
        for (const key of Object.keys(config)) delete (config as unknown as Record<string, unknown>)[key];
        Object.assign(config, next);
        await rememberProject(config, targetData);
        await controls.changed();
        const warning = targetData.viewer.role === "captain" ? await lifecycle.startTunnel(config) : null;
        return { ...(await list()), warning };
      } catch (error) {
        if (nextConfig) await lifecycle.stopHost(nextConfig).catch(() => undefined);
        if (stopped && old) {
          const restored = await lifecycle.startHost(old.host?.workspace ?? old.path, previous, old.host?.dataRoot);
          Object.assign(previous, restored.config, { workspace: previous.workspace, daemonPid: previous.daemonPid });
        }
        for (const key of Object.keys(config)) delete (config as unknown as Record<string, unknown>)[key];
        Object.assign(config, previous); await saveConfig(previous);
        if (prepared && !stopped) await post(config, "/api/v1/local/project-switch/cancel").catch(() => undefined);
        if (stopped && old) await lifecycle.startTunnel(config);
        await controls.changed().catch(() => undefined);
        throw new Error((error instanceof Error ? error.message : String(error)) + "；原项目已恢复");
      } finally { switching = false; }
    }
  };
}
