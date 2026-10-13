import type { CollaborationNode, StageTask } from "@vibe-git/protocol";

export const taskStatus: Record<string, string> = {
  DRAFT: "草稿", PUBLISHED: "待开发", REFINING: "细化中", READY: "已就绪", STARTING: "准备开工",
  PREPARING_MOCK: "准备接口", IN_PROGRESS: "进行中", WAITING_INTEGRATION: "待集成",
  WAITING_CONFIRMATION: "待审核", PAUSED: "已请求暂停", BLOCKED: "受阻", DONE: "已完成", FAILED: "失败"
};

export function taskNextStep(task: StageTask, tasks: StageTask[], name: (id: string) => string) {
  if (task.archived) return "此任务已归档，原目标与验证记录保留。";
  if (task.status === "PAUSED" || task.pauseRequested) return "已请求暂停。开发 AI 在下一次 Skill 同步时读取消息，等待新版任务包后继续。";
  if (task.status === "DONE") return "验收证据已保留。需要返工时会创建关联后续任务，代码 PR 继续按仓库流程审查。";
  const unfinished = task.dependencies.map(id => ({ id, task: tasks.find(item => item.id === id) })).filter(item => item.task?.status !== "DONE");
  if (unfinished.length) return "等待前置任务：" + unfinished.map(item => item.task ? item.task.title + "（" + name(item.task.assigneeNodeId) + "）" : item.id).join("、");
  if (task.blockedReason) return task.blockedReason;
  if (task.status === "WAITING_CONFIRMATION") return "历史任务等待负责人核对并确认完成，请让开发 AI 调用 Skill 检查执行流程。";
  return task.status === "IN_PROGRESS" ? "继续当前任务；通过 Skill 同步需求修订，并汇报进度、阻塞或完成。" : "打开任务，复制指令给开发 AI。Skill 会先同步最新任务包，再按目标、边界和验收执行。";
}

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
