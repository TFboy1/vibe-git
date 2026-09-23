import { useState } from "react";
import type { AlignmentRun, StageTask, V20BootstrapPayload } from "@vibe-git/protocol";
import { api, localCapabilities, localChat, localFinalize, type ExecutionDetail } from "./api";
import "./contract-workspace.css";

const label = (data: V20BootstrapPayload, id: string) => data.nodes.find((node) => node.id === id)?.label ?? id.slice(0, 14);
const download = (filename: string, markdown: string) => {
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
};

export function ContractBoard({ alignment, data, run }: { alignment: AlignmentRun; data: V20BootstrapPayload;
  run(work: () => Promise<unknown>, message: string): void }) {
  const contracts = data.contracts.filter((item) => item.alignmentId === alignment.id);
  const captain = data.viewer.role === "captain";
  return <section className="contract-board"><div className="contract-head"><div><small>INTERFACE CONTRACTS</small><h3>并行工作的交接面</h3><p>双方确认同一版本后，消费方才能用本机 Codex 生成 Mock。</p></div><strong>{contracts.length}</strong></div>
    {contracts.length ? contracts.map((contract) => {
      const participants = [...new Set(alignment.tasks.filter((task) => task.id === contract.providerTaskId || contract.consumerTaskIds.includes(task.id)).map((task) => task.assigneeNodeId))];
      const mine = participants.includes(data.viewer.id);
      return <article className="contract-entry" key={contract.id}><div className="contract-title"><div><code>{contract.id} · r{contract.revision}</code><h4>{contract.name}</h4></div><span>{participants.every((id) => contract.acknowledgedNodeIds.includes(id)) ? "双方已确认" : "等待确认"}</span></div>
        <p>{contract.signature}</p><div className="contract-grid"><div><b>行为</b>{contract.behavior.map((item, index) => <small key={index}>{item}</small>)}</div><div><b>样例与错误</b>{[...contract.examples, ...contract.errors].map((item, index) => <small key={index}>{item}</small>)}</div></div>
        <p className="contract-meta">验证：{contract.testCommand} · 交接：{contract.handoff}</p>
        <div className="contract-actions"><span>{participants.map((id) => `${label(data, id)} ${contract.acknowledgedNodeIds.includes(id) ? "✓" : "待确认"}`).join(" · ")}</span>
          {mine && contract.status === "DRAFT" && !contract.acknowledgedNodeIds.includes(data.viewer.id) && <button onClick={() => run(() => api.contractAck(contract), "接口契约已确认")}>确认此版本</button>}</div>
        {captain && alignment.status === "READY" && alignment.tasks.flatMap((task) => (task.dependencyEdges ?? []).filter((edge) => edge.contractId === contract.id).map((edge) =>
          <button className="contract-downgrade" key={`${task.id}-${edge.upstreamTaskId}`} onClick={() => run(() => api.downgradeDependency(alignment.id, task.id, edge.upstreamTaskId), "依赖已降级为硬等待")}>
            {task.title} ← {alignment.tasks.find((item) => item.id === edge.upstreamTaskId)?.title ?? edge.upstreamTaskId} · 改为等待上游完成
          </button>))}
      </article>;
    }) : <p className="contract-empty">本轮没有可 Mock 的跨成员接口；硬依赖仍等待上游交付。</p>}
  </section>;
}

export function WorkstreamBoard({ stageId, data }: { stageId: string | undefined; data: V20BootstrapPayload }) {
  const workstreams = data.workstreams.filter((item) => item.stageId === stageId && item.status === "PUBLISHED");
  if (!workstreams.length) return null;
  return <section className="workstream-board"><div className="contract-head"><div><small>WORKSTREAMS</small><h3>成员工作主线</h3><p>一人一条完整主线；切片分别开工、同步和验收。</p></div></div><div className="workstream-grid">{workstreams.map((item) => {
    const tasks = item.taskIds.map((id) => data.tasks.find((task) => task.id === id)).filter((task): task is StageTask => Boolean(task));
    return <article className="workstream-entry" key={item.id}><div><code>{item.id}</code><span>{label(data, item.ownerNodeId)}</span></div><h4>{item.mission}</h4><p>{item.boundary}</p><ol>{tasks.map((task) => <li key={task.id}><b>{task.title}</b><small>{task.status} · {task.dependencyEdges?.length ?? task.dependencies.length} 条依赖</small></li>)}</ol>
      {(data.viewer.role === "captain" || data.viewer.id === item.ownerNodeId) && <button onClick={() => void api.workstreamBrief(item.id).then((markdown) => download("workstream.md", markdown))}>下载完整工作主线</button>}
    </article>;
  })}</div></section>;
}

function detailMarkdown(detail: ExecutionDetail): string {
  return ["# 切片执行细化", "", "## 实施步骤", ...detail.steps.map((item) => `- ${item}`), "", "## 文件范围",
    ...detail.files.map((item) => `- ${item}`), "", "## Mock 使用", detail.mockUsage, "", "## 验证",
    ...detail.validation.map((item) => `- ${item}`), "", "## 备注", detail.notes].join("\n");
}
export function TaskChat({ task, onSaved }: { task: StageTask; onSaved(): void }) {
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = () => { setOpen(!open); if (!open) void localCapabilities().then((value) => setAvailable(value.local && value.chat)); };
  const ask = async () => { if (!question.trim() || busy) return; setBusy(true); setAnswer(""); setError(null);
    try { const full = await localChat(task.id, question, (delta) => setAnswer((current) => current + delta)); setAnswer(full); setQuestion(""); }
    catch (problem) { setError(problem instanceof Error ? problem.message : String(problem)); } finally { setBusy(false); } };
  const finalize = async () => { setBusy(true); setError(null); try { setDetail(await localFinalize(task.id)); }
    catch (problem) { setError(problem instanceof Error ? problem.message : String(problem)); } finally { setBusy(false); } };
  const save = async () => { if (!detail) return; setBusy(true); setError(null); try { await api.uploadTask(task.id, "task-detail.md", detailMarkdown(detail)); setDetail(null); onSaved(); }
    catch (problem) { setError(problem instanceof Error ? problem.message : String(problem)); } finally { setBusy(false); } };
  return <div className="task-chat"><button onClick={toggle}>{open ? "收起 Codex 细化" : "与我的 Codex 细化"}</button>{open && <div className="task-chat-body">
    {available === false ? <p>本机 Codex App Server 不可用。请在运行 CLI 的电脑使用 vibe-git open；仍可用 task pull/push 上传细化。</p> : available === null ? <p>正在检测本机 Codex…</p> : <>
      <p>只读对话调用你自己的日常 Codex。正式目标、验收和接口契约不会被对话更改。</p>
      {answer && <div className="task-chat-answer">{answer}</div>}
      <textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="与本机 Codex 讨论当前切片的实现细节…" rows={3} disabled={busy}/>
      <div className="task-chat-actions"><button disabled={busy || !question.trim()} onClick={() => void ask()}>发送</button><button disabled={busy} onClick={() => void finalize()}>生成执行细化</button></div>
      {detail && <div className="task-chat-preview"><b>确认后才会保存为 task-detail.md</b><pre>{detailMarkdown(detail)}</pre><button disabled={busy} onClick={() => void save()}>确认保存细化</button></div>}
      {error && <p className="task-chat-error">{error}</p>}
    </>}
  </div>}</div>;
}
