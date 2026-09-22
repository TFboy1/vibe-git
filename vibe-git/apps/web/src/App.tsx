import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity, ArrowDownToLine, Bot, Check, ChevronRight, Circle, Cloud, Copy, FileText, GitBranch,
  GitCommitHorizontal, LogIn, Pause, Play, RefreshCw, RotateCw, ShieldCheck, Upload, Users, X
} from "lucide-react";
import type { AlignmentRun, CollaborationNode, MarkdownDocument, StageTask, V20BootstrapPayload } from "@vibe-git/protocol";
import { api, ApiError } from "./api";

const time = (value: string | null) => value ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—";
const short = (value: string | null | undefined, size = 8) => value ? value.slice(0, size) : "—";

function Pill({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "green" | "amber" | "red" | "blue" }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

function Markdown({ children }: { children: string }) {
  const lines = children.replace(/\r/g, "").split("\n");
  const result: ReactNode[] = [];
  let list: string[] = [];
  let code: string[] | null = null;
  const flushList = () => {
    if (list.length) { result.push(<ul key={`list-${result.length}`}>{list.map((item, index) => <li key={index}>{item}</li>)}</ul>); list = []; }
  };
  for (const line of lines) {
    if (line.startsWith("```")) {
      flushList();
      if (code) { result.push(<pre key={`code-${result.length}`}><code>{code.join("\n")}</code></pre>); code = null; }
      else code = [];
      continue;
    }
    if (code) { code.push(line); continue; }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushList(); const level = heading[1]?.length ?? 1; const text = heading[2] ?? "";
      result.push(level === 1 ? <h2 key={result.length}>{text}</h2> : level === 2 ? <h3 key={result.length}>{text}</h3> : <h4 key={result.length}>{text}</h4>);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) { list.push(bullet[1] ?? ""); continue; }
    flushList();
    if (/^---+$/.test(line.trim())) result.push(<hr key={result.length}/>);
    else if (line.trim()) result.push(<p key={result.length}>{line}</p>);
  }
  flushList();
  if (code) result.push(<pre key={`code-${result.length}`}><code>{code.join("\n")}</code></pre>);
  return <div className="markdown">{result}</div>;
}

function Section({ id, eyebrow, title, aside, children }: { id: string; eyebrow: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return <section id={id} className="section">
    <header className="section-title"><div><span>{eyebrow}</span><h2>{title}</h2></div>{aside && <div className="section-actions">{aside}</div>}</header>
    {children}
  </section>;
}

function FileButton({ name, label, onFile, disabled }: { name: "plan.md" | "task.md" | "change.md"; label: string; onFile(content: string): void; disabled?: boolean }) {
  return <label className={`button ${disabled ? "disabled" : ""}`}><Upload size={15}/>{label}
    <input type="file" accept=".md,text/markdown,text/plain" disabled={disabled} onChange={async (event) => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
      if (!file) return;
      if (file.name !== name) { window.alert(`文件名必须是 ${name}`); return; }
      if (file.size > 256 * 1024) { window.alert(`${name} 不能超过 256 KiB`); return; }
      try { onFile(new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer())); }
      catch { window.alert(`${name} 必须是有效 UTF-8`); }
    }}/>
  </label>;
}

function Empty({ children }: { children: ReactNode }) { return <div className="empty"><FileText size={22}/><p>{children}</p></div>; }

function Welcome({ error }: { error: string | null }) {
  const connect = "vibe-git connect <队长提供的 join-url>\nvibe-git open";
  return <main className="welcome">
    <div className="welcome-mark"><GitBranch size={25}/></div>
    <span className="kicker">VIBE—GIT · 0.20</span>
    <h1>网页只观察，身份从 CLI 建立。</h1>
    <p>这里不输入项目名称或成员名字。队长启动 Host，成员在自己的工作区运行加入命令，节点会自动注册。</p>
    <div className="terminal"><code>{connect}</code><button onClick={() => navigator.clipboard.writeText(connect)}><Copy size={15}/>复制</button></div>
    {error && <div className="welcome-error">{error}</div>}
    <small>如果你已经连接，请在终端运行 <b>vibe-git open</b>，一次性票据会建立安全的浏览器会话。</small>
  </main>;
}

