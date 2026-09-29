import { useEffect, useRef, useState } from "react";
import type { ApplyCoordinationChange, ChangeImpact, CoordinationChange, TaskChangeContent, V20BootstrapPayload } from "@vibe-git/protocol";
import { coordinationApi } from "../api";
import { Feedback, Sheet, lines, useAction } from "./shared";
import { ContentChangeDiff, TaskChangeDiff, normalizeTaskContent, taskContentChanged } from "./TaskChangeDiff";

export function TaskChangePublisher({ change, data, local, refresh, close, taskOpen, changeOpen }: { change: CoordinationChange; data: V20BootstrapPayload; local: boolean;
  refresh: () => Promise<void>; close: () => void; taskOpen: (id: string) => void; changeOpen: () => void;
}) {
  const [impact, setImpact] = useState<ChangeImpact | null>(null), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState("");
  const [decisions, setDecisions] = useState<Record<string, "yes" | "no" | "">>({}), [confirm, setConfirm] = useState(false);
  const [taskUpdates, setTaskUpdates] = useState<Record<string, TaskChangeContent>>({});
  const [updates, setUpdates] = useState<NonNullable<ApplyCoordinationChange["contractUpdates"]>>([]);
  const impactRequest = useRef(0);
  const action = useAction(refresh), captain = data.viewer.role === "captain", pending = change.status === "PENDING";
  const fetchImpact = async () => {
    const request = ++impactRequest.current; setLoading(true); setLoadError(""); setConfirm(false);
    try {
      const result = await coordinationApi.impact(change.id);
      if (request === impactRequest.current) { setImpact(result); setDecisions({}); setUpdates([]); setTaskUpdates({}); }
    } catch (error) { if (request === impactRequest.current) setLoadError(error instanceof Error ? error.message : "无法读取影响范围"); }
    finally { if (request === impactRequest.current) setLoading(false); }
  };
  useEffect(() => {
    if (!pending) { impactRequest.current++; setLoading(false); return; }
    const request = ++impactRequest.current; setLoading(true); setConfirm(false);
    void coordinationApi.impact(change.id).then(result => {
      if (request === impactRequest.current) { setImpact(result); setLoadError(""); }
    }).catch(error => { if (request === impactRequest.current) setLoadError(error instanceof Error ? error.message : "无法读取影响范围"); })
      .finally(() => { if (request === impactRequest.current) setLoading(false); });
    return () => { impactRequest.current++; };
  }, [change.id, change.revision, change.suggestion?.jobId, change.suggestion?.status, pending]);
  const stageTasks = data.tasks.filter(task => task.stageId === change.stageId && !task.archived);
  const suggestionStale = change.suggestion?.status === "READY" && (Object.keys(change.suggestion.taskRevisions).length !== stageTasks.length ||
    stageTasks.some(task => change.suggestion?.taskRevisions[task.id] !== task.revision));
  const suggestionReady = change.suggestion?.status === "READY" && !suggestionStale;
  const reviewTasks = (impact?.tasks ?? []).map(task => {
    const existing = stageTasks.find(item => item.id === task.taskId);
    if (!existing) return null;
    const before: TaskChangeContent = { goal: existing.goal, boundary: existing.boundary, acceptance: existing.acceptance };
    const suggestedUpdate = suggestionReady ? change.suggestion?.findings.find(finding => finding.taskId === task.taskId)?.update : null;
    const draft = taskUpdates[task.taskId] ?? suggestedUpdate ?? before;
    const after = normalizeTaskContent(draft);
    return { ...task, before, after, draft, fromAI: !!suggestedUpdate && !taskUpdates[task.taskId], modified: taskContentChanged(before, after) };
  }).filter(task => task !== null);
  const contractUpdates = updates.map(update => ({ ...update, signature: update.signature.trim(), behavior: lines(update.behavior.join("\n")), testCommand: update.testCommand.trim() }));
  const contractModified = (update: typeof contractUpdates[number]) => {
    const contract = data.contracts.find(item => item.id === update.contractId);
    return !!contract && (contract.signature !== update.signature || JSON.stringify(contract.behavior) !== JSON.stringify(update.behavior) || contract.testCommand !== update.testCommand);
  };
  const contractTasks = new Set(contractUpdates.filter(contractModified).flatMap(update => {
    const contract = data.contracts.find(item => item.id === update.contractId)!;
    return [contract.providerTaskId, ...contract.consumerTaskIds];
  }));
  const affectedTasks = reviewTasks.filter(task => decisions[task.taskId] === "yes");
  const modifiedTasks = affectedTasks.filter(task => task.modified);
  const missingUpdates = affectedTasks.filter(task => !task.modified && !contractTasks.has(task.taskId));
  const invalidUpdates = affectedTasks.filter(task => !task.after.goal || task.after.goal.length > 4000 || !task.after.boundary || task.after.boundary.length > 4000 || !task.after.acceptance.length || task.after.acceptance.length > 100 || task.after.acceptance.some(item => item.length > 4000 || item.includes("\0")) || task.after.goal.includes("\0") || task.after.boundary.includes("\0"));
  const contractsReady = contractUpdates.every(update => {
    const contract = data.contracts.find(item => item.id === update.contractId);
    return contract && contractModified(update) && update.signature && update.signature.length <= 4000 && !update.signature.includes("\0") && update.behavior.length > 0 && update.behavior.length <= 100 && update.behavior.every(item => item.length <= 4000 && !item.includes("\0")) && update.testCommand && update.testCommand.length <= 4000 && !update.testCommand.includes("\0") && [contract.providerTaskId, ...contract.consumerTaskIds].every(id => decisions[id] === "yes");
  });
  const complete = !!impact && reviewTasks.length === impact.tasks.length && impact.tasks.every(task => decisions[task.taskId] === "yes" || decisions[task.taskId] === "no");
  const stage = data.stages.find(item => item.id === change.stageId);
  const stale = !!impact && (impact.changeRevision !== change.revision || impact.requirementRevision !== stage?.requirementRevision || change.baseRequirementRevision !== stage?.requirementRevision || impact.tasks.length !== stageTasks.length || impact.tasks.some(task => stageTasks.find(current => current.id === task.taskId)?.revision !== task.revision) || updates.some(update => data.contracts.find(contract => contract.id === update.contractId)?.revision !== update.expectedRevision));
  const reviewReady = complete && !loading && !loadError && !stale && !missingUpdates.length && !invalidUpdates.length && contractsReady;
  const dirty = pending && (Object.keys(decisions).length > 0 || Object.keys(taskUpdates).length > 0 || updates.length > 0);
  const returnToChange = () => { if (!dirty || window.confirm("有未发布的任务草稿，仍要返回变更单？")) changeOpen(); };
  return <Sheet title={pending ? "发布任务变更" : "任务发布记录"} wide close={close} dirty={dirty}>
    <div className="wb-plan-heading"><div><h3>{change.title}</h3><p className="wb-muted">基于需求 v{change.baseRequirementRevision} · {pending ? "核对任务草稿后发布" : change.status === "APPLIED" ? "已发布" : "已退回"}</p></div><button disabled={action.busy} onClick={returnToChange}>查看变更单</button></div>
    <Feedback error={action.error || loadError} notice={action.notice} />
    {!local && <p className="wb-message">当前为只读视图。请在本机运行 vibe-git open 发布。</p>}
    {pending && (captain || change.suggestion) && <section className="wb-ai-impact" aria-labelledby="wb-ai-impact-heading">
      <div className="wb-ai-impact-heading"><div><span className="wb-ai-impact-mark" aria-hidden="true" /><h3 id="wb-ai-impact-heading">AI 影响建议与任务草稿</h3></div><span className="wb-ai-impact-note">待人工确认</span></div>
      {suggestionReady ? (change.suggestion!.findings.length > 0 ? <div className="wb-ai-impact-findings">
        {change.suggestion!.findings.map(finding => <div className="wb-ai-impact-finding" key={finding.taskId}>
          <div className="wb-ai-impact-finding-head"><strong>{stageTasks.find(task => task.id === finding.taskId)?.title ?? finding.taskId}</strong><span className={`wb-ai-impact-tag wb-ai-impact-tag--${finding.impact}`}>{finding.impact === "affected" ? "建议受影响" : finding.impact === "unaffected" ? "建议不受影响" : "待确认"}</span></div>
          <p>{finding.reason}</p>{finding.update && <small className="wb-muted">已生成任务修订草稿，选择受影响后核对左右差异。</small>}
        </div>)}
      </div> : <p className="wb-ai-impact-empty">当前阶段没有任务。</p>) : <div className="wb-ai-impact-state">
        <p role="status">{change.suggestion?.status === "QUEUED" ? "分析影响并生成任务草稿，完成后会自动显示…" : suggestionStale ? "任务已变化，建议需要重新分析。" : change.suggestion?.status === "FAILED" ? `分析失败：${change.suggestion.error ?? "请重试"}` : data.auditPool.available ? "还没有影响建议与任务草稿。" : "算力网未就绪，可直接填写任务修订。"}</p>
      </div>}
      {captain && change.suggestion?.status !== "QUEUED" && <div className="wb-ai-impact-state"><button disabled={!local || action.busy || !data.auditPool.available} onClick={() => void action.run(() => coordinationApi.suggestImpact(change.id, change.revision), "已请求影响建议与任务草稿，完成后自动显示")}>{change.suggestion ? "重新生成建议与草稿" : "生成影响建议与任务草稿"}</button></div>}
    </section>}
    {loadError && <button onClick={() => void fetchImpact()}>重新读取</button>}
    {loading && <p role="status" className="wb-muted">读取影响范围…</p>}
    {pending && impact && <section><h3>{captain ? "待发布任务" : "任务发布草稿"}</h3>
      <p className="wb-muted">{captain ? "逐项确认影响范围。左侧为原任务，右侧为待发布任务；红色标出修改行，减号表示删除，加号表示新增。" : "左侧为原任务，右侧为修订草稿，等待队长确认发布。"}</p>
      {reviewTasks.map(task => {
        const basis = task.reasons.filter(reason => !reason.startsWith("Agent 建议："));
        return <div key={task.taskId} className="wb-impact-row"><div><strong>{task.title}</strong><span className="wb-muted">{task.suggested ? "候选影响" : task.uncertain ? "待确认" : "未发现直接关联"}</span></div>
        {captain && <select aria-label={`${task.title}是否受影响`} disabled={!local || action.busy} value={decisions[task.taskId] ?? ""} onChange={event => { setDecisions(current => ({ ...current, [task.taskId]: event.target.value as "yes" | "no" | "" })); setConfirm(false); }}>
          <option value="">请人工选择</option><option value="yes">受影响</option><option value="no">不受影响</option></select>}
        {basis.length > 0 && <details><summary>关联依据</summary><p>{basis.join("；")}</p></details>}
        {(decisions[task.taskId] === "yes" || (!captain && task.fromAI)) && <div className="wb-impact-content">
          <div className="wb-diff-title"><h4>{task.title}</h4><span className="wb-muted">{task.fromAI ? "AI 草稿" : taskUpdates[task.taskId] ? "人工修订" : "待填写修订"}</span></div>
          {!task.modified && <p className="wb-diff-required">{contractTasks.has(task.taskId) ? "任务正文保持原样，本次修订关联的接口约定。" : "此任务还没有具体修订，请填写目标、边界或验收，也可以在上方生成 AI 草稿。"}</p>}
          <TaskChangeDiff before={task.before} after={task.after} beforeLabel={`原任务 · v${task.revision}`} afterLabel={`待发布 · v${task.revision + 1}`} />
          {captain && <details className="wb-impact-edit" open={!task.modified && !contractTasks.has(task.taskId) ? true : undefined}><summary>编辑任务修订草稿</summary>{(() => {
            const set = (patch: Partial<TaskChangeContent>) => { setTaskUpdates(current => ({ ...current, [task.taskId]: { ...task.draft, ...patch } })); setConfirm(false); };
            return <><label>目标<textarea aria-label={`${task.title}的新目标`} rows={3} maxLength={4000} disabled={!local || action.busy} value={task.draft.goal} onChange={event => set({ goal: event.target.value })} /></label><label>职责边界<textarea aria-label={`${task.title}的新职责边界`} rows={3} maxLength={4000} disabled={!local || action.busy} value={task.draft.boundary} onChange={event => set({ boundary: event.target.value })} /></label><label>验收（每行一条）<textarea aria-label={`${task.title}的新验收条件`} rows={4} disabled={!local || action.busy} value={task.draft.acceptance.join("\n")} onChange={event => set({ acceptance: event.target.value.split("\n") })} /></label></>;
          })()}</details>}
        </div>}
      </div>;
      })}
    </section>}
    {pending && captain && change.contractIds.map(id => data.contracts.find(contract => contract.id === id)).filter(contract => !!contract).map(contract => {
      const update = updates.find(item => item.contractId === contract.id);
      const set = (patch: Partial<NonNullable<ApplyCoordinationChange["contractUpdates"]>[number]>) => { setUpdates(current => current.map(item => item.contractId === contract.id ? { ...item, ...patch } : item)); setConfirm(false); };
      return <details className="wb-disclosure" key={contract.id}><summary>接口修订：{contract.name}</summary><label className="wb-check"><input type="checkbox" checked={!!update} disabled={!local || action.busy} onChange={event => {
        setUpdates(current => event.target.checked ? [...current, { contractId: contract.id, expectedRevision: contract.revision, signature: contract.signature, behavior: contract.behavior, testCommand: contract.testCommand }] : current.filter(item => item.contractId !== contract.id)); setConfirm(false);
      }} />本次同时修改接口约定</label>{update && <><ContentChangeDiff fields={[
        { label: "接口签名", before: contract.signature, after: update.signature.trim() },
        { label: "接口行为", before: contract.behavior.join("\n"), after: lines(update.behavior.join("\n")).join("\n") },
        { label: "集成验证", before: contract.testCommand, after: update.testCommand.trim() }
      ]} beforeLabel={`原接口 · v${contract.revision}`} afterLabel={`待发布 · v${contract.revision + 1}`} /><label>签名<textarea maxLength={4000} disabled={!local || action.busy} value={update.signature} onChange={event => set({ signature: event.target.value })} /></label><label>行为<textarea disabled={!local || action.busy} value={update.behavior.join("\n")} onChange={event => set({ behavior: event.target.value.split("\n") })} /></label><label>集成验证<input maxLength={4000} disabled={!local || action.busy} value={update.testCommand} onChange={event => set({ testCommand: event.target.value })} /></label><p className="wb-muted">提供方和所有消费方都必须列为受影响。</p></>}</details>;
    })}
    {pending && stale && <div className="wb-callout"><p>{change.baseRequirementRevision !== stage?.requirementRevision ? "此变更基于旧需求，请根据当前需求重新提交。" : "需求、任务或接口已更新，请重新读取后核对差异。"}</p><button disabled={loading || action.busy} onClick={() => void fetchImpact()}>重新读取</button></div>}
    {pending && captain && impact && <section className="wb-callout"><p>{complete ? `将发布 ${modifiedTasks.length} 项任务修订${affectedTasks.length > modifiedTasks.length ? `，另有 ${affectedTasks.length - modifiedTasks.length} 项需确认接口或补齐修订` : ""}，并同步需求版本。` : "请逐项选择是否受影响，再核对左右差异。"}</p>
      {!!missingUpdates.length && <p className="wb-diff-required" role="status">请补齐具体修订：{missingUpdates.map(task => task.title).join("、")}。</p>}
      {!!invalidUpdates.length && <p className="wb-diff-required" role="status">目标和边界不能为空，且各不超过 4000 字；验收需要 1–100 条，每条不超过 4000 字。</p>}
      {!contractsReady && <p className="wb-diff-required" role="status">请填写具体的接口变化和验证命令，并把提供方及全部消费方列为受影响。</p>}
      <label className="wb-check"><input type="checkbox" checked={confirm && reviewReady} disabled={!local || action.busy || !reviewReady} onChange={event => setConfirm(event.target.checked)} />我已核对左右差异，确认发布这些任务修订</label>
      <div className="wb-actions"><button className="wb-primary" disabled={!local || action.busy || !reviewReady || !confirm} onClick={() => void action.run(async () => {
        await coordinationApi.applyChange(change.id, { expectedRevision: impact.changeRevision, expectedRequirementRevision: impact.requirementRevision,
          decisions: reviewTasks.map(task => ({ taskId: task.taskId, expectedRevision: task.revision, affected: decisions[task.taskId] === "yes", ...(decisions[task.taskId] === "yes" ? { update: task.after } : {}) })),
          contractUpdates }); setDecisions({}); setConfirm(false); setTaskUpdates({}); setUpdates([]);
      }, "任务修订已发布，已通知相关负责人")}>{action.busy ? "发布中…" : "确认并发布任务变更"}</button>
        <button disabled={action.busy} onClick={returnToChange}>返回变更单</button></div>
    </section>}
    {change.status === "APPLIED" && !!change.taskChanges?.length && <section><h3>已发布任务</h3><p className="wb-muted">左侧为原任务，右侧为本次发布的版本。</p>{change.taskChanges.map(task => <article className="wb-applied-task-change" key={task.taskId}>
      <button className="wb-related" onClick={() => taskOpen(task.taskId)}><strong>{task.title}</strong><span>查看当前任务</span></button>
      {!taskContentChanged(task.before, task.after) && <p className="wb-muted">本次任务正文保持原样，修订了关联接口约定。</p>}
      <TaskChangeDiff before={task.before} after={task.after} beforeLabel={`原任务 · v${task.beforeRevision}`} afterLabel={`已发布 · v${task.afterRevision}`} />
    </article>)}</section>}
    {!pending && !change.taskChanges?.length && change.affectedTaskIds.length > 0 && <section><h3>已确认影响</h3><p className="wb-muted">这条历史记录未保存前后内容，可查看当前任务。</p>{change.affectedTaskIds.map(id => <button className="wb-related" key={id} onClick={() => taskOpen(id)}>{data.tasks.find(task => task.id === id)?.title ?? id}<span>查看任务</span></button>)}</section>}
  </Sheet>;
}
