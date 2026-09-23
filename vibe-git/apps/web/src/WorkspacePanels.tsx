import { useEffect, useState } from "react";
import type { MarkdownDocument, PlanImpactPreview, ProjectModule, V20BootstrapPayload } from "@vibe-git/protocol";
import { api } from "./api";

const stateLabel: Record<string, string> = { planned: "待开始", in_progress: "进行中", blocked: "受阻", done: "已完成" };

export function ProposalComposer({ data, current, onClose, onSaved }: {
  data: V20BootstrapPayload; current: MarkdownDocument | undefined; onClose(): void; onSaved(): Promise<void>;
}) {
  const [file, setFile] = useState<{ filename: string; content: string } | null>(null);
  const [base] = useState(() => current ? { id: current.id, revision: current.revision } : null);
  const [selected, setSelected] = useState<string[]>(current?.impactedModuleIds ?? []);
  const [preview, setPreview] = useState<PlanImpactPreview | null>(null);
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [onClose]);
  const check = async () => {
    if (!file) { setError("请先选择 .md 文件"); return; }
    setPending(true); setError("");
    try { setPreview(await api.previewPlanImpact(file.filename, file.content, selected, base?.revision ?? 0)); setChecked(false); }
    catch (cause) { setPreview(null); setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPending(false); }
  };
  const submit = async () => {
    if (!file || !preview || !checked) return;
    setPending(true); setError("");
    try {
      const impact = { assessmentId: preview.assessmentId, confirmedModuleIds: selected, expectedRevision: base?.revision ?? 0 };
      if (base) await api.updatePlan(base.id, base.revision, file.filename, file.content, impact);
      else await api.uploadPlan(file.filename, file.content, impact);
      await onSaved(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setPreview(null); setChecked(false); }
    finally { setPending(false); }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal-card" role="dialog" aria-modal="true" aria-label={current ? "更新我的提案" : "提交我的提案"}>
      <header><div><small>项目提案</small><h2>{current ? "更新我的提案" : "提交我的提案"}</h2><p>从本机选择 Markdown 文件。每位成员在房间里保留一份最新提案。</p></div><button onClick={onClose} aria-label="关闭">×</button></header>
      <div className="modal-body">
        <label className="file-pick">选择 .md 文件<input type="file" accept=".md,text/markdown" onChange={async (event) => {
          const picked = event.currentTarget.files?.[0]; if (!picked) return;
          setPreview(null); setChecked(false);
          if (!/\.md$/i.test(picked.name) || picked.size > 256 * 1024) { setError("请选择不超过 256 KiB 的 .md 文件"); return; }
          try { setFile({ filename: picked.name, content: new TextDecoder("utf-8", { fatal: true }).decode(await picked.arrayBuffer()) }); setError(""); }
          catch { setError("文件必须为 UTF-8 Markdown"); }
        }}/></label>
        {file && <div className="selected-file"><b>{file.filename}</b><span>{Math.ceil(new TextEncoder().encode(file.content).length / 1024)} KiB · 本地待提交</span></div>}
        <h3>受影响模块</h3>
        {data.modules.length ? <div className="module-choices">{data.modules.map((module) => <label key={module.id}><input type="checkbox" checked={selected.includes(module.id)} onChange={(event) => {
          setSelected((old) => event.target.checked ? [...old, module.id] : old.filter((id) => id !== module.id)); setPreview(null); setChecked(false);
        }}/>{module.name}</label>)}</div> : <p className="subtle-note">房间尚未登记模块。可以提交提案，但影响范围会标为“未核实”；队长登记模块后可重新检查。</p>}
        <button disabled={!file || pending} onClick={() => void check()}>检查影响</button>
        {preview && <div className="impact-preview">
          <b>{preview.unverified ? "模块尚未拆分，影响未核实" : `已核对 ${preview.confirmedModuleIds.length} 个模块`}</b>
          {preview.suggestedModuleIds.length > 0 && <p>正文明确提到：{preview.suggestedModuleIds.map((id) => data.modules.find((item) => item.id === id)?.name ?? id).join("、")}。请检查选择是否完整。</p>}
          {preview.relatedPlans.length > 0 ? <p>另有 {preview.relatedPlans.length} 位成员的提案涉及相同模块，可能需要在对齐时比较。这里不判断两份内容是否矛盾。</p> : <p>当前未发现其他提案登记了相同模块；这不代表内容已经核对无冲突。</p>}
          <label><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)}/>我已核对所选模块及上述提示</label>
        </div>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <footer><button onClick={onClose}>取消</button><button className="primary" disabled={!preview || !checked || pending} onClick={() => void submit()}>{pending ? "处理中…" : "提交提案"}</button></footer>
    </section>
  </div>;
}

