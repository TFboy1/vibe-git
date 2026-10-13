import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { workspaceChanges } from "@vibe-git/protocol";
import type { AgileFlow, LocalComputeStatus, LocalCodexStatus, LocalProjects, MarkdownDocument, RoomEvent, StageTask, V20BootstrapPayload } from "@vibe-git/protocol";
import { request } from "./api";
import { taskNextStep } from "./team";

export interface LocalProject {
  name: string; path: string; branch: string; headSha: string; dirty: boolean; valid: boolean; error?: string; runningTask: string | null;
}

export const useWorkspace = defineStore("workspace", () => {
  const data = ref<V20BootstrapPayload | null>(null), ready = ref(false), local = ref(false), connected = ref(false);
  const project = ref<LocalProject | null>(null), projectError = ref(""), chatAvailable = ref(false);
  const connections = ref<LocalProjects | null>(null);
  const error = ref(""), notice = ref(""), pending = ref(0);
  const projectSwitching = ref(false), activities = ref<RoomEvent[]>([]), activityError = ref(""), moreActivities = ref(false);
  const draftSavers = new Set<() => Promise<boolean>>();
  const compute = ref<LocalComputeStatus | null>(null), computeError = ref(""), codex = ref<LocalCodexStatus | null>(null);
  const captain = computed(() => data.value?.viewer.role === "captain");
  const canManage = computed(() => captain.value && local.value);
  const agileEnabled = computed(() => data.value?.agile?.enabled === true);
  const batchReviewEnabled = computed(() => agileEnabled.value || data.value?.agile?.batchReviewEnabled === true);
  const flow = computed(() => data.value?.agile?.activeFlow ?? null);
  const activityFlow = computed(() => flow.value ?? data.value?.agile?.flows.at(-1) ?? null);
  async function loadActivities(older = false) {
    const current = activityFlow.value, roomId = data.value?.room.id;
    if (!current) return;
    try {
      const result = await request<{ events: RoomEvent[]; hasMore: boolean }>("/api/v1/agile/flows/" + current.id + "/activity" + (older && activities.value[0] ? "?before=" + activities.value[0].seq : ""));
      if (roomId !== data.value?.room.id || current.id !== activityFlow.value?.id) return;
      activities.value = [...new Map([...result.events, ...activities.value].map(event => [event.seq, event])).values()].sort((a, b) => a.seq - b.seq);
      moreActivities.value = result.hasMore; activityError.value = "";
    } catch (e) { activityError.value = e instanceof Error ? e.message : String(e); }
  }
  watch(() => [data.value?.room.id, activityFlow.value?.id], () => { activities.value = []; moreActivities.value = false; if (activityFlow.value) void loadActivities(); });
  function registerDraftSaver(save: () => Promise<boolean>) { draftSavers.add(save); return () => draftSavers.delete(save); }
  async function saveProjectDrafts(): Promise<boolean> {
    if (busy.value) { error.value = "当前操作尚未完成，请稍后切换"; return false; }
    for (const save of draftSavers) if (!(await save())) return false;
    if (planDraftDirty.value && planDraft.value.trim() && !(await submitPlan())) return false;
    return true;
  }
  function assignmentBlocker(task: StageTask): string {
    if (task.archived || task.status === "DONE") return "已完成或归档任务不能改派";
    if (data.value?.stages.some(stage => stage.id === task.stageId && stage.reviewId) ||
      data.value?.agile?.flows.some(flow => !["PUBLISHED", "CANCELLED", "REJECTED"].includes(flow.status) && task.id in flow.taskDigests)) return "任务正在需求审核中，请先完成或取消审核";
    return "";
  }
  const changes = computed(() => data.value ? workspaceChanges(data.value) : []);
  const pendingChanges = computed(() => changes.value.filter(change => ["PENDING", "QUEUED"].includes(change.status)));
  const reviewStage = computed(() => [...(data.value?.stages ?? [])].reverse().find(stage => stage.status !== "COMPLETED") ?? data.value?.stages.at(-1));
  const pendingPRs = computed(() => pendingChanges.value.filter(change => change.stageId === reviewStage.value?.id && !change.reviewId));
  const busy = computed(() => pending.value > 0 || projectSwitching.value);
  const provider = computed(() => captain.value && local.value && compute.value ? compute.value.provider : data.value?.agile?.compute.provider ?? "codex");
  const computeLabel = computed(() => {
    if (captain.value && local.value && computeError.value) return "连接状态读取失败";
    if (provider.value === "codex") return (data.value?.auditPool.available ?? 0) > 0 ? "Codex 已连接 · " + data.value!.auditPool.available + " 个可用节点" : "Codex 尚未就绪";
    if (!captain.value || !local.value) return data.value?.nodes.some(node => node.role === "captain" && node.connected && node.apiReady) ? "API 已配置 · 队长本机在线" : "API 等待队长本机连接";
    if (!compute.value?.ready) return "API 配置待补全";
    if (compute.value.connection?.status === "passed") return "API 连接测试通过";
    if (compute.value.connection?.status === "failed") return "API 连接测试失败";
    return "API 已配置 · 待测试连接";
  });
  const computeAvailable = computed(() => provider.value === "codex" ? (data.value?.auditPool.available ?? 0) > 0 :
    captain.value && local.value ? compute.value?.ready && compute.value.connection?.status === "passed" : data.value?.nodes.some(node => node.role === "captain" && node.connected && node.apiReady));
  const ownPlan = computed(() => data.value?.plans.find(plan => plan.ownerNodeId === data.value?.viewer.id));
  const planDraft = ref(""), planDraftBase = ref(""), planDraftRevision = ref(0);
  const planDraftDirty = computed(() => planDraft.value.trim() !== planDraftBase.value.trim());
  const planDraftConflict = computed(() => planDraftDirty.value && planDraftRevision.value !== (ownPlan.value?.revision ?? 0));
  let planKey = "";
  function resetPlanDraft() {
    planDraft.value = planDraftBase.value = ownPlan.value?.content ?? ""; planDraftRevision.value = ownPlan.value?.revision ?? 0;
    try { localStorage.removeItem(planKey); } catch { /* Server content remains available. */ }
  }
  watch(() => [data.value?.room.id, data.value?.viewer.id, ownPlan.value?.revision] as const, ([room, viewer]) => {
    if (!room || !viewer) return;
    const key = "vibe-plan:" + room + ":" + viewer;
    if (key === planKey) {
      if (!planDraftDirty.value) { planDraft.value = planDraftBase.value = ownPlan.value?.content ?? ""; planDraftRevision.value = ownPlan.value?.revision ?? 0; }
      return;
    }
    planKey = key;
    let cached: string | null = null; try { cached = localStorage.getItem(key); } catch { /* Private mode. */ }
    planDraft.value = planDraftBase.value = ownPlan.value?.content ?? ""; planDraftRevision.value = ownPlan.value?.revision ?? 0;
    if (cached) {
      let content = cached, revision = ownPlan.value ? -1 : 0;
      try {
        const saved = JSON.parse(cached);
        if (saved?.type === "plan-draft" && typeof saved.content === "string" && Number.isInteger(saved.revision) && saved.revision >= -1) {
          content = saved.content; revision = saved.revision;
        }
      } catch { /* Restore drafts written by the previous plain-text editor. */ }
      if (content.trim() !== planDraftBase.value.trim()) {
        planDraft.value = content; planDraftRevision.value = revision;
        editPlanDraft(content);
      }
    }
  });
  function editPlanDraft(content: string) {
    planDraft.value = content;
    try { localStorage.setItem(planKey, JSON.stringify({ type: "plan-draft", content, revision: planDraftRevision.value })); } catch { /* Keep the draft in memory. */ }
  }
  const integrationBlocker = computed(() => {
    if (!canManage.value) return "请在队长电脑运行 vibe-git open，进入可操作的工作台。";
    if (flow.value) return "已有进行中的需求整合或审核，请先完成或取消本轮。";
    if (!data.value?.room.requirementRevision && !agileEnabled.value) return "历史房间首轮仍使用 vibe-git align start；可以先提交想法。";
    if (data.value?.room.requirementRevision && !data.value.agile?.planIntegrationEnabled) return "协作服务需要更新后才能整合本轮想法。";
    if (data.value?.room.requirementRevision && !reviewStage.value) return "当前没有可更新的需求阶段。";
    if (reviewStage.value?.reviewId || ["REVIEWING", "AWAITING_APPLY"].includes(reviewStage.value?.status ?? "")) return "当前阶段已有审核，请先完成或取消。";
    if (planDraftConflict.value) return "本机草稿与已提交版本不同，请先导出草稿并核对已提交内容。";
    if (planDraftDirty.value && !planDraft.value.trim()) return "目标或想法为空，请填写内容或恢复已提交内容。";
    if (!planDraft.value.trim() && !data.value?.plans.length) return "先简述一个目标，或导入已有 Markdown。";
    if (!computeAvailable.value) return "协作算力尚未就绪，请在设置中配置后继续。";
    return "";
  });
  const myTasks = computed(() => (data.value?.tasks ?? []).filter(task => !task.archived && task.assigneeNodeId === data.value?.viewer.id && task.status !== "DONE")
    .sort((a, b) => Number(b.status === "PAUSED") - Number(a.status === "PAUSED") || Number(b.status === "IN_PROGRESS") - Number(a.status === "IN_PROGRESS")));
  const nextAction = computed(() => {
    const current = flow.value, flowPath = current?.kind === "review" ? "/issues" : "/requirements";
    if (!captain.value) {
      const task = myTasks.value[0];
      if (task) return { title: task.title, body: taskNextStep(task, data.value?.tasks ?? [], name), path: "/projects?view=packages&task=" + encodeURIComponent(task.id), label: "查看我的任务" };
      const leader = data.value?.nodes.find(node => node.role === "captain");
      const done = data.value?.tasks.some(task => task.assigneeNodeId === data.value?.viewer.id && task.status === "DONE");
      return { title: done ? "本轮任务已完成" : "等待" + (leader?.label ?? "队长") + "派发任务", body: current ? "队长正在" + (current.kind === "review" ? "审核需求变更" : "整理需求与分工") + "，发布后你的任务会自动出现。" : done ? "验收证据已保留；后续变更需要返工时会创建关联任务。" : "可以按需补充想法，也可以直接等待任务，无需提交个人计划。", path: current ? flowPath : "/requirements", label: "查看团队需求" };
    }
    if (current) {
      if (current.status === "FAILED") return { title: "本次分析需要重试", body: current.error ?? "回答与草稿已保留，请进入原流程继续。", path: flowPath, label: "处理失败" };
      if (current.status === "DECIDING") return { title: "有待确认的需求问题", body: "比较各方案的取舍，选择一个或写下自己的决定。", path: flowPath, label: "继续确认" };
      if (current.status === "DRAFT") return { title: "需求草稿已就绪", body: "审核正文，再生成分工；正式需求与任务包将在最后一起发布。", path: "/requirements", label: "审核需求" };
      if (current.status === "READY") return { title: "分工已就绪，等待你发布", body: "检查负责人、目标、边界与验收，一次发布需求和任务包。", path: "/projects", label: "审核并发布" };
      return { title: current.status === "PLANNING" ? "AI 正在生成分工" : "AI 正在整理需求", body: "已提交的内容与决定会保留，可以稍后回到当前流程。", path: flowPath, label: "查看进度" };
    }
    if (!data.value?.room.requirementRevision) return { title: "从一个目标开始", body: "简述希望解决的问题，AI 会用选择题补齐关键需求。成员可以按需补充想法。", path: "/requirements", label: "创建需求" };
    if (pendingChanges.value.length) return { title: pendingChanges.value.length + " 项需求变更待审核", body: "选择本轮要处理的变更，统一分析影响并形成新版需求。", path: "/issues", label: "处理需求变更" };
    return { title: "团队正在按正式需求开发", body: "查看任务进度、依赖和阻碍；需要调整目标时提交需求变更。", path: "/projects", label: "查看团队任务" };
  });
  let events: EventSource | null = null, refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshPromise: Promise<void> | null = null, refreshAgain = false;
  async function refresh(): Promise<void> {
    if (refreshPromise) { refreshAgain = true; return refreshPromise; }
    refreshPromise = (async () => {
      do {
        refreshAgain = false;
        const received = await request<V20BootstrapPayload>("/api/v1/bootstrap");
        if (projectSwitching.value) return;
        if (data.value && data.value.room.id !== received.room.id) { window.location.replace("/"); return; }
        data.value = received;
        if (local.value && captain.value) await refreshCompute();
      } while (refreshAgain);
    })();
    try { await refreshPromise; } finally { refreshPromise = null; }
  }
  async function start() {
    stop();
    try {
      await refresh();
      try { const capabilities = await request<{ local: boolean; chat: boolean }>("/api/local/capabilities"); local.value = capabilities.local; chatAvailable.value = capabilities.chat; }
      catch { local.value = false; chatAvailable.value = false; }
      if (local.value) await refreshProject();
      if (local.value) { try { connections.value = await request<LocalProjects>("/api/local/projects"); } catch { /* older local panels still display the working directory */ } }
      if (local.value && captain.value) await refreshCompute();
      ready.value = true;
      events = new EventSource("/api/v1/events?since=" + data.value!.room.seq);
      events.onopen = () => { connected.value = true; void refresh().catch(() => undefined); };
      events.onerror = () => { connected.value = false; };
      events.onmessage = event => {
        try {
          const value = JSON.parse(event.data) as RoomEvent;
          if (projectSwitching.value) return;
          if (data.value) data.value.room.seq = value.seq;
          const payload = value.payload as { flowId?: string };
          if (payload?.flowId === activityFlow.value?.id || (value.entityType === "agile" && value.entityId === activityFlow.value?.id)) {
            activities.value = [...new Map([...activities.value, value].map(item => [item.seq, item])).values()].sort((a, b) => a.seq - b.seq);
          }
          if (value.type === "job.progress") return;
          clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => void refresh().catch(e => { error.value = message(e); }), 100);
        } catch { /* reconnect will restore a full snapshot */ }
      };
    } catch (e) { error.value = message(e); ready.value = true; }
  }
  async function refreshProject() {
    try { project.value = await request<LocalProject>("/api/local/workspace"); projectError.value = ""; }
    catch (e) { projectError.value = message(e); }
  }
  async function refreshCompute(includeCodex = false) {
    try { compute.value = await request<LocalComputeStatus>("/api/local/compute"); computeError.value = ""; }
    catch (e) { computeError.value = message(e); }
    if (includeCodex) {
      try {
        codex.value = await request<LocalCodexStatus>("/api/local/codex");
        const capabilities = await request<{ chat: boolean }>("/api/local/capabilities"); chatAvailable.value = capabilities.chat;
      }
      catch (e) { computeError.value = message(e); }
    }
  }
  function stop() { events?.close(); events = null; clearTimeout(refreshTimer); }
  function message(e: unknown) { return e instanceof Error ? e.message : String(e); }
  async function perform<T>(work: () => Promise<T>, success = ""): Promise<T | null> {
    pending.value++; error.value = "";
    try {
      const result = await work();
      await refresh();
      if (success) notice.value = success;
      return result;
    } catch (e) { error.value = message(e); return null; }
    finally { pending.value--; }
  }
  const mutate = <T = AgileFlow>(path: string, body: unknown, success = "", method = "POST") =>
    perform(() => request<T>(path, body, method), success);
  async function submitPlan() {
    if (!local.value || !planDraft.value.trim() || busy.value) return null;
    if (planDraftConflict.value) { error.value = "已提交内容发生变化。请先导出本机草稿，再核对或恢复已提交内容。"; return null; }
    const plan = ownPlan.value, sent = planDraft.value;
    const path = agileEnabled.value ? "/api/v1/agile/plan" : plan ? "/api/v1/plans/" + encodeURIComponent(plan.id) : "/api/v1/plans";
    const saved = await mutate<MarkdownDocument>(path, { expectedRevision: planDraftRevision.value, content: sent, filename: plan?.filename ?? "plan.md" }, "目标或想法已提交", agileEnabled.value || plan ? "PUT" : "POST");
    if (saved) {
      planDraftBase.value = saved.content; planDraftRevision.value = saved.revision;
      if (planDraft.value === sent) {
        planDraft.value = saved.content;
        try { const cached = localStorage.getItem(planKey); if (cached && JSON.parse(cached)?.content === sent) localStorage.removeItem(planKey); } catch { /* Keep drafts from other windows. */ }
      }
      else editPlanDraft(planDraft.value);
    }
    return saved;
  }
  async function startRequirement() {
    if (busy.value || integrationBlocker.value) return null;
    if (planDraftDirty.value && !(await submitPlan())) return null;
    return mutate<AgileFlow>(data.value?.agile?.planIntegrationEnabled ? "/api/v1/agile/plan-integrations" : "/api/v1/agile/initial",
      { expectedRequirementRevision: data.value?.room.requirementRevision ?? 0 }, "输入已保存，AI 正在补齐需求与分析冲突");
  }
  function checkRequirementDraft(value: AgileFlow): boolean {
    try {
      const raw = localStorage.getItem("vibe-requirement:" + data.value?.room.id + ":" + value.id);
      const saved = raw ? JSON.parse(raw) as { markdown?: unknown } : null;
      if (saved && typeof saved.markdown === "string" && saved.markdown !== value.draftMarkdown) {
        error.value = "需求文档还有本机未保存的修改。请先到需求页保存并核对，再生成分工或发布任务。"; return false;
      }
    } catch { /* Server revisions remain authoritative when local storage is unavailable. */ }
    return true;
  }
  async function generateAllocation() {
    const current = flow.value;
    if (!canManage.value || !current || current.status !== "DRAFT" || !checkRequirementDraft(current)) return null;
    return mutate("/api/v1/agile/flows/" + current.id + "/allocate", { expectedRevision: current.revision }, "AI 正在生成分工，完成后可在任务页审核并发布");
  }
  function name(id: string) { return data.value?.nodes.find(n => n.id === id)?.label ?? id.slice(-6); }
  return { data, ready, local, connected, error, notice, captain, canManage, agileEnabled, batchReviewEnabled, reviewStage, flow, changes, pendingChanges, pendingPRs, busy,
    projectSwitching, activityFlow, activities, activityError, moreActivities, loadActivities, assignmentBlocker, registerDraftSaver, saveProjectDrafts,
    project, connections, projectError, chatAvailable, refreshProject, compute, codex, computeError, provider, computeLabel, computeAvailable, refreshCompute, start, stop, refresh, perform, mutate, checkRequirementDraft, generateAllocation, name,
    ownPlan, planDraft, planDraftDirty, planDraftConflict, editPlanDraft, resetPlanDraft, submitPlan, startRequirement, integrationBlocker, myTasks, nextAction };
});
