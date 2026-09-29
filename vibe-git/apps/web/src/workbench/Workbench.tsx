import { useEffect, useState } from "react";
import { ArrowRight, ChevronDown, Plus, Search } from "lucide-react";
import type { StageTask, V20BootstrapPayload } from "@vibe-git/protocol";
import { coordinationApi } from "../api";
import { Markdown } from "../Markdown";
import { liveTasks, type InspectorTarget } from "../canvas/model";
import { TaskPanel, taskLabel } from "./TaskPanel";
import { IntentComposer } from "./IntentComposer";
import { PlanEditor } from "./PlanEditor";
import { ChangeComposer, ChangePanel } from "./ChangePanel";
import { TaskChangePublisher } from "./TaskChangePublisher";
import { Empty, Feedback, Sheet, useAction } from "./shared";

const getPanel = () => new URLSearchParams(location.search).get("item") ?? "";
const storageGet = (key: string, fallback: string) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
export function Workbench({ data, local, connected, refresh, view, openLegacy }: { data: V20BootstrapPayload; local: boolean; connected: boolean;
  refresh: () => Promise<void>; view: "workbench" | "changes"; openLegacy: (target: InspectorTarget) => void;
}) {
  const captain = data.viewer.role === "captain", scopeKey = `vibe-git:task-scope:${data.room.id}:${data.viewer.id}`;
  const [scope, setScope] = useState(() => storageGet(scopeKey, captain ? "all" : "mine"));
  const [query, setQuery] = useState(""), [panel, setPanel] = useState(getPanel), [doneOpen, setDoneOpen] = useState(false);
  const [changeFilter, setChangeFilter] = useState(captain ? "pending" : "mine");
  const action = useAction(refresh), writable = local && connected;
  const coordination = data.coordination, tasks = liveTasks(data);
  const activeStage = [...data.stages].reverse().find(stage => stage.status !== "COMPLETED");
  const currentStage = activeStage ?? data.stages.at(-1);
  const currentIntent = coordination?.intents.find(intent => intent.publishedStageId === currentStage?.id);
  const intents = (coordination?.intents ?? []).filter(intent => !intent.publishedStageId).slice().reverse();
  const pendingTaskChanges = (coordination?.changes ?? []).filter(change => change.status === "PENDING" && change.stageId === activeStage?.id).slice().reverse();
  const title = currentIntent?.title ?? currentStage?.requirementMarkdown.match(/^#\s+(.+)$/m)?.[1] ?? "当前需求";
  const switchScope = (value: string) => { setScope(value); try { localStorage.setItem(scopeKey, value); } catch {} };
  const navigate = (next: string, replace = false) => {
    setPanel(next); const url = new URL(location.href); if (next) url.searchParams.set("item", next); else url.searchParams.delete("item");
    if (replace) history.replaceState(null, "", url); else history.pushState(null, "", url);
  };
  useEffect(() => { const pop = () => setPanel(getPanel()); window.addEventListener("popstate", pop); return () => window.removeEventListener("popstate", pop); }, []);
  useEffect(() => { setPanel(getPanel()); }, [view]);
  const close = () => navigate("");
  const pendingContract = (task: StageTask) => task.assigneeNodeId === data.viewer.id && data.contracts.some(contract => contract.stageId === task.stageId && contract.status === "DRAFT" &&
    (contract.providerTaskId === task.id || contract.consumerTaskIds.includes(task.id)) && !contract.acknowledgedNodeIds.includes(data.viewer.id));
  const group = (task: StageTask) => {
    if (task.status === "DONE") return "已完成";
    if (task.assigneeNodeId === data.viewer.id && (task.pendingChangeId || task.status === "WAITING_CONFIRMATION" || task.status === "WAITING_INTEGRATION" || pendingContract(task))) return "待我处理";
    if (coordination?.readiness[task.id]?.readyForOwner) return "可开工";
    if (["STARTING", "PREPARING_MOCK", "IN_PROGRESS"].includes(task.status) && !task.pendingChangeId) return "进行中";
    return "等待";
  };
  const visible = tasks.filter(task => (scope === "all" || task.assigneeNodeId === data.viewer.id) && task.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const counts = { ready: tasks.filter(task => group(task) === "可开工").length, running: tasks.filter(task => ["IN_PROGRESS", "STARTING", "PREPARING_MOCK"].includes(task.status) && !task.pendingChangeId).length };
  const taskRow = (task: StageTask) => {
    const rowGroup = group(task), own = task.assigneeNodeId === data.viewer.id;
    const taskChange = coordination?.changes.find(change => change.id === task.pendingChangeId)?.taskChanges?.find(item => item.taskId === task.id);
    const reason = rowGroup === "等待" ? task.blockedReason ?? coordination?.readiness[task.id]?.reasons.filter(reason => !reason.includes("当前状态")).join("；") : task.pauseRequested ? "请确认旧版本执行已停止" : "";
    return <div className="wb-task-row" key={task.id}>
      <button className="wb-task-title" onClick={() => navigate(`task:${task.id}`)}><strong>{task.title}</strong>{task.pendingChangeId && <span className="wb-task-revised">要求已更新{taskChange ? ` · v${taskChange.beforeRevision} → v${taskChange.afterRevision}` : ""} · 查看差异</span>}{reason && <span>{reason}</span>}</button>
      <span className="wb-owner">{data.nodes.find(node => node.id === task.assigneeNodeId)?.label ?? "未知成员"}</span>
      <span className={`wb-status ${rowGroup === "可开工" ? "ready" : rowGroup === "进行中" ? "running" : rowGroup === "等待" || task.pendingChangeId ? "waiting" : ""}`}><i aria-hidden="true" />{rowGroup === "可开工" ? "可开工" : taskLabel(task)}</span>
      <button className="wb-row-action" onClick={() => navigate(`task:${task.id}`)}>{own && rowGroup === "可开工" ? "开工" : own && rowGroup === "待我处理" ? "处理" : "查看"}<ArrowRight size={14} /></button>
    </div>;
  };
  const selectedTask = panel.startsWith("task:") ? data.tasks.find(task => task.id === panel.slice(5) && !task.archived) : undefined;
  const selectedIntent = panel.startsWith("intent:") ? coordination?.intents.find(intent => intent.id === panel.slice(7)) : undefined;
  const selectedAlignment = panel.startsWith("plan:") ? data.alignments.find(alignment => alignment.id === panel.slice(5)) : undefined;
  const planningIntent = selectedAlignment ? coordination?.intents.find(intent => intent.id === selectedAlignment.quickIntentId) : panel.startsWith("import:") ? coordination?.intents.find(intent => intent.id === panel.slice(7)) : undefined;
  const selectedChange = panel.startsWith("change:") ? coordination?.changes.find(change => change.id === panel.slice(7)) : undefined;
  const selectedPublication = panel.startsWith("publish-change:") ? coordination?.changes.find(change => change.id === panel.slice(15)) : undefined;
  const changes = (coordination?.changes ?? []).filter(change => {
    if (changeFilter === "pending") return change.status === "PENDING";
    if (changeFilter !== "mine") return true;
    if (change.submitterNodeId === data.viewer.id) return true;

    const mine = new Set(data.tasks.filter(task => task.assigneeNodeId === data.viewer.id).map(task => task.id));
    const relatedTaskIds = new Set([...change.taskIds, ...change.affectedTaskIds]);
    change.contractIds.forEach(id => {
      const contract = data.contracts.find(item => item.id === id);
      if (contract) [contract.providerTaskId, ...contract.consumerTaskIds].forEach(taskId => relatedTaskIds.add(taskId));
    });
    if (change.suggestion?.status === "READY") {
      change.suggestion.findings.filter(finding => finding.impact !== "unaffected").forEach(finding => relatedTaskIds.add(finding.taskId));
    }
    data.tasks.filter(task => (task.brief?.requirementRefs ?? []).some(ref => change.requirementRefs.includes(ref)))
      .forEach(task => relatedTaskIds.add(task.id));

    // 与影响分析保持一致：上游任务受影响时，依赖它的下游任务也需要看到这条变更。
    let expanded = true;
    while (expanded) {
      expanded = false;
      data.tasks.forEach(task => {
        if (!relatedTaskIds.has(task.id) && task.dependencies.some(id => relatedTaskIds.has(id))) {
          relatedTaskIds.add(task.id);
          expanded = true;
        }
      });
    }
    return [...relatedTaskIds].some(taskId => mine.has(taskId));
  }).slice().reverse();
  return <div className="wb-root"><div className="wb-content">
    {!connected && <div className="wb-message wb-warning" role="status">连接中断，状态可能过期。<button onClick={() => void refresh()}>重试</button></div>}
    <Feedback error={action.error} notice={action.notice} />
    {!coordination && <p className="wb-callout">Host 尚未加载轻协作协议，请重启 Host 与本机连接进程；历史页面仍可从项目菜单访问。</p>}
    {view === "workbench" ? <>
      {currentStage && <header className="wb-page-heading"><div><span className="wb-eyebrow">{activeStage ? "当前需求" : "最近完成"}</span><h1>{title}</h1><p className="wb-muted">需求 v{currentStage.requirementRevision} · {counts.ready} 项可开工 · {counts.running} 项执行中</p></div>
        <div className="wb-actions"><button onClick={() => navigate("requirement")}>查看需求</button>{activeStage ? <button disabled={!writable} onClick={() => navigate("new-change")}><Plus size={15} />提出变更</button> : <button className="wb-primary" disabled={!writable} onClick={() => navigate("new-intent")}><Plus size={15} />提出需求</button>}</div>
      </header>}
      {!activeStage && <section className="wb-intents">
        {!intents.length && !currentStage ? <Empty title="还没有需求"><button className="wb-primary" disabled={!writable} onClick={() => navigate("new-intent")}><Plus size={15} />提出需求</button>{!local && <small>请在本机运行 vibe-git open 后操作</small>}</Empty> : <>
          {intents.length > 0 && <div className="wb-section-heading"><h2>待发布需求</h2><button disabled={!writable} onClick={() => navigate("new-intent")}><Plus size={14} />提出需求</button></div>}
          {intents.map(intent => {
            const alignment = [...data.alignments].reverse().find(alignment => alignment.quickIntentId === intent.id && alignment.quickIntentRevision === intent.revision && !alignment.publishedStageId);
            const generating = alignment && ["QUEUED", "RUNNING"].includes(alignment.status);
            return <article className="wb-intent-row" key={intent.id}><div><button className="wb-task-title" onClick={() => navigate(`intent:${intent.id}`)}><strong>{intent.title}</strong></button><span className="wb-muted">{data.nodes.find(node => node.id === intent.ownerNodeId)?.label} · 草稿 v{intent.revision}{generating ? " · 正在生成分工" : alignment?.status === "FAILED" ? " · 生成失败" : ""}</span></div>
              <div className="wb-actions">{alignment && !generating && alignment.status !== "FAILED" ? <button className="wb-primary" onClick={() => navigate(`plan:${alignment.id}`)}>查看分工</button> : captain && <button className="wb-primary" disabled={!writable || action.busy || !!generating || !data.auditPool.available} onClick={() => void action.run(() => coordinationApi.generatePlan(intent.id, intent.revision), "已排队生成分工")}>{generating ? "生成中…" : "生成分工"}</button>}
                {(captain || intent.ownerNodeId === data.viewer.id) && <button disabled={!writable || !!generating} onClick={() => navigate(`import:${intent.id}`)}>导入 / 编写</button>}</div>
              {captain && !data.auditPool.available && !alignment && <small className="wb-muted">生成需要可用算力；也可直接导入或编写分工。</small>}
              {alignment?.error && <small className="wb-inline-error">{alignment.error}</small>}
            </article>;
          })}
        </>}
      </section>}
      {captain && pendingTaskChanges.length > 0 && <section className="wb-task-publications"><div className="wb-section-heading"><h2>待发布的任务变更<span>{pendingTaskChanges.length}</span></h2></div>
        {pendingTaskChanges.map(change => <div className="wb-intent-row" key={change.id}><div><button className="wb-task-title" onClick={() => navigate(`change:${change.id}`)}><strong>{change.title}</strong></button><span className="wb-muted">需求 v{change.baseRequirementRevision} · {change.suggestion?.status === "QUEUED" ? "正在分析影响" : change.suggestion?.status === "READY" ? "影响分析已就绪" : "待核对任务"}</span></div>
          <button onClick={() => navigate(`publish-change:${change.id}`)}>核对并发布<ArrowRight size={14} /></button>
        </div>)}
      </section>}
      {tasks.length > 0 && <><div className="wb-list-toolbar"><div className="wb-segment" aria-label="任务范围"><button aria-pressed={scope === "mine"} onClick={() => switchScope("mine")}>我的任务</button><button aria-pressed={scope === "all"} onClick={() => switchScope("all")}>全队</button></div>
        <label className="wb-search"><Search size={15} /><input aria-label="搜索任务" placeholder="搜索任务" value={query} onChange={event => setQuery(event.target.value)} /></label></div>
        {!visible.length && <Empty title={query ? "没有匹配的任务" : "暂时没有分配给你的任务"}>{!query && <button onClick={() => switchScope("all")}>查看全队</button>}</Empty>}
        {["待我处理", "可开工", "进行中", "等待", "已完成"].map(name => { const items = visible.filter(task => group(task) === name); if (!items.length) return null;
          return <section className="wb-task-group" key={name}><div className="wb-section-heading"><h2>{name}<span>{items.length}</span></h2>{name === "已完成" && <button className="wb-icon" aria-label={doneOpen ? "收起已完成任务" : "展开已完成任务"} aria-expanded={doneOpen} onClick={() => setDoneOpen(!doneOpen)}><ChevronDown size={17} className={doneOpen ? "wb-rotated" : ""} /></button>}</div>
            {(name !== "已完成" || doneOpen) && items.map(taskRow)}</section>;
        })}
      </>}
      {!tasks.length && activeStage && <Empty title="当前需求还没有可见任务" />}
    </> : <>
      <header className="wb-page-heading"><div><h1>变更</h1><p className="wb-muted">只协调需要调整的部分。</p></div><button className="wb-primary" disabled={!writable || !activeStage} onClick={() => navigate("new-change")}><Plus size={15} />提出变更</button></header>
      <div className="wb-list-toolbar"><div className="wb-segment" aria-label="变更范围">{[["mine", "与我有关"], ["pending", "待审核"], ["all", "全部"]].map(([value, label]) => <button key={value} aria-pressed={changeFilter === value} onClick={() => setChangeFilter(value!)}>{label}</button>)}</div></div>
      {!changes.length && <Empty title="这里暂时没有变更" />}
      {changes.map(change => <button key={change.id} className="wb-change-row" onClick={() => navigate(`change:${change.id}`)}><span><strong>{change.title}</strong><small>{data.nodes.find(node => node.id === change.submitterNodeId)?.label ?? "成员"} · 需求 v{change.baseRequirementRevision}</small></span><span className="wb-muted">{change.status === "PENDING" ? "待审核" : change.status === "APPLIED" ? `已应用 · ${change.affectedTaskIds.length} 项` : "已退回"}</span><ArrowRight size={15} /></button>)}
      {!!data.pullRequests.length && <details className="wb-disclosure"><summary>旧版变更记录 · {data.pullRequests.length}</summary>{data.pullRequests.map(change => <button key={change.id} className="wb-related" onClick={() => openLegacy({ type: "change", id: change.id })}>{data.plans.find(plan => plan.id === change.documentId)?.filename ?? change.id}<span>{change.status}</span></button>)}</details>}
    </>}
  </div>
    {selectedTask && <TaskPanel key={selectedTask.id} task={selectedTask} data={data} local={writable} refresh={refresh} close={close} navigate={id => navigate(`task:${id}`)} />}
    {(panel === "new-intent" || selectedIntent) && <IntentComposer key={selectedIntent?.id ?? "new"} intent={selectedIntent} local={writable && (!selectedIntent || captain || selectedIntent.ownerNodeId === data.viewer.id)} refresh={refresh} close={close} saved={() => close()} />}
    {planningIntent && <PlanEditor key={selectedAlignment?.id ?? planningIntent.id} intent={planningIntent} alignment={selectedAlignment} data={data} local={writable} refresh={refresh} close={close} saved={id => navigate(`plan:${id}`, true)} />}
    {panel === "new-change" && <ChangeComposer data={data} local={writable} refresh={refresh} close={close} />}
    {selectedChange && <ChangePanel key={selectedChange.id} change={selectedChange} data={data} local={writable} refresh={refresh} close={close} taskOpen={id => navigate(`task:${id}`)} publish={() => navigate(`publish-change:${selectedChange.id}`)} />}
    {selectedPublication && <TaskChangePublisher key={selectedPublication.id} change={selectedPublication} data={data} local={writable} refresh={refresh} close={close} taskOpen={id => navigate(`task:${id}`)} changeOpen={() => navigate(`change:${selectedPublication.id}`)} />}
    {panel === "requirement" && currentStage && <Sheet title="当前需求" wide close={close}><div className="wb-meta">需求 v{currentStage.requirementRevision}</div><Markdown>{currentStage.requirementMarkdown}</Markdown></Sheet>}
  </div>;
}