function NodeCard({ node, viewer, onRevoke }: { node: CollaborationNode; viewer: CollaborationNode; onRevoke(id: string): void }) {
  return <article className="node-card">
    <div className="node-top"><div className={`node-orb ${node.connected ? "online" : ""}`}>{node.role === "captain" ? <ShieldCheck size={18}/> : <Circle size={14}/>}</div><div><b>{node.label}</b><code>{short(node.id, 18)}</code></div><Pill tone={node.connected ? "green" : "plain"}>{node.connected ? "在线" : "离线"}</Pill></div>
    <div className="node-grid"><span>审核 Codex<b>{node.auditCodex}</b></span><span>开发 Codex<b>{node.workCodex}</b></span><span>作业负载<b>{node.activeJobCount}</b></span><span>工作区<b>{node.workspaceReady ? "就绪" : "未就绪"}</b></span></div>
    {node.git && <div className="git-line"><GitCommitHorizontal size={14}/><b>{node.git.branch}</b><code>{short(node.git.headSha)}</code><span>{node.git.dirty ? "有修改" : "干净"}</span></div>}
    {node.rateLimits.length > 0 && <div className="quota">{node.rateLimits.map((item) => <span key={item.label}>{item.label}<i><em style={{ width: `${item.remainingPercent ?? 0}%` }}/></i><b>{item.remainingPercent == null ? "?" : `${Math.round(item.remainingPercent)}%`}</b></span>)}</div>}
    {viewer.role === "captain" && node.role !== "captain" && <button className="text danger" onClick={() => onRevoke(node.id)}>撤销节点</button>}
  </article>;
}

function AlignmentView({ alignment, data, run }: { alignment: AlignmentRun; data: V20BootstrapPayload; run(work: () => Promise<unknown>, message: string): void }) {
  const captain = data.viewer.role === "captain";
  return <div className="alignment-layout">
    <article className="paper"><div className="paper-meta"><Pill tone={alignment.status === "READY" ? "green" : alignment.status === "FAILED" ? "red" : "amber"}>{alignment.status}</Pill><code>{alignment.id}</code><span>{time(alignment.createdAt)}</span></div>
      {alignment.alignmentMarkdown ? <Markdown>{alignment.alignmentMarkdown}</Markdown> : <div className="processing"><Bot size={20}/><span>{alignment.error || "专用 Codex 正在对齐需求与验收边界…"}</span></div>}
    </article>
    <div className="drafts"><h3>任务草稿</h3>{alignment.tasks.map((task) => <article key={task.id} className="draft-card"><div><code>{task.id}</code><Pill>{task.dependencies.length ? `${task.dependencies.length} 依赖` : "可独立"}</Pill></div><h4>{task.title}</h4><p>{task.goal}</p><small>{task.boundary}</small>{captain && alignment.status === "READY" ? <select value={task.assigneeNodeId} onChange={(event) => run(() => api.assign(alignment.id, task.id, event.target.value), "任务已改派")}>{data.nodes.map((node) => <option value={node.id} key={node.id}>{node.label}</option>)}</select> : <b>{data.nodes.find((node) => node.id === task.assigneeNodeId)?.label ?? short(task.assigneeNodeId)}</b>}</article>)}</div>
  </div>;
}