export function ModuleManager({ data, onSaved }: { data: V20BootstrapPayload; onSaved(): Promise<void> }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const download = () => {
    const content = JSON.stringify({ revision: data.moduleRevision, items: data.modules }, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: "application/json;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "project-schedule.json"; anchor.click(); URL.revokeObjectURL(url);
  };
  return <div className="module-manager"><div className="subsection-head"><h3>模块与工作包</h3><span>队长维护排期</span></div>
    <p className="subtle-note">下载当前排期，在本机编辑模块、工作包、计划日期和状态，再上传文件。模块和工作包的 ID 要保持稳定。</p>
    <p className="subtle-note">文件保留 revision、items；每项包含 id、name、status、plannedStart、plannedEnd，模块另含 packages，工作包另含 taskIds。状态可用 planned、in_progress、blocked、done；日期用 YYYY-MM-DD 或 null。</p>
    <div className="schedule-file-actions"><button onClick={download}>下载当前排期</button><label className={`button ${pending ? "disabled" : ""}`}>上传排期 JSON<input type="file" accept=".json,application/json" disabled={pending} onChange={async (event) => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!file) return;
      setPending(true); setError("");
      try {
        if (!/\.json$/i.test(file.name) || file.size > 256 * 1024) throw new Error("请选择不超过 256 KiB 的 JSON 排期文件");
        const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer())) as { revision?: number; items?: ProjectModule[] };
        if (!Array.isArray(parsed.items) || parsed.revision !== data.moduleRevision) throw new Error("文件修订与当前房间不符，请重新下载后编辑");
        await api.setModules(data.moduleRevision, parsed.items); await onSaved();
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
      finally { setPending(false); }
    }}/></label></div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}

export function ProjectTimeline({ data }: { data: V20BootstrapPayload }) {
  const rows = data.modules.flatMap((item) => [{ id: item.id, name: item.name, status: item.status, start: item.plannedStart, end: item.plannedEnd, nested: false },
    ...item.packages.map((pack) => ({ id: pack.id, name: pack.name, status: pack.status, start: pack.plannedStart, end: pack.plannedEnd, nested: true }))]);
  const dated = rows.filter((row) => row.start && row.end);
  const events = [...data.stages.flatMap((stage) => [{ label: `阶段 ${stage.sequence} 创建`, at: stage.createdAt }, ...(stage.completedAt ? [{ label: `阶段 ${stage.sequence} 完成`, at: stage.completedAt }] : [])]),
    ...data.tasks.flatMap((task) => [{ label: `${task.title} 发布`, at: task.publishedAt }, ...(task.startedAt ? [{ label: `${task.title} 开工`, at: task.startedAt }] : []), ...(task.doneAt ? [{ label: `${task.title} 确认完成`, at: task.doneAt }] : [])])].filter((entry) => entry.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
  const min = dated.length ? Math.min(...dated.map((row) => Date.parse(row.start!))) : 0;
  const max = dated.length ? Math.max(...dated.map((row) => Date.parse(row.end!) + 86400000)) : 0;
  const span = Math.max(86400000, max - min);
  return <div className="timeline-panel"><div className="subsection-head"><h3>项目时间表</h3><span>计划与实际时间分开记录</span></div>
    {dated.length ? <div className="gantt" role="table" aria-label="模块与工作包甘特图"><div className="gantt-scale"><span>模块 / 工作包</span><span>{new Date(min).toLocaleDateString("zh-CN")}</span><span>{new Date(max - 86400000).toLocaleDateString("zh-CN")}</span></div>{rows.map((row) => <div className="gantt-row" role="row" key={row.id}><div className={row.nested ? "nested" : ""}><b>{row.name}</b><small>{stateLabel[row.status]}</small></div><div className="gantt-track">{row.start && row.end ? <span className={`gantt-bar ${row.status}`} style={{ left: `${((Date.parse(row.start) - min) / span) * 100}%`, width: `${Math.max(2, ((Date.parse(row.end) + 86400000 - Date.parse(row.start)) / span) * 100)}%` }} title={`${row.start} 至 ${row.end}`}/> : <small>未排期</small>}</div></div>)}</div> : <div className="schedule-empty"><b>尚无计划日期</b><p>队长登记模块、工作包及计划起止日后，这里显示真实甘特图。</p></div>}
    <h4>实际进展</h4>{events.length ? <div className="event-list">{events.map((item, index) => <div key={`${item.label}-${index}`}><time>{new Date(item.at).toLocaleString("zh-CN")}</time><span>{item.label}</span></div>)}</div> : <p className="subtle-note">暂无阶段或任务时间记录。</p>}
  </div>;
}
