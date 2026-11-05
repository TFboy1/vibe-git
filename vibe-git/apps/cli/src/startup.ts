import type { StartupCheck, StartupStatus, WorkspaceResources } from "@vibe-git/protocol";
import type { ClientConfig } from "./config.js";
import { api } from "./api.js";
import { collaborationPreference } from "./preferences.js";
import { inspectWorkspace } from "./local-workspace.js";
import { computeStatus } from "./agile-ai.js";

export async function startupStatus(config: ClientConfig | null, workspace = config?.workspace ?? process.cwd()): Promise<StartupStatus> {
  const preference = await collaborationPreference(workspace), project = await inspectWorkspace(workspace);
  let state: WorkspaceResources | null = null, connectionError = "尚未连接房间，请让 Codex 创建房间或使用队长邀请加入。";
  if (config && (process.platform === "win32" ? project.path.toLowerCase() === config.workspace.toLowerCase() : project.path === config.workspace)) {
    try { state = await api<WorkspaceResources>(config, "/api/v1/workspace/resources?names=members"); }
    catch (error) { connectionError = error instanceof Error ? error.message : String(error); }
  }
  const role = state?.data.viewer?.role ?? null;
  const checks: StartupCheck[] = [
    { key: "workspace", label: "项目绑定", ready: project.valid, required: true, detail: project.valid ? project.path : project.error ?? "项目目录不可用", path: "/settings#repository" },
    { key: "connection", label: "房间连接", ready: !!state, required: true, detail: state ? "已连接当前项目房间" : connectionError, path: "/" },
    { key: "role", label: "本人角色", ready: !!role, required: true, detail: role === "captain" ? "你是队长，可以整理并派发需求" : role === "member" ? "你是成员，可以继续本人任务" : "连接后自动识别，无需手动选择角色", path: "/settings#profile" },
    { key: "preference", label: "介入偏好", ready: preference.configured, required: false, detail: preference.configured ? preference.mode === "automatic" ? "偏自动" : "多人工介入" : "尚未选择，暂按多人工介入处理；查询进度不受影响", path: "/settings#preference" }
  ];
  if (role === "captain" && config) {
    const compute = computeStatus(config), provider = compute.provider;
    const ready = provider === "codex" ? (state?.data.auditPool?.available ?? 0) > 0 : compute.ready && compute.connection?.status === "passed";
    checks.push({ key: "ai", label: "AI 连接", ready, required: true, detail: ready ? "可以继续需求分析" : provider === "codex" ? "连接本机 Codex 并等待节点同步" : "补充 API 配置并测试连接", path: "/settings#compute" });
  }
  return { workspace: project.path, role, preference, checks, ready: checks.every(check => !check.required || check.ready) };
}