function TaskCard({ task, data, run, download }: { task: StageTask; data: V20BootstrapPayload; run(work: () => Promise<unknown>, message: string): void; download(task: StageTask): void }) {
  const mine = task.assigneeNodeId === data.viewer.id;
  const owner = data.nodes.find((node) => node.id === task.assigneeNodeId);
  const canStart = mine && ["PUBLISHED", "READY", "FAILED"].includes(task.status);
  return <article className={`task-card ${task.status === "PAUSED" ? "paused" : ""}`}>
    <div className="task-header"><div><code>{task.id}</code><h3>{task.title}</h3></div><Pill tone={task.status === "DONE" ? "green" : task.status === "FAILED" || task.status === "BLOCKED" ? "red" : task.status === "IN_PROGRESS" ? "blue" : "amber"}>{task.status}</Pill></div>
    <p className="goal">{task.goal}</p><div className="boundary"><span>边界</span>{task.boundary}</div>
    <ul className="acceptance">{task.acceptance.map((item) => <li key={item}><Check size={13}/>{item}</li>)}</ul>
    <div className="task-foot"><span>{owner?.label ?? short(task.assigneeNodeId)}</span><span>r{task.revision}</span>{task.lastGit && <code>{short(task.lastGit.headSha)}</code>}</div>
    {(mine || data.viewer.role === "captain") && <div className="button-row"><button onClick={() => download(task)}><ArrowDownToLine size={14}/>下载</button>{mine && <FileButton name="task.md" label="上传细化" disabled={!(["PUBLISHED", "REFINING", "READY", "FAILED", "PAUSED"].includes(task.status))} onFile={(content) => run(() => api.uploadTask(task.id, content), "task.md 已上传")}/>} {canStart && <button className="primary" onClick={() => run(() => api.taskStart(task.id), "开工命令已发送到本机 Codex")}><Play size={14}/>开工</button>}{mine && ["STARTING", "IN_PROGRESS", "WAITING_CONFIRMATION"].includes(task.status) && <button onClick={() => run(() => api.taskSync(task.id), "已请求立即同步")}><RefreshCw size={14}/>同步</button>}{mine && task.status === "WAITING_CONFIRMATION" && <button className="primary" onClick={() => run(() => api.taskDone(task.id), "任务已确认完成")}><Check size={14}/>确认完成</button>}</div>}
  </article>;
}

