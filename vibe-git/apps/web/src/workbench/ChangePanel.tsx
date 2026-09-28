import { useEffect, useState } from "react";
import type { ApplyCoordinationChange, ChangeImpact, CoordinationChange, V20BootstrapPayload } from "@vibe-git/protocol";
import { coordinationApi } from "../api";
import { Feedback, Sheet, lines, useAction } from "./shared";

export function ChangeComposer({ data, local, refresh, close }: { data: V20BootstrapPayload; local: boolean; refresh: () => Promise<void>; close: () => void }) {
  const stage = [...data.stages].reverse().find(stage => stage.status !== "COMPLETED");
  const [title, setTitle] = useState(""), [content, setContent] = useState(""), [tasks, setTasks] = useState<string[]>([]), [contracts, setContracts] = useState<string[]>([]);
  const [revision] = useState(stage?.requirementRevision), [saved, setSaved] = useState(false); const action = useAction(refresh);
  const toggle = (ids: string[], id: string) => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id];
  return <Sheet title="提出变更" close={close} dirty={!saved && (!!title || !!content)}><form onSubmit={event => { event.preventDefault(); void action.run(async () => {
    if (revision === undefined) throw new Error("没有进行中的需求");
    await coordinationApi.submitChange({ title, content, taskIds: tasks, contractIds: contracts, expectedRequirementRevision: revision }); setSaved(true); close();
  }); }}>
    <Feedback error={action.error} />
    <label>标题<input autoFocus required maxLength={160} value={title} onChange={event => setTitle(event.target.value)} placeholder="这次要改变什么" /></label>
    <label>变更内容<textarea required rows={6} maxLength={16000} value={content} onChange={event => setContent(event.target.value)} placeholder="说明新要求，以及与原要求的区别" /></label>
    <details className="wb-disclosure"><summary>关联任务与接口</summary><p className="wb-muted">不确定可以留空，由队长确认范围。</p>
      {data.tasks.filter(task => !task.archived && task.stageId === stage?.id).map(task => <label className="wb-check" key={task.id}><input type="checkbox" checked={tasks.includes(task.id)} onChange={() => setTasks(toggle(tasks, task.id))} />{task.title}</label>)}
      {data.contracts.filter(contract => contract.stageId === stage?.id && contract.status !== "SUPERSEDED").map(contract => <label className="wb-check" key={contract.id}><input type="checkbox" checked={contracts.includes(contract.id)} onChange={() => setContracts(toggle(contracts, contract.id))} />接口：{contract.name}</label>)}
    </details><div className="wb-sheet-footer"><button className="wb-primary" disabled={!local || action.busy || !stage}>{action.busy ? "提交中…" : "提交变更"}</button><span className="wb-muted">提交不会自动暂停任务</span></div>
  </form></Sheet>;
}

