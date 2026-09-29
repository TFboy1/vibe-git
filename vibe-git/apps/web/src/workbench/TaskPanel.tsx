import { useEffect, useState } from "react";
import type { StageTask, V20BootstrapPayload } from "@vibe-git/protocol";
import { ArrowUpRight, Copy, Download } from "lucide-react";
import { api, coordinationApi } from "../api";
import { label } from "../canvas/model";
import { Feedback, Sheet, downloadText, useAction } from "./shared";
import { TaskChangeDiff, taskContentChanged } from "./TaskChangeDiff";

export function taskLabel(task: StageTask) {
  if (task.pauseRequested) return "暂停待确认";
  if (task.pendingChangeId) return "变更待确认";
  if (task.status === "WAITING_CONFIRMATION") return "待确认完成";
  return label(task.status);
}
export function TaskPanel({ task, data, local, refresh, close, navigate }: {
  task: StageTask; data: V20BootstrapPayload; local: boolean; refresh: () => Promise<void>; close: () => void; navigate: (id: string) => void;
}) {
  const action = useAction(refresh), own = task.assigneeNodeId === data.viewer.id;
  const [starting, setStarting] = useState(false), [mode, setMode] = useState<"external" | "codex">("external");
  const [summary, setSummary] = useState(""), [reportKind, setReportKind] = useState<"progress" | "blocked" | "ready">("progress");
  const [reportRevision, setReportRevision] = useState(task.revision), [integrationConfirmed, setIntegrationConfirmed] = useState(false);
  const [completeConfirm, setCompleteConfirm] = useState(false), [stopped, setStopped] = useState(false);
  useEffect(() => { setStopped(false); }, [task.pendingChangeId]);
  const ready = data.coordination?.readiness[task.id];
  const owner = data.nodes.find(node => node.id === task.assigneeNodeId);
  const contracts = data.contracts.filter(contract => contract.stageId === task.stageId && contract.status !== "SUPERSEDED" && (contract.providerTaskId === task.id || contract.consumerTaskIds.includes(task.id)));
  const external = task.executionMode === "external";
  const pendingChange = data.coordination?.changes.find(change => change.id === task.pendingChangeId);
  const latestChange = pendingChange ?? data.coordination?.changes.filter(change => change.status === "APPLIED" && change.taskChanges?.some(item => item.taskId === task.id))
    .sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""))[0];
  const taskChange = latestChange?.taskChanges?.find(item => item.taskId === task.id);
  const canReport = external && ["IN_PROGRESS", "BLOCKED", "WAITING_INTEGRATION", "WAITING_CONFIRMATION"].includes(task.status) && !task.pendingChangeId;
  const copyPackage = () => action.run(async () => { const pack = await coordinationApi.taskPackage(task.id); await navigator.clipboard.writeText(pack.markdown); }, "执行包已复制");
  const start = () => action.run(async () => {
    if (mode === "external") await coordinationApi.externalStart(task.id, task.revision);
    else await api.taskStart(task.id, task.revision, data.stages.find(stage => stage.id === task.stageId)?.requirementRevision);
    setStarting(false);
  }, mode === "external" ? "已确认自行开工" : "已请求 Codex 开工");
  return <Sheet title={task.title} wide={!!taskChange} close={close} dirty={!!summary}>
    <div className="wb-meta"><span>{owner?.label ?? "负责人"}</span><span className="wb-status">{taskLabel(task)}</span><span>任务 v{task.revision}</span></div>
    <Feedback error={action.error} notice={action.notice} />
    {!local && <p className="wb-message">当前为只读视图。请在本机运行 vibe-git open 操作。</p>}
    {task.pendingChangeId && <section className="wb-callout">
      <h3>先核对这次任务变化</h3><p>{pendingChange?.title ?? "任务要求已更新，请重新阅读。"}</p>
      {taskChange && <><p className="wb-muted">{taskContentChanged(taskChange.before, taskChange.after) ? "左侧为原任务，右侧为已发布任务。红色标出修改行，减号表示删除，加号表示新增。" : "任务正文保持原样，本次修订了关联接口，请核对下方接口约定。"}</p>
        <TaskChangeDiff before={taskChange.before} after={taskChange.after} beforeLabel={`原任务 · v${taskChange.beforeRevision}`} afterLabel={`已发布 · v${taskChange.afterRevision}`} />
      </>}
      {task.pauseRequested && <label className="wb-check"><input type="checkbox" checked={stopped} onChange={event => setStopped(event.target.checked)} />我已停止旧版本任务的执行</label>}
      {own && <button className="wb-primary" disabled={!local || action.busy || (task.pauseRequested && !stopped)} onClick={() => void action.run(() => coordinationApi.ackChange(task.id, task.revision, stopped), "已确认变化，可重新开工")}>已核对差异，确认新要求</button>}
    </section>}
    {!task.pendingChangeId && taskChange && <details className="wb-disclosure"><summary>最近任务变化：{latestChange?.title}</summary><TaskChangeDiff before={taskChange.before} after={taskChange.after} beforeLabel={`原任务 · v${taskChange.beforeRevision}`} afterLabel={`已发布 · v${taskChange.afterRevision}`} /></details>}
    <section><h3>目标</h3><p className="wb-preserve">{task.goal}</p><h3>验收</h3><ul className="wb-acceptance">{task.acceptance.map((item, i) => <li key={i}>{item}</li>)}</ul></section>
    <section><h3>职责边界</h3><p className="wb-preserve">{task.boundary}</p>
      {!!task.brief?.excludedPaths.length && <p className="wb-muted">不修改：{task.brief.excludedPaths.join("、")}</p>}
    </section>
    {task.dependencies.length > 0 && <section><h3>依赖</h3>{task.dependencies.map(id => {
      const dependency = data.tasks.find(item => item.id === id); return <button key={id} className="wb-related" onClick={() => { if (!summary || window.confirm("有未保存进展，仍要切换任务？")) navigate(id); }}>
        <span>{dependency?.title ?? id}</span><span className="wb-muted">{dependency ? taskLabel(dependency) : "不存在"}</span><ArrowUpRight size={14} /></button>;
    })}</section>}
    {contracts.length > 0 && <section><h3>接口约定</h3>{contracts.map(contract => <details key={contract.id} className="wb-disclosure" open={contract.status !== "PUBLISHED" ? true : undefined}>
      <summary>{contract.name}<span className="wb-muted">v{contract.revision} · {contract.status === "PUBLISHED" ? "已确认" : "待确认"}</span></summary>
      <pre>{contract.signature}</pre><ul>{contract.behavior.map((item, i) => <li key={i}>{item}</li>)}</ul><p>验证：{contract.testCommand}</p><p className="wb-muted">交接：{contract.handoff}</p>
      <p className="wb-muted">已确认：{contract.acknowledgedNodeIds.map(id => data.nodes.find(node => node.id === id)?.label ?? id).join("、") || "暂无"}</p>
      {own && !contract.acknowledgedNodeIds.includes(data.viewer.id) && <button disabled={!local || action.busy} onClick={() => void action.run(() => coordinationApi.ackContract(contract.id, contract.revision), "接口约定已确认")}>确认此版本</button>}
    </details>)}</section>}
    {own && !task.pendingChangeId && ["PUBLISHED", "READY", "FAILED"].includes(task.status) && <section>
      {!!ready?.reasons.length && <div className="wb-callout"><h3>暂不能开工</h3>{ready.reasons.map(reason => <p key={reason}>{reason}</p>)}</div>}
      {!starting ? <button className="wb-primary" disabled={!local || action.busy || !ready?.canStartExternal} onClick={() => setStarting(true)}>开工</button> : <div className="wb-callout">
        <h3>确认任务 v{task.revision} 并开工</h3><p className="wb-muted">请确认上方目标、验收和职责边界。</p>
        <fieldset className="wb-choice"><legend>执行方式</legend>
          <label><input type="radio" name="execution" checked={mode === "external"} onChange={() => setMode("external")} />自行执行</label>
          <label><input type="radio" name="execution" checked={mode === "codex"} disabled={!ready?.canStartCodex} onChange={() => setMode("codex")} />通过 Codex</label>
        </fieldset>
        {!ready?.canStartCodex && <p className="wb-muted">{ready?.codexReasons.join("；") || "Codex 暂不可用"}，可通过顶部算力池接入。</p>}
        <div className="wb-actions"><button className="wb-primary" disabled={action.busy} onClick={start}>{action.busy ? "开工中…" : "确认开工"}</button><button disabled={action.busy} onClick={() => setStarting(false)}>取消</button></div>
      </div>}
    </section>}
    {canReport && own && <form onSubmit={event => { event.preventDefault(); void action.run(async () => {
      const updated = await coordinationApi.externalReport(task.id, { expectedRevision: reportRevision, action: reportKind, summary,
        ...(reportKind === "ready" && contracts.length ? { headSha: owner?.git?.headSha ?? "", contractHashes: Object.fromEntries(contracts.map(contract => [contract.id, contract.sha256])) } : {}) });
      setReportRevision(updated.revision); setSummary(""); setIntegrationConfirmed(false);
    }); }}>
      <h3>报告进展</h3><label>本次更新<select value={reportKind} onChange={event => { setReportKind(event.target.value as typeof reportKind); if (!summary) setReportRevision(task.revision); }}>
        <option value="progress">进展</option><option value="blocked">遇到阻塞</option><option value="ready">已完成实现，提交验证结果</option>
      </select></label>
      <label>进展或验证结果<textarea required rows={3} maxLength={8000} value={summary} onChange={event => { if (!summary) setReportRevision(task.revision); setSummary(event.target.value); }} placeholder="写清已完成什么，或具体卡在哪里" /></label>
      {summary && reportRevision !== task.revision && <p className="wb-callout">任务已更新。请阅读最新要求，<button type="button" onClick={() => setReportRevision(task.revision)}>使用当前版本</button>；填写内容会保留。</p>}
      {reportKind === "ready" && <><p className="wb-muted">这是负责人报告，不代表系统已自动验证。提交前请同步 Git。</p>
        {contracts.length > 0 && <label className="wb-check"><input type="checkbox" checked={integrationConfirmed} onChange={event => setIntegrationConfirmed(event.target.checked)} />已用真实上游验证当前全部契约，不是只测 Mock</label>}
      </>}
      <div className="wb-actions"><button className="wb-primary" disabled={!local || action.busy || (!!summary && reportRevision !== task.revision) || (reportKind === "ready" && contracts.length > 0 && !integrationConfirmed)}>{action.busy ? "提交中…" : "提交更新"}</button>
        <button type="button" disabled={!local || action.busy} onClick={() => void action.run(() => api.taskSync(task.id), "同步请求已发送，请等待快照更新")}>同步 Git</button></div>
    </form>}
    {task.progressSummary && <details className="wb-disclosure"><summary>最近进展<span className="wb-muted">负责人报告</span></summary><p className="wb-preserve">{task.progressSummary}</p></details>}
    {own && task.status === "WAITING_INTEGRATION" && !external && <button className="wb-primary" disabled={!local || action.busy} onClick={() => void action.run(() => api.taskIntegrate(task.id), "已请求真实集成")}>执行集成</button>}
    {own && task.status === "WAITING_CONFIRMATION" && !task.pendingChangeId && <section className="wb-callout">
      <h3>确认完成</h3><label className="wb-check"><input type="checkbox" checked={completeConfirm} onChange={event => setCompleteConfirm(event.target.checked)} />已检查验收与证据，确认这项任务完成</label>
      <div className="wb-actions"><button className="wb-primary" disabled={!local || action.busy || !completeConfirm} onClick={() => void action.run(() => external ? coordinationApi.externalDone(task.id, task.revision) : api.taskDone(task.id), "任务已完成")}>确认完成</button>
        <button disabled={!local || action.busy} onClick={() => void action.run(() => api.taskSync(task.id), "同步请求已发送")}>同步 Git</button></div>
    </section>}
    <details className="wb-disclosure"><summary>执行包与记录</summary>
      <div className="wb-actions"><button disabled={action.busy} onClick={copyPackage}><Copy size={14} />复制执行包</button>
        <button disabled={action.busy} onClick={() => void action.run(async () => { const pack = await coordinationApi.taskPackage(task.id); downloadText(`${task.id}.md`, pack.markdown); }, "已下载 Markdown")}><Download size={14} />Markdown</button>
        <button disabled={action.busy} onClick={() => void action.run(async () => { const pack = await coordinationApi.taskPackage(task.id); downloadText(`${task.id}.json`, JSON.stringify(pack, null, 2), true); }, "已下载 JSON")}>JSON</button></div>
      <dl className="wb-facts"><dt>执行方式</dt><dd>{external ? "自行执行 / 负责人报告" : task.executionMode === "codex" ? "Codex / 受控回执" : "尚未开工"}</dd><dt>Git HEAD</dt><dd>{(task.externalEvidence?.git ?? task.lastGit)?.headSha ?? "尚无快照"}</dd><dt>任务标识</dt><dd>{task.id}</dd></dl>
      {task.changeNotes?.map((note, i) => <p className="wb-preserve" key={i}>{note}</p>)}
    </details>
    <div className="wb-sheet-footer"><button onClick={copyPackage} disabled={action.busy}><Copy size={14} />复制执行包</button><button onClick={() => { if (!summary || window.confirm("有未保存进展，仍要关闭？")) close(); }} disabled={action.busy}>关闭</button></div>
  </Sheet>;
}