export function App() {
  const [data, setData] = useState<V20BootstrapPayload | null>(null);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async (quiet = false) => {
    try { setData(await api.bootstrap()); setUnauthorized(null); }
    catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) { setData(null); setUnauthorized(error.message); }
      else if (!quiet) setNotice(error instanceof Error ? error.message : String(error));
    }
  }, []);
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(true), 8_000); return () => window.clearInterval(timer); }, [refresh]);

  const run = useCallback((work: () => Promise<unknown>, message: string) => {
    if (busy) return; setBusy(true); setNotice(null);
    void work().then(() => { setNotice(message); return refresh(true); }).catch((error) => setNotice(error instanceof Error ? error.message : String(error))).finally(() => setBusy(false));
  }, [busy, refresh]);

  const downloadTask = useCallback((task: StageTask) => {
    run(async () => {
      const value = await api.taskDetail(task.id); const blob = new Blob([value.markdown], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "task.md"; anchor.click(); URL.revokeObjectURL(url);
    }, "task.md 已下载");
  }, [run]);

  if (!data) return <Welcome error={unauthorized}/>;
  const latestAlignment = [...data.alignments].reverse().find((item) => item.status !== "PUBLISHED") ?? [...data.alignments].reverse()[0];
  const currentStage = [...data.stages].reverse().find((item) => item.status !== "COMPLETED") ?? [...data.stages].reverse()[0];
  const tasks = currentStage ? data.tasks.filter((task) => task.stageId === currentStage.id) : [];
  const latestReview = [...data.reviews].reverse()[0];
  const queuedChanges = data.pullRequests.filter((item) => item.status === "QUEUED");
  const captain = data.viewer.role === "captain";

  return <Fragment>
    <header className="topbar"><a className="brand" href="#nodes"><span><GitBranch size={18}/></span><b>VIBE—GIT</b><small>0.20</small></a><nav>{[["nodes", "节点"], ["plans", "Plans"], ["alignment", "对齐稿"], ["tasks", "任务"], ["changes", "变更"], ["messages", "消息"]].map(([href, label]) => <a href={`#${href}`} key={href}>{label}</a>)}</nav><div className="viewer"><i className={data.viewer.connected ? "online" : ""}/><div><b>{data.viewer.label}</b><small>{captain ? "Captain" : "Member"}</small></div></div></header>
    <main className="shell">
      <section className="overview"><div><span className="kicker">CLI-FIRST COLLABORATION</span><h1>把计划留在文件里，<br/>把协作状态放到眼前。</h1><p>网页没有伪造身份和业务输入框。每个节点持有自己的凭据、工作区与 Codex；Host 只协调版本、任务与审计租约。</p></div><div className="metrics"><article><Users/><b>{data.nodes.filter((node) => node.connected).length}</b><span>在线节点</span></article><article><Bot/><b>{data.auditPool.available}</b><span>审核池可用</span></article><article><Activity/><b>R{data.room.requirementRevision}</b><span>需求版本</span></article><article><GitBranch/><b>{tasks.filter((task) => task.status === "DONE").length}/{tasks.length}</b><span>阶段任务</span></article></div></section>

      <Section id="nodes" eyebrow="01 · CONNECTIONS" title="节点" aside={captain && <><button onClick={() => run(async () => { const invite = await api.invite(); await navigator.clipboard.writeText(invite.command); }, "加入命令已复制")}><Copy size={14}/>复制加入命令</button><button onClick={() => run(() => api.rotateInvite(), "邀请密钥已轮换")}><RotateCw size={14}/>轮换邀请</button></>}>
        <div className="node-list">{data.nodes.map((node) => <NodeCard key={node.id} node={node} viewer={data.viewer} onRevoke={(id) => run(() => api.revokeNode(id), "节点已撤销")}/>)}</div>
        {captain && data.tunnel && <div className="tunnel"><Cloud size={17}/><div><b>Cloudflare Quick Tunnel</b><span>{data.tunnel.url || data.tunnel.phase}</span></div><Pill tone={data.tunnel.running ? "green" : "amber"}>{data.tunnel.running ? "运行中" : data.tunnel.phase}</Pill><div className="button-row">{!data.tunnel.installed && <button onClick={() => run(() => api.tunnelInstall(), "cloudflared 已安装")}>安装</button>}{!data.tunnel.running ? <button onClick={() => run(() => api.tunnelStart(), "Tunnel 已启动")}>启动</button> : <button onClick={() => run(() => api.tunnelStop(), "Tunnel 已停止")}>停止</button>}</div></div>}
      </Section>

      <Section id="plans" eyebrow="02 · INPUT" title="Plans" aside={<FileButton name="plan.md" label="上传 plan.md" onFile={(content) => run(() => api.uploadPlan(content), "plan.md 已提交")}/>}>
        {data.plans.length ? <div className="plan-grid">{data.plans.map((plan) => <article className="paper compact" key={plan.id}><div className="paper-meta"><b>{data.nodes.find((node) => node.id === plan.ownerNodeId)?.label ?? short(plan.ownerNodeId)}</b><Pill>r{plan.revision}</Pill><code>{short(plan.sha256)}</code></div><Markdown>{plan.content}</Markdown></article>)}</div> : <Empty>还没有 plan.md。每位成员都可用 CLI 或右上角文件按钮提交；至少一份即可由队长开始对齐。</Empty>}
        {captain && <div className="section-bottom"><span>开始时会冻结当前每个节点的最新版本；后续上传自动进入下一轮。</span><button className="primary" disabled={!data.plans.length || busy} onClick={() => run(() => api.startAlignment(), "需求对齐已进入审核池")}><Bot size={15}/>开始对齐</button></div>}
      </Section>

      <Section id="alignment" eyebrow="03 · ALIGNMENT" title="对齐稿" aside={latestAlignment && captain && latestAlignment.status === "READY" && <button className="primary" onClick={() => run(() => api.publish(latestAlignment.id), "任务阶段已发布")}><ChevronRight size={15}/>发布任务</button>}>
        {latestAlignment ? <AlignmentView alignment={latestAlignment} data={data} run={run}/> : <Empty>队长开始对齐后，专用 Codex 节点会生成 alignment.md、tasks.md 和结构化任务。</Empty>}
      </Section>

      <Section id="tasks" eyebrow="04 · DELIVERY" title="任务" aside={currentStage && <div className="stage-label"><Pill tone={currentStage.status === "ACTIVE" ? "green" : currentStage.status === "COMPLETED" ? "plain" : "amber"}>{currentStage.status}</Pill><b>阶段 {currentStage.sequence}</b><span>需求 R{currentStage.requirementRevision}</span></div>}>
        {tasks.length ? <div className="task-grid">{tasks.map((task) => <TaskCard key={task.id} task={task} data={data} run={run} download={downloadTask}/>)}</div> : <Empty>尚未发布正式任务。对齐结果必须由队长确认后发布。</Empty>}
      </Section>

      <Section id="changes" eyebrow="05 · CHANGE CONTROL" title="变更" aside={<FileButton name="change.md" label="上传 change.md" disabled={!currentStage || currentStage.status === "COMPLETED"} onFile={(content) => run(() => api.uploadChange(content), "需求变更已提交")}/>}>
        <div className="change-layout"><div className="change-list">{data.pullRequests.length ? [...data.pullRequests].reverse().map((change) => <button className="change-row" key={change.id} onClick={() => run(async () => { const doc = await api.document(change.documentId); const blob = new Blob([doc.content], { type: "text/markdown;charset=utf-8" }); const url = URL.createObjectURL(blob); window.open(url, "_blank", "noopener"); setTimeout(() => URL.revokeObjectURL(url), 30_000); }, "已打开 change.md")}><span><code>{change.id}</code><b>{data.nodes.find((node) => node.id === change.submitterNodeId)?.label}</b></span><Pill tone={change.status === "APPLIED" ? "green" : change.status === "REJECTED" ? "red" : "amber"}>{change.status}</Pill><small>{time(change.createdAt)}</small></button>) : <Empty>没有需求变更。开发期间可以持续提交，普通成员不能开启审核。</Empty>}</div>
          <article className="review-card"><div className="review-title"><Bot size={20}/><div><span>主控 Agent</span><h3>影响审核</h3></div>{latestReview && <Pill tone={latestReview.status === "AWAITING_CAPTAIN" ? "amber" : latestReview.status === "APPLIED" ? "green" : "plain"}>{latestReview.status}</Pill>}</div>{latestReview?.summaryMarkdown ? <Markdown>{latestReview.summaryMarkdown}</Markdown> : <p>变更会按阶段合并审核。开发结束后自动开始；队长也可强制提前审核，只暂停受影响任务。</p>}{latestReview?.affectedNodeIds.length ? <div className="affected"><span>受影响节点</span>{latestReview.affectedNodeIds.map((id) => <Pill key={id}>{data.nodes.find((node) => node.id === id)?.label ?? short(id)}</Pill>)}</div> : null}<div className="button-row">{captain && queuedChanges.length > 0 && currentStage?.status === "ACTIVE" && <button onClick={() => run(() => api.forceReview(), "已强制开始影响审核")}><Pause size={14}/>立即审核</button>}{captain && latestReview?.status === "AWAITING_CAPTAIN" && <><button className="primary" onClick={() => run(() => api.applyReview(latestReview.id), "审核结果已应用")}><Check size={14}/>应用</button><button className="danger" onClick={() => run(() => api.rejectReview(latestReview.id), "审核结果已退回")}><X size={14}/>退回</button></>}</div></article></div>
      </Section>

      <Section id="messages" eyebrow="06 · INBOX" title="消息" aside={<button onClick={() => void refresh()}><RefreshCw size={14}/>刷新</button>}>
        {data.notifications.length ? <div className="messages">{data.notifications.map((item) => <article key={item.id}><span className={`message-icon ${item.type.toLowerCase()}`}>{item.type === "TASK" ? <GitBranch size={15}/> : item.type === "REVIEW" ? <Bot size={15}/> : <Activity size={15}/>}</span><div><div><b>{item.title}</b><Pill>{item.type}</Pill></div><p>{item.body}</p></div><time>{time(item.createdAt)}</time></article>)}</div> : <Empty>暂无消息。通知持久保存，离线节点重连后也能看到。</Empty>}
      </Section>
    </main>
    {notice && <button className="toast" onClick={() => setNotice(null)}>{busy && <span className="spinner"/>}{notice}<X size={14}/></button>}
  </Fragment>;
}
