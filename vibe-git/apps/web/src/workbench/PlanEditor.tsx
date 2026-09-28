import { useState } from "react";
import { Plus, Trash2, Upload } from "lucide-react";
import type { AlignmentRun, IntentDraft, QuickPlanInput, V20BootstrapPayload } from "@vibe-git/protocol";
import { api, coordinationApi } from "../api";
import { Feedback, Sheet, lines, useAction } from "./shared";

export function PlanEditor({ intent, alignment, data, local, refresh, close, saved }: { intent: IntentDraft; alignment?: AlignmentRun | undefined;
  data: V20BootstrapPayload; local: boolean; refresh: () => Promise<void>; close: () => void; saved: (id: string) => void;
}) {
  const [plan, setPlan] = useState<QuickPlanInput>(() => structuredClone(alignment?.quickPlan ?? { tasks: [], contracts: [], issues: [] }));
  const [intentRevision] = useState(alignment?.quickIntentRevision ?? intent.revision);
  const [dirty, setDirty] = useState(false), [json, setJson] = useState(""), [showImport, setShowImport] = useState(!alignment), [confirmed, setConfirmed] = useState(false);
  const action = useAction(refresh), captain = data.viewer.role === "captain";
  const editable = local && (captain || intent.ownerNodeId === data.viewer.id) && !intent.publishedStageId;
  const patchTask = (index: number, patch: Partial<QuickPlanInput["tasks"][number]>) => { setPlan(current => ({ ...current, tasks: current.tasks.map((task, i) => i === index ? { ...task, ...patch } : task) })); setDirty(true); };
  const loadJson = (value: string) => {
    try { const parsed = JSON.parse(value) as QuickPlanInput; if (!parsed || !Array.isArray(parsed.tasks)) throw new Error("JSON 需要包含 tasks 数组");
      for (const task of parsed.tasks) if (!task || typeof task.key !== "string" || typeof task.title !== "string" || typeof task.goal !== "string" || typeof task.boundary !== "string" || typeof task.assigneeNodeId !== "string" || !Array.isArray(task.acceptance) || !task.acceptance.every(item => typeof item === "string") || !Array.isArray(task.dependencies) || !task.dependencies.every(item => typeof item === "string")) throw new Error("任务字段不完整，请使用执行包协议格式");
      if (parsed.contracts !== undefined && (!Array.isArray(parsed.contracts) || parsed.contracts.some(contract => !contract || typeof contract.key !== "string" || typeof contract.name !== "string" || typeof contract.signature !== "string" || !Array.isArray(contract.behavior) || !contract.behavior.every(item => typeof item === "string") || !Array.isArray(contract.consumerTaskKeys)))) throw new Error("契约格式不完整");
      if (parsed.issues !== undefined && (!Array.isArray(parsed.issues) || !parsed.issues.every(item => typeof item === "string"))) throw new Error("issues 应为字符串数组");
      setPlan(parsed); setDirty(true); setShowImport(false); action.setError("");
    } catch (error) { action.setError(error instanceof Error ? error.message : "JSON 格式无效"); }
  };
  const save = () => action.run(async () => { const result = await coordinationApi.importPlan(intent.id, intentRevision, { ...plan, issues: lines((plan.issues ?? []).join("\n")), tasks: plan.tasks.map(task => ({ ...task, acceptance: lines(task.acceptance.join("\n")) })) }); setDirty(false); saved(result.id); }, "分工草案已保存");
  const canPublish = intentRevision === intent.revision && editable && captain && !!alignment && !dirty && alignment.status === "READY" && !plan.issues?.length;
  return <Sheet title="分工草案" wide close={close} dirty={dirty}>
    <div className="wb-plan-heading"><div><h3>{intent.title}</h3><p className="wb-muted">需求草稿 v{intent.revision} · {plan.tasks.length} 项任务</p></div>
      <button disabled={!editable || action.busy} onClick={() => setShowImport(!showImport)}><Upload size={14} />导入草案</button></div>
    <Feedback error={action.error} notice={action.notice} />
    {intentRevision !== intent.revision && <p className="wb-callout">需求已更新。请保留当前草案，关闭后基于新需求重新编辑；旧版本不能直接发布。</p>}
    {showImport && <section className="wb-callout"><label>结构化 JSON<textarea rows={7} value={json} onChange={event => setJson(event.target.value)} placeholder='{"tasks": [...], "contracts": [], "issues": []}' /></label>
      <div className="wb-actions"><button disabled={!editable || !json.trim()} onClick={() => loadJson(json)}>读取草案</button><label className="wb-file-button">选择 JSON 文件<input type="file" accept=".json,application/json" disabled={!editable} onChange={async event => {
        const file = event.target.files?.[0]; if (!file) return; if (file.size > 256 * 1024) { action.setError("文件不能超过 256 KiB"); return; }
        try { loadJson(await file.text()); } catch { action.setError("无法读取文件"); }
      }} /></label></div><details className="wb-disclosure"><summary>查看格式示例</summary><pre>{JSON.stringify({ tasks: [{ key: "task-a", title: "任务名称", goal: "目标", boundary: "职责边界", acceptance: ["验收条件"], assigneeNodeId: data.viewer.id, dependencies: [], requirementRefs: [] }], contracts: [], issues: [] }, null, 2)}</pre></details></section>}
    {alignment && ["QUEUED", "RUNNING"].includes(alignment.status) && <p role="status" className="wb-callout">正在生成分工，完成后会自动更新。</p>}
    {(plan.issues?.length ?? 0) > 0 && <section className="wb-callout"><h3>待解决</h3><ul>{plan.issues!.map((issue, i) => <li key={i}>{issue}</li>)}</ul></section>}
    <div className="wb-plan-list">{plan.tasks.map((task, index) => <details key={task.key} className="wb-disclosure wb-plan-task" open={!task.title ? true : undefined}>
      <summary><span>{task.title || "新任务"}</span><span className="wb-muted">{data.nodes.find(node => node.id === task.assigneeNodeId)?.label ?? "未分配"}{task.dependencies.length ? ` · ${task.dependencies.length} 项依赖` : " · 独立任务"}</span></summary>
      <div className="wb-two-columns"><label>任务名称<input disabled={!editable} value={task.title} maxLength={160} onChange={event => patchTask(index, { title: event.target.value })} /></label>
        <label>负责人<select disabled={!editable} value={task.assigneeNodeId} onChange={event => patchTask(index, { assigneeNodeId: event.target.value })}>{data.nodes.map(node => <option key={node.id} value={node.id}>{node.label}</option>)}</select></label></div>
      <label>目标<textarea disabled={!editable} rows={2} value={task.goal} onChange={event => patchTask(index, { goal: event.target.value })} /></label>
      <label>职责边界<textarea disabled={!editable} rows={2} value={task.boundary} onChange={event => patchTask(index, { boundary: event.target.value })} /></label>
      <label>验收要求<textarea disabled={!editable} rows={3} value={task.acceptance.join("\n")} onChange={event => patchTask(index, { acceptance: event.target.value.split("\n") })} /></label>
      {plan.tasks.length > 1 && <fieldset className="wb-dependencies"><legend>依赖任务</legend>{plan.tasks.filter(item => item.key !== task.key).map(upstream => <label key={upstream.key} className="wb-check"><input type="checkbox" disabled={!editable}
        checked={task.dependencies.includes(upstream.key)} onChange={event => {
          const dependencies = event.target.checked ? [...task.dependencies, upstream.key] : task.dependencies.filter(key => key !== upstream.key);
          patchTask(index, { dependencies, dependencyEdges: dependencies.map(key => task.dependencyEdges?.find(edge => edge.upstreamKey === key) ?? { upstreamKey: key, mode: "HARD", contractKey: null, reason: "等待上游完成" }) });
        }} />{upstream.title}</label>)}</fieldset>}
      <div className="wb-actions"><button className="wb-danger-text" disabled={!editable || action.busy} onClick={() => {
        if (plan.tasks.some(item => item.dependencies.includes(task.key)) || plan.contracts?.some(contract => contract.providerTaskKey === task.key || contract.consumerTaskKeys.includes(task.key))) { action.setError("请先移除关联依赖和契约，再删除任务"); return; }
        setPlan(current => ({ ...current, tasks: current.tasks.filter(item => item.key !== task.key) })); setDirty(true);
      }}><Trash2 size={14} />删除任务</button></div>
    </details>)}</div>
    {editable && <button onClick={() => { setPlan(current => ({ ...current, tasks: [...current.tasks, { key: `task-${crypto.randomUUID().slice(0, 8)}`, title: "", goal: "", boundary: "", acceptance: [], assigneeNodeId: data.viewer.id, dependencies: [] }] })); setDirty(true); }}><Plus size={15} />新增任务</button>}
    {!!plan.contracts?.length && <details className="wb-disclosure"><summary>接口约定 · {plan.contracts.length}</summary>{plan.contracts.map(contract => <section key={contract.key}><h3>{contract.name}</h3><pre>{contract.signature}</pre><p>{contract.behavior.join("；")}</p><p className="wb-muted">{contract.providerTaskKey} → {contract.consumerTaskKeys.join("、")}</p></section>)}<p className="wb-muted">修订完整契约可重新导入 JSON。发布任务后由相关双方确认。</p></details>}
    <details className="wb-disclosure"><summary>待解决问题与高级编辑</summary><label>待解决问题（一行一项）<textarea disabled={!editable} rows={3} value={(plan.issues ?? []).join("\n")} onChange={event => { setPlan(current => ({ ...current, issues: event.target.value.split("\n") })); setDirty(true); }} /></label>
      <button disabled={!editable} onClick={() => { setJson(JSON.stringify(plan, null, 2)); setShowImport(true); }}>编辑完整 JSON</button></details>
    {canPublish && <label className="wb-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />已确认职责、依赖和验收，发布给负责人</label>}
    <div className="wb-sheet-footer">
      <button disabled={!editable || action.busy || !plan.tasks.length} className={dirty || !alignment ? "wb-primary" : ""} onClick={save}>{action.busy ? "处理中…" : "保存草稿"}</button>
      {captain && <button className={!dirty && alignment ? "wb-primary" : ""} disabled={!canPublish || !confirmed || action.busy} onClick={() => void action.run(async () => { await api.publish(alignment!.id); close(); }, "任务已发布")}>发布任务</button>}
      {dirty && <span className="wb-muted">先保存，再发布</span>}
    </div>
  </Sheet>;
}
