import { useState } from "react";
import type { CoordinationChange, V20BootstrapPayload } from "@vibe-git/protocol";
import { coordinationApi } from "../api";
import { Markdown } from "../Markdown";
import { Feedback, Sheet, useAction } from "./shared";

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
    <label>变更内容<textarea required rows={6} maxLength={16000} value={content} onChange={event => setContent(event.target.value)} placeholder="说明新要求、预期结果与验收标准" /></label>
    <details className="wb-disclosure"><summary>关联任务与接口</summary><p className="wb-muted">不确定可以留空，由队长确认范围。</p>
      {data.tasks.filter(task => !task.archived && task.stageId === stage?.id).map(task => <label className="wb-check" key={task.id}><input type="checkbox" checked={tasks.includes(task.id)} onChange={() => setTasks(toggle(tasks, task.id))} />{task.title}</label>)}
      {data.contracts.filter(contract => contract.stageId === stage?.id && contract.status !== "SUPERSEDED").map(contract => <label className="wb-check" key={contract.id}><input type="checkbox" checked={contracts.includes(contract.id)} onChange={() => setContracts(toggle(contracts, contract.id))} />接口：{contract.name}</label>)}
    </details><div className="wb-sheet-footer"><button className="wb-primary" disabled={!local || action.busy || !stage}>{action.busy ? "提交中…" : "提交变更"}</button><span className="wb-muted">任务修订在发布时确认</span></div>
  </form></Sheet>;
}

export function ChangePanel({ change, data, local, refresh, close, taskOpen, publish }: { change: CoordinationChange; data: V20BootstrapPayload; local: boolean;
  refresh: () => Promise<void>; close: () => void; taskOpen: (id: string) => void; publish: () => void;
}) {
  const action = useAction(refresh), captain = data.viewer.role === "captain", pending = change.status === "PENDING";
  const relatedTaskIds = [...new Set([...change.taskIds, ...change.affectedTaskIds])];
  return <Sheet title={change.title} close={close}>
    <div className="wb-meta"><span>{data.nodes.find(node => node.id === change.submitterNodeId)?.label ?? "成员"}</span><span>{pending ? "待发布" : change.status === "APPLIED" ? "已应用" : "已退回"}</span><span>基于需求 v{change.baseRequirementRevision}</span></div>
    <Feedback error={action.error} notice={action.notice} />
    <section><h3>变更说明</h3><Markdown>{change.content}</Markdown></section>
    {relatedTaskIds.length > 0 && <section><h3>关联任务</h3>{relatedTaskIds.map(id => <button className="wb-related" key={id} onClick={() => taskOpen(id)}><span>{data.tasks.find(task => task.id === id)?.title ?? id}</span><span>查看任务</span></button>)}</section>}
    {change.contractIds.length > 0 && <section><h3>关联接口</h3>{change.contractIds.map(id => <p key={id}>{data.contracts.find(contract => contract.id === id)?.name ?? id}</p>)}</section>}
    {pending && <section className="wb-callout"><h3>任务发布</h3><p>在任务发布界面核对影响范围、编辑任务草稿，并逐行查看左右差异。</p>
      {change.suggestion?.status === "QUEUED" && <p className="wb-muted" role="status">正在生成任务草稿…</p>}
      {change.suggestion?.status === "READY" && <p className="wb-muted">影响建议已生成，可进入任务发布界面核对。</p>}
      {change.suggestion?.status === "FAILED" && <p className="wb-muted">草稿生成失败：{change.suggestion.error ?? "可在任务发布界面重试或人工编辑"}</p>}
    </section>}
    <div className="wb-sheet-footer">
      {pending && <button className="wb-primary" disabled={action.busy} onClick={publish}>{captain ? "核对并发布任务变更" : "查看任务发布草稿"}</button>}
      {change.status === "APPLIED" && <button className="wb-primary" onClick={publish}>查看任务发布记录</button>}
      {pending && captain && <button disabled={!local || action.busy} onClick={() => {
        if (window.confirm("退回这次需求变更？")) void action.run(() => coordinationApi.rejectChange(change.id, change.revision), "变更已退回");
      }}>退回</button>}
      <button onClick={close} disabled={action.busy}>关闭</button>
    </div>
  </Sheet>;
}