export function ChangePanel({ change, data, local, refresh, close, taskOpen }: { change: CoordinationChange; data: V20BootstrapPayload; local: boolean;
  refresh: () => Promise<void>; close: () => void; taskOpen: (id: string) => void;
}) {
  const [impact, setImpact] = useState<ChangeImpact | null>(null), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState("");
  const [decisions, setDecisions] = useState<Record<string, "yes" | "no" | "">>({}), [confirm, setConfirm] = useState(false);
  const [taskUpdates, setTaskUpdates] = useState<Record<string, { goal: string; boundary: string; acceptance: string[] }>>({});
  const [updates, setUpdates] = useState<NonNullable<ApplyCoordinationChange["contractUpdates"]>>([]);
  const action = useAction(refresh), captain = data.viewer.role === "captain", pending = change.status === "PENDING";
  const fetchImpact = async () => { setLoading(true); setLoadError(""); try { setImpact(await coordinationApi.impact(change.id)); setDecisions({}); setConfirm(false); setUpdates([]); setTaskUpdates({}); } catch (error) { setLoadError(error instanceof Error ? error.message : "无法读取影响范围"); } finally { setLoading(false); } };
  useEffect(() => { let alive = true; void coordinationApi.impact(change.id).then(result => { if (alive) setImpact(result); }).catch(error => { if (alive) setLoadError(error.message); }).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, [change.id]);
  const affected = Object.values(decisions).filter(value => value === "yes").length;
  const complete = impact && impact.tasks.every(task => decisions[task.taskId] === "yes" || decisions[task.taskId] === "no");
  const stale = !!impact && (impact.requirementRevision !== data.stages.find(stage => stage.id === change.stageId)?.requirementRevision || impact.tasks.some(task => data.tasks.find(current => current.id === task.taskId)?.revision !== task.revision));
  return <Sheet title={change.title} close={close} dirty={pending && Object.keys(decisions).length > 0 && !action.notice}>
    <div className="wb-meta"><span>{data.nodes.find(node => node.id === change.submitterNodeId)?.label ?? "成员"}</span><span>{pending ? "待审核" : change.status === "APPLIED" ? "已应用" : "已退回"}</span><span>基于需求 v{change.baseRequirementRevision}</span></div>
    <p className="wb-preserve">{change.content}</p><Feedback error={action.error || loadError} notice={action.notice} />
    {loadError && <button onClick={() => void fetchImpact()}>重新读取</button>}
    {loading && <p role="status" className="wb-muted">读取影响范围…</p>}
    {pending && captain && <div className="wb-actions"><button disabled={!local || action.busy || !data.auditPool.available || change.suggestion?.status === "QUEUED"} onClick={() => void action.run(() => coordinationApi.suggestImpact(change.id, change.revision), "已请求影响建议，任务不会自动暂停")}>{change.suggestion?.status === "QUEUED" ? "分析中…" : "请算力池建议范围"}</button>{change.suggestion?.status === "READY" && <button onClick={() => { if (!Object.keys(decisions).length || window.confirm("重新读取建议会清除当前未提交的影响选择，继续？")) void fetchImpact(); }}>读取建议</button>}</div>}
    {change.suggestion?.error && <p className="wb-muted">分析未完成：{change.suggestion.error}。仍可人工确认。</p>}
    {pending && impact && <section><h3>{captain ? "确认影响范围" : "候选影响"}</h3>
      <p className="wb-muted">{captain ? "逐项确认，未发现关联不等于没有影响。" : "以下是候选范围，尚未应用。"}</p>
      {impact.tasks.map(task => <div key={task.taskId} className="wb-impact-row"><div><strong>{task.title}</strong><span className="wb-muted">{task.suggested ? "候选影响" : task.uncertain ? "待确认" : "未发现直接关联"}</span></div>
        {captain && <select aria-label={`${task.title}是否受影响`} disabled={!local || action.busy} value={decisions[task.taskId] ?? ""} onChange={event => { setDecisions(current => ({ ...current, [task.taskId]: event.target.value as "yes" | "no" | "" })); setConfirm(false); }}>
          <option value="">请选择</option><option value="yes">受影响</option><option value="no">不受影响</option></select>}
        <details><summary>判断依据</summary><p>{task.reasons.join("；")}</p></details>
        {captain && decisions[task.taskId] === "yes" && <details className="wb-impact-edit"><summary>修订目标与验收（可选）</summary>{(() => {
          const existing = data.tasks.find(item => item.id === task.taskId)!;
          const value = taskUpdates[task.taskId] ?? { goal: existing.goal, boundary: existing.boundary, acceptance: existing.acceptance };
          const set = (patch: Partial<typeof value>) => { setTaskUpdates(current => ({ ...current, [task.taskId]: { ...value, ...patch } })); setConfirm(false); };
          return <><label>目标<textarea disabled={!local || action.busy} value={value.goal} onChange={event => set({ goal: event.target.value })} /></label><label>职责边界<textarea disabled={!local || action.busy} value={value.boundary} onChange={event => set({ boundary: event.target.value })} /></label><label>验收<textarea disabled={!local || action.busy} value={value.acceptance.join("\n")} onChange={event => set({ acceptance: event.target.value.split("\n") })} /></label></>;
        })()}</details>}
      </div>)}
    </section>}
    {pending && captain && change.contractIds.map(id => data.contracts.find(contract => contract.id === id)).filter(contract => !!contract).map(contract => {
      const update = updates.find(item => item.contractId === contract.id);
      const set = (patch: Partial<NonNullable<ApplyCoordinationChange["contractUpdates"]>[number]>) => { setUpdates(current => current.map(item => item.contractId === contract.id ? { ...item, ...patch } : item)); setConfirm(false); };
      return <details className="wb-disclosure" key={contract.id}><summary>接口修订：{contract.name}</summary><label className="wb-check"><input type="checkbox" checked={!!update} disabled={!local || action.busy} onChange={event => {
        setUpdates(current => event.target.checked ? [...current, { contractId: contract.id, expectedRevision: contract.revision, signature: contract.signature, behavior: contract.behavior, testCommand: contract.testCommand }] : current.filter(item => item.contractId !== contract.id)); setConfirm(false);
      }} />本次同时修改接口约定</label>{update && <><label>签名<textarea value={update.signature} onChange={event => set({ signature: event.target.value })} /></label><label>行为<textarea value={update.behavior.join("\n")} onChange={event => set({ behavior: event.target.value.split("\n") })} /></label><label>集成验证<input value={update.testCommand} onChange={event => set({ testCommand: event.target.value })} /></label><p className="wb-muted">提供方和所有消费方都必须列为受影响。</p></>}</details>;
    })}
    {pending && stale && <div className="wb-callout"><p>需求或任务已更新，请重新读取影响范围后确认。</p><button onClick={() => void fetchImpact()}>重新读取</button></div>}
    {pending && captain && impact && <section className="wb-callout"><p>将更新 {affected} 项任务。相关执行需要停止并重新确认，无关任务继续。</p>
      <label className="wb-check"><input type="checkbox" checked={confirm} disabled={!complete || stale} onChange={event => setConfirm(event.target.checked)} />已核对以上影响范围</label>
      <div className="wb-actions"><button className="wb-primary" disabled={!local || action.busy || !complete || !confirm || stale} onClick={() => void action.run(async () => {
        await coordinationApi.applyChange(change.id, { expectedRevision: impact.changeRevision, expectedRequirementRevision: impact.requirementRevision,
          decisions: impact.tasks.map(task => ({ taskId: task.taskId, expectedRevision: task.revision, affected: decisions[task.taskId] === "yes", ...(decisions[task.taskId] === "yes" && taskUpdates[task.taskId] ? { update: { ...taskUpdates[task.taskId]!, acceptance: lines(taskUpdates[task.taskId]!.acceptance.join("\n")) } } : {}) })),
          contractUpdates: updates.map(update => ({ ...update, behavior: lines(update.behavior.join("\n")) })) }); setDecisions({}); setConfirm(false);
      }, "变更已应用，已通知相关负责人")}>{action.busy ? "处理中…" : "应用变更"}</button>
        <button disabled={!local || action.busy} onClick={() => { if (window.confirm("退回这次变更？任务与需求保持原样。")) void action.run(async () => { await coordinationApi.rejectChange(change.id, change.revision); setDecisions({}); }, "变更已退回"); }}>退回</button></div>
    </section>}
    {!pending && change.affectedTaskIds.length > 0 && <section><h3>已确认影响</h3>{change.affectedTaskIds.map(id => <button className="wb-related" key={id} onClick={() => taskOpen(id)}>{data.tasks.find(task => task.id === id)?.title ?? id}<span>查看任务</span></button>)}</section>}
  </Sheet>;
}
