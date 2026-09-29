import type { CollaborationNode, StageTask } from "@vibe-git/protocol";

export const taskStatus: Record<string, string> = {
  DRAFT: "草稿", PUBLISHED: "待开发", REFINING: "细化中", READY: "已就绪", STARTING: "准备开工",
  PREPARING_MOCK: "准备接口", IN_PROGRESS: "进行中", WAITING_INTEGRATION: "待集成",
  WAITING_CONFIRMATION: "待审核", PAUSED: "已暂停", BLOCKED: "受阻", DONE: "已完成", FAILED: "失败"
};

export function currentWork(node: CollaborationNode, tasks: StageTask[]) {
  const owned = tasks.filter(task => task.assigneeNodeId === node.id && !task.archived);
  const task = owned.find(item => item.id === node.currentTaskId) ??
    owned.find(item => item.status === "IN_PROGRESS") ?? owned.find(item => ["BLOCKED", "PAUSED"].includes(item.status)) ??
    owned.find(item => item.status !== "DONE") ?? [...owned].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return { task, owned, done: owned.filter(item => item.status === "DONE").length,
    summary: task?.blockedReason || task?.progressSummary || task?.title || "等待分配任务" };
}

export function relativeTime(value: string | null | undefined) {
  if (!value) return "尚未同步";
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return "尚未同步";
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return Math.floor(seconds / 60) + " 分钟前";
  if (seconds < 86400) return Math.floor(seconds / 3600) + " 小时前";
  return Math.floor(seconds / 86400) + " 天前";
}
