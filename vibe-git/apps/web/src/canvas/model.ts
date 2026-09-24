import type {
  CollaborationNode,
  ProjectWorkPackage,
  V20BootstrapPayload,
} from "@vibe-git/protocol";
export type CanvasMode = "topology" | "gantt";
export type InspectorTarget = {
  type: "member" | "module" | "package" | "task" | "change" | "project";
  id: string;
  tab?: string | undefined;
};
export const labels: Record<string, string> = {
  planned: "待开始",
  in_progress: "进行中",
  blocked: "受阻",
  done: "已完成",
  PUBLISHED: "已发布",
  READY: "已就绪",
  DRAFT: "草稿",
  REFINING: "细化中",
  STARTING: "准备开工",
  IN_PROGRESS: "进行中",
  PREPARING_MOCK: "准备接口替身",
  WAITING_INTEGRATION: "待集成",
  WAITING_CONFIRMATION: "待确认",
  PAUSED: "已暂停",
  BLOCKED: "受阻",
  FAILED: "失败",
  DONE: "已完成",
  QUEUED: "待审核",
  IN_REVIEW: "审核中",
  APPLIED: "已应用",
  REJECTED: "已退回",
  ACTIVE: "进行中",
  COMPLETED: "已完成",
  RUNNING: "处理中",
  NEEDS_DECISION: "待裁决",
  AWAITING_CAPTAIN: "待队长处理",
  NEEDS_EVIDENCE: "待补证",
  CANCELLED: "已取消",
  REVIEWING: "审核中",
  AWAITING_APPLY: "待应用",
};
export const label = (status: string) => labels[status] ?? status;
export const liveTasks = (data: V20BootstrapPayload) => {
  const stage =
    [...data.stages].reverse().find((s) => s.status !== "COMPLETED") ??
    data.stages.at(-1);
  return data.tasks.filter(
    (t) => !t.archived && (!stage || t.stageId === stage.id),
  );
};
export function derivePackageParticipants(
  pack: ProjectWorkPackage,
  data: V20BootstrapPayload,
) {
  const owners = new Set(
    liveTasks(data)
      .filter((t) => pack.taskIds.includes(t.id))
      .map((t) => t.assigneeNodeId),
  );
  return data.nodes.filter((n) => !n.revoked && owners.has(n.id));
}
export function derivePackageProgress(
  pack: ProjectWorkPackage,
  data: V20BootstrapPayload,
) {
  const tasks = liveTasks(data).filter((t) => pack.taskIds.includes(t.id));
  const done = tasks.filter((t) => t.status === "DONE").length;
  return {
    tasks,
    done,
    total: tasks.length,
    percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
  };
}
export function deriveMemberVisualState(
  node: CollaborationNode,
  data: V20BootstrapPayload,
  seen: Set<string>,
) {
  const tasks = liveTasks(data).filter((t) => t.assigneeNodeId === node.id);
  const changes = data.pullRequests.filter(
    (p) =>
      p.submitterNodeId === node.id &&
      ["QUEUED", "IN_REVIEW"].includes(p.status),
  );
  if (data.viewer.role === "captain" && changes.some((c) => !seen.has(c.id)))
    return {
      tone: "change",
      text: "需求变更",
      pulse:
        data.viewer.role === "captain" && changes.some((c) => !seen.has(c.id)),
    };
  if (tasks.some((t) => ["BLOCKED", "PAUSED", "FAILED"].includes(t.status)))
    return { tone: "blocked", text: "需要处理", pulse: false };
  if (
    tasks.some((t) =>
      ["STARTING", "IN_PROGRESS", "PREPARING_MOCK"].includes(t.status),
    )
  )
    return { tone: "running", text: "进行中", pulse: false };
  if (
    tasks.some((t) =>
      ["WAITING_CONFIRMATION", "WAITING_INTEGRATION"].includes(t.status),
    )
  )
    return { tone: "waiting", text: "等待确认", pulse: false };
  if (tasks.length && tasks.every((t) => t.status === "DONE"))
    return { tone: "done", text: "全部完成", pulse: false };
  return { tone: "idle", text: "待开始", pulse: false };
}
export function deriveTopologyLayout(
  data: V20BootstrapPayload,
  pack?: ProjectWorkPackage,
  maxColumns = 4,
) {
  const people = [...data.nodes]
    .filter((n) => !n.revoked)
    .sort((a, b) =>
      a.role === b.role
        ? a.id.localeCompare(b.id)
        : a.role === "captain"
          ? -1
          : 1,
    );
  const inside = pack
    ? new Set(derivePackageParticipants(pack, data).map((n) => n.id))
    : new Set<string>();
  const count = inside.size,
    cols = Math.min(maxColumns, count <= 3 ? Math.max(1, count) : count <= 6 ? 3 : 4),
    width = Math.max(320, cols * 228 + 56),
    height = Math.max(1, Math.ceil(count / cols)) * 144 + 154;
  let inner = 0,
    outer = 0;
  return {
    width,
    height,
    positions: people.map((n, index) => {
      if (pack && inside.has(n.id)) {
        const i = inner++;
        return {
          id: n.id,
          x: (width - cols * 228 + 32) / 2 + (i % cols) * 228,
          y: 146 + Math.floor(i / cols) * 144,
          inside: true,
        };
      }
      if (pack) {
        const i = outer++;
        return {
          id: n.id,
          x: i % 2 === 0 ? -260 : width + 64,
          y: Math.floor(i / 2) * 160 + 30,
          inside: false,
        };
      }
      const ring = Math.floor(index / 6),
        angle = ((index % 6) * Math.PI * 2) / Math.min(6, people.length - ring * 6) - Math.PI / 2;
      return {
        id: n.id,
        x: Math.cos(angle) * (330 + ring * 245),
        y: Math.sin(angle) * (220 + ring * 155),
        inside: false,
      };
    }),
  };
}
export function deriveUnreadActivity(
  data: V20BootstrapPayload,
  read: Set<string>,
) {
  return data.notifications.filter((n) => !n.readAt && !read.has(n.id));
}
export interface GanttRow {
  id: string;
  key: string;
  type: "module" | "package" | "task";
  name: string;
  depth: number;
  status: string;
  start: string | null;
  end: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  percent: number;
  owner: string;
  parent?: string;
}
export function deriveGanttRows(data: V20BootstrapPayload): GanttRow[] {
  const rows: GanttRow[] = [];
  const assigned = new Set<string>();
  for (const m of data.modules) {
    const tasks = liveTasks(data).filter((t) =>
      m.packages.some((p) => p.taskIds.includes(t.id)),
    );
    rows.push({
      key: m.id,
      id: m.id,
      type: "module",
      name: m.name,
      depth: 0,
      status: m.status,
      start: m.plannedStart,
      end: m.plannedEnd,
      percent: tasks.length
        ? Math.round(
            (tasks.filter((t) => t.status === "DONE").length / tasks.length) *
              100,
          )
        : 0,
      owner: "",
    });
    for (const p of m.packages) {
      const progress = derivePackageProgress(p, data);
      rows.push({
        key: p.id,
        id: p.id,
        type: "package",
        parent: m.id,
        name: p.name,
        depth: 1,
        status: p.status,
        start: p.plannedStart,
        end: p.plannedEnd,
        percent: progress.percent,
        owner: derivePackageParticipants(p, data)
          .map((n) => n.label)
          .join("、"),
      });
      for (const t of progress.tasks) {
        assigned.add(t.id);
        rows.push({
          key: `${p.id}:${t.id}`,
          id: t.id,
          type: "task",
          parent: p.id,
          name: t.title,
          depth: 2,
          status: t.status,
          start: p.plannedStart,
          end: p.plannedEnd,
          actualStart: t.startedAt,
          actualEnd: t.doneAt ?? t.finishedAt,
          percent: t.status === "DONE" ? 100 : 0,
          owner: data.nodes.find((n) => n.id === t.assigneeNodeId)?.label ?? "",
        });
      }
    }
  }
  for (const t of liveTasks(data).filter((t) => !assigned.has(t.id)))
    rows.push({
      key: t.id,
      id: t.id,
      type: "task",
      name: t.title,
      depth: 0,
      status: t.status,
      start: null,
      end: null,
      actualStart: t.startedAt,
      actualEnd: t.doneAt ?? t.finishedAt,
      percent: t.status === "DONE" ? 100 : 0,
      owner: data.nodes.find((n) => n.id === t.assigneeNodeId)?.label ?? "",
    });
  return rows;
}
export function codexState(node: CollaborationNode) {
  return (
    (node as CollaborationNode & { codex?: string }).codex ?? node.workCodex
  );
}
