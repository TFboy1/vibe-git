import type { CollaborationPreference } from "./preferences.js";

export interface StartupCheck {
  key: "workspace" | "connection" | "role" | "preference" | "ai";
  label: string; ready: boolean; required: boolean; detail: string; path: string;
}
export interface StartupStatus { workspace: string; role: "captain" | "member" | null; preference: CollaborationPreference; ready: boolean; checks: StartupCheck[] }
export interface RecoveryAdvice { title: string; preserved: string; next: string; syncFirst: boolean }
export function recoveryAdvice(code?: string, status?: number): RecoveryAdvice {
  const preserved = "已保存的需求、任务和本机输入不会因本次请求失败而清空。";
  if (code === "WRITE_UNCERTAIN") return { title: "操作结果尚未确认", preserved: "本机输入已保留；远端操作可能已经生效。", next: "先同步实际状态；确认未生效后再重试，避免重复提交或派发。", syncFirst: true };
  if (code === "CANCELLED") return { title: "本次请求已取消", preserved, next: "可以继续查看状态；取消等待不代表远端作业已取消。", syncFirst: false };
  if (code === "REVISION_CONFLICT") return { title: "内容版本已变化", preserved, next: "先保存或导出本机草稿，再同步核对最新版本；新版内容需要重新审核。", syncFirst: true };
  if (status === 401 || status === 403 || code === "FORBIDDEN") return { title: "会话或操作权限不可用", preserved, next: "请让 Codex 重新核对连接与本人角色；队长操作应由队长执行。", syncFirst: true };
  if (code === "CAPABILITY_UNAVAILABLE") return { title: "AI 或协作服务暂不可用", preserved, next: "查看 AI 连接与执行节点状态，恢复连接后继续原流程。", syncFirst: true };
  if (code === "INVALID_STATE") return { title: "当前状态暂不能执行此操作", preserved, next: "同步任务状态，查看暂停原因、待处理需求或尚未完成的依赖。", syncFirst: true };
  if (code === "NETWORK_ERROR" || code === "TIMEOUT") return { title: "连接中断或响应超时", preserved, next: "恢复本机服务或网络后重新同步，无需重新创建房间。", syncFirst: true };
  return { title: "本次操作未完成", preserved, next: "根据具体原因修正输入或连接，再继续原流程。", syncFirst: false };
}
