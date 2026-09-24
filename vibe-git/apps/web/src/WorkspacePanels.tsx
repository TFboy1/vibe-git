import { useEffect, useState, type CSSProperties } from "react";
import type { MarkdownDocument, ProjectModule, V20BootstrapPayload } from "@vibe-git/protocol";
import { api } from "./api";

const stateLabel: Record<string, string> = { planned: "待开始", in_progress: "进行中", blocked: "受阻", done: "已完成" };

export function ProposalComposer({ data, current, onClose, onSaved, inline = false }: {
  data: V20BootstrapPayload; current: MarkdownDocument | undefined; onClose(): void; onSaved(): Promise<void>; inline?: boolean;
}) {
  const [file, setFile] = useState<{ filename: string; content: string } | null>(null);
  const [base] = useState(() => current ? { id: current.id, revision: current.revision } : null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [onClose]);
  const submit = async () => {
    if (!file) return;
    setPending(true); setError("");
    try {
      if (base) await api.updatePlan(base.id, base.revision, file.filename, file.content);
      else await api.uploadPlan(file.filename, file.content);
      await onSaved(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPending(false); }
  };
  return <div className={inline ? "inline-composer" : "modal-backdrop"} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal-card" role="dialog" aria-modal={!inline} aria-label={current ? "更新我的提案" : "提交我的提案"}>
      <header><div><small>项目提案</small><h2>{current ? "更新我的提案" : "提交我的提案"}</h2><p>从本机选择 Markdown 文件。旧版本会保留，模块影响由队长发起的 Agent 对齐审核分析。</p></div><button onClick={onClose} aria-label="关闭">×</button></header>
      <div className="modal-body">
        <label className="file-pick"><span className="file-pick-icon" aria-hidden="true">↑</span><strong>选择 .md 文件</strong><small>UTF-8 · 最大 256 KiB</small><input type="file" accept=".md,text/markdown" aria-label="选择提案 Markdown 文件" onChange={async (event) => {
          const picked = event.currentTarget.files?.[0]; if (!picked) return;
          if (!/\.md$/i.test(picked.name) || picked.size > 256 * 1024) { setError("请选择不超过 256 KiB 的 .md 文件"); return; }
          try { setFile({ filename: picked.name, content: new TextDecoder("utf-8", { fatal: true }).decode(await picked.arrayBuffer()) }); setError(""); }
          catch { setError("文件必须为 UTF-8 Markdown"); }
        }}/></label>
        {file && <div className="selected-file"><b>{file.filename}</b><span>{Math.ceil(new TextEncoder().encode(file.content).length / 1024)} KiB · 本地待提交</span></div>}
        <div className="impact-preview"><b>模块影响交给队长端审核</b><p>提交时无需指定模块。{data.modules.length ? `队长端 Agent 会对照房间登记的 ${data.modules.length} 个模块分析正文，结果附在冻结的提案版本上。` : "房间尚未登记模块，审核前需先登记模块。"}审核完成前显示“待分析”。</p></div>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <footer><button onClick={onClose}>取消</button><button className="primary" disabled={!file || pending} onClick={() => void submit()}>{pending ? "处理中…" : current ? "保存更新" : "提交提案"}</button></footer>
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
  const dayNumber = (value: string) => Date.parse(`${value}T00:00:00Z`) / 86400000;
  const dayString = (value: number) => new Date(value * 86400000).toISOString().slice(0, 10);
  const today = dayNumber(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }));
  const firstPlanned = data.modules.flatMap((item) => [item.plannedStart, ...item.packages.map((pack) => pack.plannedStart)]).filter((value): value is string => !!value).sort()[0];
  const [weekStart, setWeekStart] = useState(() => firstPlanned ? dayNumber(firstPlanned) : today - 1);
  const [view, setView] = useState<"gantt" | "list">("gantt");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  useEffect(() => { if (firstPlanned) setWeekStart(dayNumber(firstPlanned)); }, [data.moduleRevision, firstPlanned]);
  const rows = data.modules.flatMap((module) => [
    { id: module.id, moduleId: module.id, name: module.name, status: module.status, start: module.plannedStart, end: module.plannedEnd, child: false, note: `${module.packages.length} 个任务包` },
    ...module.packages.map((pack) => {
      const owners = [...new Set(pack.taskIds.map((id) => data.tasks.find((task) => task.id === id)?.assigneeNodeId).filter((id): id is string => !!id))];
      const owner = owners.length === 1 ? data.nodes.find((node) => node.id === owners[0])?.label ?? "负责人未连接" : owners.length > 1 ? "多人协作" : "负责人未登记";
      return { id: pack.id, moduleId: module.id, name: pack.name, status: pack.status, start: pack.plannedStart, end: pack.plannedEnd, child: true, note: `${owner} · 包 ${pack.id}` };
    })
  ]);
  const events = [
    ...data.stages.flatMap((stage) => [
      { label: `阶段 ${stage.sequence} 创建`, at: stage.createdAt },
      ...(stage.completedAt ? [{ label: `阶段 ${stage.sequence} 完成`, at: stage.completedAt }] : [])
    ]),
    ...data.tasks.flatMap((task) => [
      { label: `${task.title} 发布`, at: task.publishedAt },
      ...(task.startedAt ? [{ label: `${task.title} 开工`, at: task.startedAt }] : []),
      ...(task.finishedAt ? [{ label: `${task.title} 执行结束`, at: task.finishedAt }] : []),
      ...(task.doneAt ? [{ label: `${task.title} 确认完成`, at: task.doneAt }] : [])
    ])
  ].filter((event) => event.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
  const visibleRows = rows.filter((row) => !row.child || !collapsed.includes(row.moduleId));
  const days = Array.from({ length: 7 }, (_, index) => weekStart + index);
  const dayLabel = (value: number) => new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", timeZone: "UTC" }).format(new Date(value * 86400000));
  const weekLabel = new Intl.DateTimeFormat("zh-CN", { weekday: "short", timeZone: "UTC" });
  const tone = (status: string) => status === "in_progress" ? "blue" : status === "blocked" ? "amber" : status === "done" ? "green" : "";
  const showBar = (row: typeof rows[number]) => {
    if (!row.start || !row.end) return <span className="unscheduled">待排期</span>;
    const start = dayNumber(row.start);
    const end = dayNumber(row.end);
    if (end < weekStart || start > weekStart + 6) return <span className="unscheduled">本周无计划</span>;
    const style = { "--start": Math.max(1, start - weekStart + 1), "--span": Math.min(end, weekStart + 6) - Math.max(start, weekStart) + 1 } as CSSProperties;
    return <span className={`bar ${tone(row.status)}`} style={style} title={`计划：${row.start} 至 ${row.end}`}/>;
  };
  return <section className="approved-timeline" aria-labelledby="timeline-title">
    <div className="section-head"><div><h2 id="timeline-title">项目时间线</h2><p>按模块查看计划时间。虚线标出今天，房间时区为 Asia/Shanghai。</p></div>
      <div className="section-actions"><button className="range-button" onClick={() => setWeekStart((value) => value - 7)} aria-label="上一周">‹</button><span className="timezone">{dayLabel(weekStart)} — {dayLabel(weekStart + 6)}</span><button className="range-button" onClick={() => setWeekStart((value) => value + 7)} aria-label="下一周">›</button><div className="seg" role="group" aria-label="时间线视图"><button className={view === "gantt" ? "active" : ""} aria-pressed={view === "gantt"} onClick={() => setView("gantt")}>甘特图</button><button className={view === "list" ? "active" : ""} aria-pressed={view === "list"} onClick={() => setView("list")}>列表</button></div></div>
    </div>
    {view === "gantt" ? <div className="panel gantt" role="table" aria-label="模块与任务包甘特图"><div className="gantt-head" role="row"><div className="item-head">模块 / 任务包</div><div className="days">{days.map((day) => <div className={`day ${day === today ? "today" : ""}`} key={day}><span>{day === today ? "今天 · " : ""}{weekLabel.format(new Date(day * 86400000))}</span><b>{dayString(day).slice(-2)}</b></div>)}</div></div>
      {visibleRows.length ? visibleRows.map((row) => <div className={`gantt-row ${row.child ? "" : "module"}`} role="row" key={row.id}><div className={`item ${row.child ? "child" : ""}`}>{row.child ? <span className="indent"/> : <button className="expand" aria-expanded={!collapsed.includes(row.id)} aria-label={`${collapsed.includes(row.id) ? "展开" : "收起"}${row.name}`} onClick={() => setCollapsed((old) => old.includes(row.id) ? old.filter((id) => id !== row.id) : [...old, row.id])}>⌄</button>}<div className="item-main"><strong>{row.name}</strong><small>{row.note}</small></div><span className={`status ${tone(row.status)}`}>{stateLabel[row.status]}</span></div><div className={`timeline ${today < weekStart || today > weekStart + 6 ? "no-today" : ""}`} style={{ "--today-left": `${((today - weekStart) + .5) * 100 / 7}%` } as CSSProperties}>{showBar(row)}</div></div>) : <div className="schedule-empty"><b>尚未拆分模块</b><p>队长登记真实模块和排期后，这里会显示项目时间线。</p></div>}
      <div className="gantt-foot"><span className="legend"><i/>计划区间</span><span className="legend today"><i/>今天</span><span>甘特条显示计划时间，不代表完成百分比</span></div></div>
      : <div className="panel list-view active"><div className="list-row list-head"><span>模块 / 任务包</span><span>负责人</span><span>状态</span><span>计划时间</span></div>{rows.length ? rows.map((row) => <div className="list-row" key={row.id}><span><strong>{row.name}</strong><small>{row.child ? "任务包" : "模块"}</small></span><span>{row.note.split(" · ")[0]}</span><span><span className={`status ${tone(row.status)}`}>{stateLabel[row.status]}</span></span><span>{row.start && row.end ? `${row.start} — ${row.end}` : "待排期"}</span></div>) : <div className="schedule-empty">尚未拆分模块</div>}</div>}
    <details className="actual-progress panel"><summary>实际进展</summary>{events.length ? <div className="actual-events">{events.map((event, index) => <div key={`${event.label}-${index}`}><time>{new Date(event.at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</time><span>{event.label}</span></div>)}</div> : <p className="subtle-note">暂无阶段或任务时间记录。</p>}</details>
  </section>;
}
