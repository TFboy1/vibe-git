import {
  Fragment,
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";
import {
  Activity,
  ArrowDownToLine,
  Bot,
  Check,
  ChevronRight,
  Circle,
  Cloud,
  Copy,
  Eye,
  FileText,
  GitBranch,
  GitCommitHorizontal,
  Pause,
  Play,
  Radio,
  RefreshCw,
  RotateCw,
  ScanLine,
  ShieldCheck,
  Upload,
  Workflow,
  X
} from "lucide-react";
import type {
  AlignmentRun,
  CollaborationNode,
  MarkdownDocument,
  StageTask,
  V20BootstrapPayload
} from "@vibe-git/protocol";
import { api, ApiError } from "./api";
import { ModuleManager, ProjectTimeline, ProposalComposer } from "./WorkspacePanels";

const NAV_ITEMS = [
  ["overview", "房间总览", "01"],
  ["plans", "项目提案", "02"],
  ["tasks", "工作项", "03"],
  ["alignment", "对齐与裁决", "04"],
  ["changes", "变更审核", "05"],
  ["nodes", "成员与连接", "06"],
  ["messages", "消息", "07"]
] as const;

const SATELLITE_POSITIONS = [
  { x: 50, y: 15 },
  { x: 82, y: 31 },
  { x: 79, y: 72 },
  { x: 50, y: 85 },
  { x: 18, y: 69 },
  { x: 20, y: 29 }
] as const;

const time = (value: string | null) => value
  ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
  : "—";
const short = (value: string | null | undefined, size = 8) => value ? value.slice(0, size) : "—";
const statusText: Record<string, string> = {
  DRAFT: "草稿", PUBLISHED: "已发布", REFINING: "细化中", READY: "待发布", STARTING: "准备开工",
  IN_PROGRESS: "进行中", WAITING_CONFIRMATION: "待本人确认", PAUSED: "已暂停", BLOCKED: "受阻", DONE: "已确认完成", FAILED: "失败",
  QUEUED: "排队中", RUNNING: "处理中", NEEDS_DECISION: "待裁决", ACTIVE: "进行中", COMPLETED: "已完成",
  REVIEWING: "审核中", AWAITING_APPLY: "待应用", AWAITING_CAPTAIN: "待队长处理", NEEDS_EVIDENCE: "待补证",
  APPLIED: "已应用", REJECTED: "已退回", IN_REVIEW: "审核中", CANCELLED: "已取消"
};
const labelStatus = (value: string) => statusText[value] ?? value;

function BrandGlyph() {
  return <svg viewBox="0 0 36 36" aria-hidden="true">
    <path d="M8 8v12.5c0 5 3.2 7.5 8.4 7.5H28"/>
    <path d="M8 14.5h12.5L28 7M20.5 14.5 28 22"/>
    <circle cx="8" cy="8" r="2.2"/><circle cx="28" cy="7" r="2.2"/><circle cx="28" cy="22" r="2.2"/><circle cx="28" cy="28" r="2.2"/>
  </svg>;
}

function Pill({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "green" | "amber" | "red" | "blue" }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

function Markdown({ children }: { children: string }) {
  const lines = children.replace(/\r/g, "").split("\n");
  const result: ReactNode[] = [];
  let list: string[] = [];
  let code: string[] | null = null;
  const flushList = () => {
    if (list.length) {
      result.push(<ul key={`list-${result.length}`}>{list.map((item, index) => <li key={index}>{item}</li>)}</ul>);
      list = [];
    }
  };
  for (const line of lines) {
    if (line.startsWith("```")) {
      flushList();
      if (code) {
        result.push(<pre key={`code-${result.length}`}><code>{code.join("\n")}</code></pre>);
        code = null;
      } else code = [];
      continue;
    }
    if (code) { code.push(line); continue; }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushList();
      const level = heading[1]?.length ?? 1;
      const text = heading[2] ?? "";
      result.push(level === 1
        ? <h2 key={result.length}>{text}</h2>
        : level === 2
          ? <h3 key={result.length}>{text}</h3>
          : <h4 key={result.length}>{text}</h4>);
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

function Section({ id, eyebrow, title, aside, children, active }: {
  id: string;
  eyebrow: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  active?: boolean;
}) {
  const [number = "", label = eyebrow] = eyebrow.split(" · ");
  return <section id={id} className={`section section-${id}`} hidden={!active}>
    <span className="chapter-number" aria-hidden="true">{number}</span>
    <header className="section-title">
      <div className="section-heading">
        <span className="section-eyebrow"><i/>{label}</span>
        <h2>{title}</h2>
      </div>
      {aside && <div className="section-actions">{aside}</div>}
    </header>
    <div className="section-content">{children}</div>
  </section>;
}

function FileButton({ label, onFile, disabled }: {
  label: string;
  onFile(filename: string, content: string): void;
  disabled?: boolean;
}) {
  return <label className={`button upload-button ${disabled ? "disabled" : ""}`}>
    <Upload size={14}/><span>{label}</span><i aria-hidden="true"/>
    <input type="file" accept=".md,text/markdown,text/plain" disabled={disabled} onChange={async (event) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (!file) return;
      if (!/\.md$/i.test(file.name)) { window.alert("请选择任意一个 .md 文件"); return; }
      if (file.size > 256 * 1024) { window.alert("Markdown 不能超过 256 KiB"); return; }
      try {
        onFile(file.name, new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()));
      } catch {
        window.alert("Markdown 必须是有效 UTF-8");
      }
    }}/>
  </label>;
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">
    <div className="empty-radar"><i/><i/><FileText size={19}/></div>
    <div><b>暂无内容</b><p>{children}</p></div>
  </div>;
}

function BootScreen() {
  return <main className="boot-screen">
    <div className="ambient-grid" aria-hidden="true"/>
    <div className="boot-orbit" aria-hidden="true"><i/><i/><span><BrandGlyph/></span></div>
    <code>ESTABLISHING LOCAL SESSION</code>
    <p>正在读取节点、阶段与审核池状态</p>
  </main>;
}

function Welcome({ error }: { error: string | null }) {
  const connect = "vibe-git connect <队长提供的 join-url>\nvibe-git open";
  return <main className="welcome">
    <div className="ambient-grid" aria-hidden="true"/>
    <div className="welcome-shell is-visible" data-reveal>
      <div className="welcome-mark"><BrandGlyph/></div>
      <span className="kicker">VIBE—GIT / LOCAL ACCESS</span>
      <h1>连接房间</h1>
      <p>这里不输入项目名称或成员名字。队长启动 Host，成员在自己的工作区运行加入命令，节点会自动注册。</p>
      <div className="terminal">
        <span className="terminal-lights"><i/><i/><i/></span>
        <code>{connect}</code>
        <button onClick={() => navigator.clipboard.writeText(connect)}><Copy size={14}/>复制</button>
      </div>
      {error && <div className="welcome-error">{error}</div>}
      <small>已经连接？在终端运行 <b>vibe-git open</b>，一次性票据会建立安全会话。</small>
    </div>
  </main>;
}

function NodeCard({ node, viewer, onRevoke }: {
  node: CollaborationNode;
  viewer: CollaborationNode;
  onRevoke(id: string): void;
}) {
  return <article className={`node-card ${node.connected ? "is-online" : "is-offline"}`}>
    <div className="node-scan" aria-hidden="true"/>
    <div className="node-top">
      <div className={`node-orb ${node.connected ? "online" : ""}`}>
        {node.role === "captain" ? <ShieldCheck size={17}/> : <Circle size={12}/>}<i/>
      </div>
      <div><span>{node.role === "captain" ? "队长" : "成员"}</span><b>{node.label}</b><code>{short(node.id, 18)}</code></div>
      <Pill tone={node.connected ? "green" : "plain"}>{node.connected ? "在线" : "离线"}</Pill>
    </div>
    <div className="node-grid">
      <span>审核 Codex<b>{node.auditCodex}</b></span>
      <span>开发 Codex<b>{node.workCodex}</b></span>
      <span>作业负载<b>{String(node.activeJobCount).padStart(2, "0")}</b></span>
      <span>工作区<b>{node.workspaceReady ? "就绪" : "未就绪"}</b></span>
    </div>
    {node.git && <div className="git-line"><GitCommitHorizontal size={13}/><b>{node.git.branch}</b><code>{short(node.git.headSha)}</code><span>{node.git.dirty ? "有修改" : "干净"}</span></div>}
    {node.rateLimits.length > 0 && <div className="quota">{node.rateLimits.map((item) => <span key={item.label}>{item.label}<i><em style={{ width: `${item.remainingPercent ?? 0}%` }}/></i><b>{item.remainingPercent == null ? "?" : `${Math.round(item.remainingPercent)}%`}</b></span>)}</div>}
    {viewer.role === "captain" && node.role !== "captain" && <button className="text danger" onClick={() => onRevoke(node.id)}>撤销节点</button>}
  </article>;
}

function PlanCard({ plan, data, download, onEdit, onWithdraw }: {
  plan: MarkdownDocument;
  data: V20BootstrapPayload;
  download(plan: MarkdownDocument): void;
  onEdit(): void;
  onWithdraw(): void;
}) {
  const mine = plan.ownerNodeId === data.viewer.id;
  const owner = data.nodes.find((node) => node.id === plan.ownerNodeId);
  return <article className={`paper compact plan-card ${mine ? "is-mine" : "is-team"}`}>
    <div className="paper-fold" aria-hidden="true"/>
    <div className="paper-meta">
      <div className="plan-owner"><span>{mine ? "我的提案" : "成员提案"}</span><b>{owner?.label ?? short(plan.ownerNodeId)}</b></div>
      <Pill tone={mine ? "green" : "plain"}>{mine ? "我的提案" : "只读"}</Pill>
      <Pill>r{plan.revision}</Pill>
      <code>{short(plan.sha256)}</code>
    </div>
    <div className="plan-filename"><FileText size={13}/><b>{plan.filename}</b><span>{Math.ceil(plan.bytes / 1024)} KiB</span></div>
    <div className="plan-impact"><span>受影响模块</span>{plan.impactedModuleIds?.length ? plan.impactedModuleIds.map((id) => <Pill key={id} tone="blue">{data.modules.find((item) => item.id === id)?.name ?? "已移除模块"}</Pill>) : <small>{plan.impactReviewed ? "作者确认暂无已登记模块" : "影响未核实"}</small>}</div>
    {!!plan.impactedModuleIds?.some((id) => data.plans.some((other) => other.id !== plan.id && other.impactedModuleIds?.includes(id))) && <p className="plan-overlap">有其他提案涉及相同模块，待对齐时核对。</p>}
    <Markdown>{plan.content}</Markdown>
    <footer className="plan-actions">
      <span><Eye size={12}/>团队全员可见</span>
      <div className="button-row">
        <button onClick={() => download(plan)}><ArrowDownToLine size={13}/>下载</button>
        {mine && <><button onClick={onEdit}>更新</button><button className="danger" onClick={onWithdraw}>撤回</button></>}
      </div>
    </footer>
  </article>;
}

function CollaborationMap({ data, taskCount, doneCount }: {
  data: V20BootstrapPayload;
  taskCount: number;
  doneCount: number;
}) {
  const visibleNodes = data.nodes.slice(0, SATELLITE_POSITIONS.length);
  const onlineCount = data.nodes.filter((node) => node.connected).length;
  return <div className="network-stage" aria-label={`${onlineCount} 个在线节点`}>
    <div className="network-grid" aria-hidden="true"/>
    <div className="network-sweep" aria-hidden="true"/>
    <svg className="network-lines" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="35"/><circle cx="50" cy="50" r="23"/>
      {visibleNodes.map((node, index) => <line key={node.id} x1="50" y1="50" x2={SATELLITE_POSITIONS[index]!.x} y2={SATELLITE_POSITIONS[index]!.y}/>) }
    </svg>
    <div className="network-core"><span>ROOM</span><strong>R{data.room.requirementRevision}</strong><small>live mesh</small></div>
    {visibleNodes.map((node, index) => <div key={node.id} className={`satellite satellite-${index} ${node.connected ? "online" : ""}`}>
      <i/><span>{node.role === "captain" ? "C" : String(index).padStart(2, "0")}</span><b>{node.label}</b>
    </div>)}
    <div className="telemetry telemetry-online"><span>ONLINE</span><b>{String(onlineCount).padStart(2, "0")}</b></div>
    <div className="telemetry telemetry-pool"><span>AUDIT POOL</span><b>{String(data.auditPool.available).padStart(2, "0")}</b></div>
    <div className="telemetry telemetry-tasks"><span>DELIVERY</span><b>{doneCount}/{taskCount}</b></div>
    <div className="network-caption"><Radio size={12}/><span>节点心跳每 15 秒回传，不上传对话正文</span></div>
  </div>;
}

function AlignmentView({ alignment, data, run }: {
  alignment: AlignmentRun;
  data: V20BootstrapPayload;
  run(work: () => Promise<unknown>, message: string): void;
}) {
  const captain = data.viewer.role === "captain";
  return <div className="alignment-layout">
    <article className="paper alignment-paper">
      <div className="paper-meta"><Pill tone={alignment.status === "READY" ? "green" : alignment.status === "FAILED" ? "red" : "amber"}>{labelStatus(alignment.status)}</Pill><code>{alignment.id}</code><span>{time(alignment.createdAt)}</span></div>
      {alignment.alignmentMarkdown
        ? <Markdown>{alignment.alignmentMarkdown}</Markdown>
        : <div className="processing"><span className="processing-orbit"><Bot size={19}/><i/></span><span>{alignment.error || "正在整理提案与任务草稿…"}</span></div>}
      {!!alignment.issues?.length && <div className="decision-list"><h3>队长裁决 · {alignment.issues.filter((issue) => !issue.selectedOptionId).length} 项待选择</h3>
        {alignment.issues.map((issue) => <section className="decision-card" key={issue.id}>
          <div><code>{issue.id}</code><h4>{issue.title}</h4></div>
          <div className="decision-evidence">{issue.evidence.map((item, index) => <blockquote key={`${item.nodeId}-${index}`}><b>{data.nodes.find((node) => node.id === item.nodeId)?.label ?? short(item.nodeId)}</b> · {item.excerpt}</blockquote>)}</div>
          <div className="decision-options">{issue.options.map((option) => <button key={option.id} className={issue.selectedOptionId === option.id ? "primary" : ""}
            disabled={!captain || alignment.status !== "NEEDS_DECISION"}
            onClick={() => run(() => api.resolveAlignment(alignment.id, issue.id, option.id, alignment.decisionRevision ?? 0), "裁决已记录")}>{option.label}{issue.recommendedOptionId === option.id ? " · 建议" : ""}<small>{option.impact}</small></button>)}</div>
        </section>)}
      </div>}
    </article>
    <aside className="drafts">
      <div className="drafts-heading"><div><span>对齐结果</span><h3>任务草稿</h3></div><b>{String(alignment.tasks.length).padStart(2, "0")}</b></div>
      {alignment.tasks.map((task, index) => <article key={task.id} className="draft-card">
        <div><code>{String(index + 1).padStart(2, "0")} / {short(task.id)}</code><Pill>{task.dependencies.length ? `${task.dependencies.length} 依赖` : "可独立"}</Pill></div>
        <h4>{task.title}</h4><p>{task.goal}</p><small>{task.boundary}</small>{task.assignmentRationale && <small>分工依据：{task.assignmentRationale} · {task.effort ?? "M"}</small>}
        {captain && alignment.status === "READY"
          ? <select value={task.assigneeNodeId} onChange={(event) => run(() => api.assign(alignment.id, task.id, event.target.value), "任务已改派")}>{data.nodes.map((node) => <option value={node.id} key={node.id}>{node.label}</option>)}</select>
          : <b>{data.nodes.find((node) => node.id === task.assigneeNodeId)?.label ?? short(task.assigneeNodeId)}</b>}
      </article>)}
    </aside>
  </div>;
}

function TaskCard({ task, data, run, download }: {
  task: StageTask;
  data: V20BootstrapPayload;
  run(work: () => Promise<unknown>, message: string): void;
  download(task: StageTask): void;
}) {
  const mine = task.assigneeNodeId === data.viewer.id;
  const owner = data.nodes.find((node) => node.id === task.assigneeNodeId);
  const canStart = mine && ["PUBLISHED", "READY", "FAILED"].includes(task.status);
  return <article className={`task-card status-${task.status.toLowerCase()} ${task.status === "PAUSED" ? "paused" : ""}`}>
    <div className="task-progress" aria-hidden="true"><i/></div>
    <div className="task-header"><div><code>{task.id}</code><h3>{task.title}</h3></div><Pill tone={task.status === "DONE" ? "green" : task.status === "FAILED" || task.status === "BLOCKED" ? "red" : task.status === "IN_PROGRESS" ? "blue" : "amber"}>{labelStatus(task.status)}</Pill></div>
    <p className="goal">{task.goal}</p>
    <div className="boundary"><span>工作边界</span>{task.boundary}</div>
    <ul className="acceptance">{task.acceptance.map((item) => <li key={item}><Check size={12}/>{item}</li>)}</ul>
    <div className="task-times"><span>发布 {time(task.publishedAt)}</span>{task.startedAt && <span>开工 {time(task.startedAt)}</span>}{task.finishedAt && <span>执行结束 {time(task.finishedAt)}</span>}{task.doneAt && <span>确认 {time(task.doneAt)}</span>}</div>
    <div className="task-foot"><span>{owner?.label ?? short(task.assigneeNodeId)}</span><span>r{task.revision}</span>{task.lastGit && <code>{short(task.lastGit.headSha)}</code>}</div>
    {(mine || data.viewer.role === "captain") && <div className="button-row">
      <button onClick={() => download(task)}><ArrowDownToLine size={13}/>下载</button>
      {mine && <FileButton label="上传细化 MD" disabled={!(["PUBLISHED", "REFINING", "READY", "FAILED", "PAUSED"].includes(task.status))} onFile={(filename, content) => run(() => api.uploadTask(task.id, filename, content), `${filename} 已上传`)}/>} 
      {canStart && <button className="primary" onClick={() => run(() => api.taskStart(task.id), "开工命令已发送到本机 Codex")}><Play size={13}/>开工</button>}
      {mine && ["STARTING", "IN_PROGRESS", "WAITING_CONFIRMATION"].includes(task.status) && <button onClick={() => run(() => api.taskSync(task.id), "已请求立即同步")}><RefreshCw size={13}/>同步</button>}
      {mine && task.status === "WAITING_CONFIRMATION" && <button className="primary" onClick={() => run(() => api.taskDone(task.id), "任务已确认完成")}><Check size={13}/>确认完成</button>}
    </div>}
  </article>;
}

function SignalStrip({ data, taskCount }: { data: V20BootstrapPayload; taskCount: number }) {
  const items = [
    `ROOM ${short(data.room.id, 12)}`,
    `REQUIREMENT R${data.room.requirementRevision}`,
    `${data.nodes.filter((node) => node.connected).length} NODES ONLINE`,
    `${taskCount} TASKS IN CURRENT STAGE`,
    `${data.pullRequests.filter((item) => item.status === "QUEUED").length} CHANGES QUEUED`
  ];
  return <div className="signal-strip" aria-label="协作状态摘要">
    <div className="signal-track">{[...items, ...items].map((item, index) => <span key={`${item}-${index}`}><i/>{item}</span>)}</div>
  </div>;
}

export function App() {
  const [data, setData] = useState<V20BootstrapPayload | null>(null);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState(() => NAV_ITEMS.some(([id]) => `#${id}` === window.location.hash) ? window.location.hash.slice(1) : "overview");
  const [composerOpen, setComposerOpen] = useState(false);
  const [taskFilter, setTaskFilter] = useState<"all" | "mine" | "progress" | "confirm" | "done">("all");

  const refresh = useCallback(async (quiet = false) => {
    try {
      setData(await api.bootstrap());
      setUnauthorized(null);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setData(null);
        setUnauthorized(error.message);
      } else if (!quiet) setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      if (!quiet) setBooting(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 8_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const syncHash = () => setActiveSection(NAV_ITEMS.some(([id]) => `#${id}` === window.location.hash) ? window.location.hash.slice(1) : "overview");
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [activeSection]);

  const run = useCallback((work: () => Promise<unknown>, message: string) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    void work()
      .then(() => { setNotice(message); return refresh(true); })
      .catch((error) => setNotice(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(false));
  }, [busy, refresh]);

  const downloadTask = useCallback((task: StageTask) => {
    run(async () => {
      const value = await api.taskDetail(task.id);
      const blob = new Blob([value.markdown], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "task.md";
      anchor.click();
      URL.revokeObjectURL(url);
    }, "task.md 已下载");
  }, [run]);

  const downloadPlan = useCallback((plan: MarkdownDocument) => {
    const blob = new Blob([plan.content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = plan.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  if (booting) return <BootScreen/>;
  if (!data) return <Welcome error={unauthorized}/>;

  const latestAlignment = [...data.alignments].reverse().find((item) => item.status !== "PUBLISHED") ?? [...data.alignments].reverse()[0];
  const currentStage = [...data.stages].reverse().find((item) => item.status !== "COMPLETED") ?? [...data.stages].reverse()[0];
  const tasks = currentStage ? data.tasks.filter((task) => task.stageId === currentStage.id) : [];
  const latestReview = [...data.reviews].reverse()[0];
  const queuedChanges = data.pullRequests.filter((item) => item.status === "QUEUED");
  const captain = data.viewer.role === "captain";
  const myPlan = data.plans.find((plan) => plan.ownerNodeId === data.viewer.id);
  const doneCount = tasks.filter((task) => task.status === "DONE").length;
  const filteredTasks = tasks.filter((task) => taskFilter === "all" ||
    (taskFilter === "mine" && task.assigneeNodeId === data.viewer.id) ||
    (taskFilter === "progress" && ["STARTING", "IN_PROGRESS"].includes(task.status)) ||
    (taskFilter === "confirm" && task.status === "WAITING_CONFIRMATION") ||
    (taskFilter === "done" && task.status === "DONE"));
  const activeIndex = Math.max(0, NAV_ITEMS.findIndex(([id]) => id === activeSection));
  const railStyle = { "--active-step": activeIndex } as CSSProperties;

  return <Fragment>
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <div className="ambient-grid" aria-hidden="true"/>
    <div className="ambient-orb ambient-orb-one" aria-hidden="true"/>
    <div className="ambient-orb ambient-orb-two" aria-hidden="true"/>

    <header className="topbar">
      <div className="topbar-shell">
        <a className="brand" href="#overview"><span className="brand-logo"><img src="/vibe-git-logo.png" alt=""/></span><div><b>vibe-git</b><small>项目协作房间</small></div></a>
        <nav aria-label="工作流导航">{NAV_ITEMS.map(([href, label, number]) => <a href={`#${href}`} className={activeSection === href ? "active" : ""} aria-current={activeSection === href ? "location" : undefined} key={href}><i>{number}</i><span>{label}</span></a>)}</nav>
        <div className="viewer"><span className="viewer-signal"><i className={data.viewer.connected ? "online" : ""}/><em/></span><div><b>{data.viewer.label}</b><small>{captain ? "队长" : "成员"}</small></div></div>
      </div>
    </header>

    <main id="main-content" className="shell" onPointerMove={(event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      event.currentTarget.style.setProperty("--pointer-x", `${event.clientX - rect.left}px`);
      event.currentTarget.style.setProperty("--pointer-y", `${event.clientY - rect.top}px`);
    }}>
      <div className="flow-layout">
        <aside className="flow-rail" style={railStyle} aria-label="协作流程">
          <div className="rail-title"><Workflow size={14}/><span>工作区</span></div>
          <div className="rail-track"><i/></div>
          <ol>{NAV_ITEMS.map(([id, label, number]) => <li className={activeSection === id ? "active" : ""} key={id}><a href={`#${id}`}><b>{number}</b><span>{label}</span></a></li>)}</ol>
          <div className="rail-foot"><ScanLine size={13}/><span>自动同步</span></div>
        </aside>

        <div className="workflow-canvas">
          <section className="overview" id="overview" hidden={activeSection !== "overview"}>
            <div className="page-intro"><span>房间 / 总览</span><h1>项目总览</h1><p>查看当前阶段、已确认的进度和接下来需要处理的事项。</p></div>
            <div className="metrics"><article><span>需求版本</span><b>R{data.room.requirementRevision}</b></article><article><span>当前阶段</span><b>{currentStage ? `阶段 ${currentStage.sequence}` : "尚未发布"}</b></article><article><span>已确认工作项</span><b>{doneCount} / {tasks.length}</b></article><article><span>在线成员</span><b>{data.nodes.filter((node) => node.connected).length} / {data.nodes.length}</b></article></div>
            <ProjectTimeline data={data}/>
            {captain && <ModuleManager key={data.moduleRevision} data={data} onSaved={() => refresh(true)}/>}
            <div className="overview-next"><h3>需要处理</h3><div>{latestAlignment?.status === "NEEDS_DECISION" && <a href="#alignment">对齐稿有待裁决问题 →</a>}{tasks.some((task) => task.status === "WAITING_CONFIRMATION" && task.assigneeNodeId === data.viewer.id) && <a href="#tasks">有工作项等待本人确认 →</a>}{latestReview?.status === "NEEDS_EVIDENCE" && <a href="#changes">影响审核仍需补证 →</a>}{latestReview?.status === "AWAITING_CAPTAIN" && captain && <a href="#changes">影响审核待队长处理 →</a>}{queuedChanges.length > 0 && captain && <a href="#changes">{queuedChanges.length} 项变更待审核 →</a>}{!data.plans.length && <a href="#plans">尚无项目提案 →</a>}</div></div>
          </section>
          <Section id="nodes" active={activeSection === "nodes"} eyebrow="06 · 成员" title="成员与连接" aside={captain && <><button onClick={() => run(async () => { const invite = await api.invite(); await navigator.clipboard.writeText(invite.command); }, "加入命令已复制")}><Copy size={13}/>复制加入命令</button><button onClick={() => run(() => api.rotateInvite(), "邀请密钥已轮换")}><RotateCw size={13}/>轮换邀请</button></>}>
            <div className="node-field"><div className="node-axis" aria-hidden="true"><span>CAPTAIN</span><i/><span>MEMBERS</span></div><div className="node-list">{data.nodes.map((node) => <NodeCard key={node.id} node={node} viewer={data.viewer} onRevoke={(id) => run(() => api.revokeNode(id), "节点已撤销")}/>)}</div></div>
            {captain && data.tunnel && <div className="tunnel"><span className="tunnel-icon"><Cloud size={16}/><i/></span><div><small>公开连接</small><b>Cloudflare Quick Tunnel</b><span>{data.tunnel.url || data.tunnel.phase}</span></div><Pill tone={data.tunnel.running ? "green" : "amber"}>{data.tunnel.running ? "运行中" : data.tunnel.phase}</Pill><div className="button-row">{!data.tunnel.installed && <button onClick={() => run(() => api.tunnelInstall(), "cloudflared 已安装")}>安装</button>}{!data.tunnel.running ? <button onClick={() => run(() => api.tunnelStart(), "Tunnel 已启动")}>启动</button> : <button onClick={() => run(() => api.tunnelStop(), "Tunnel 已停止")}>停止</button>}</div></div>}
          </Section>

          <Section id="plans" active={activeSection === "plans"} eyebrow="02 · 提案" title="项目提案" aside={<div className="plan-toolbar"><span><Eye size={12}/>{data.plans.length} 位成员已提交</span><button className="primary" onClick={() => setComposerOpen(true)}>{myPlan ? "更新我的提案" : "提交我的提案"}</button></div>}>
            {data.plans.length
              ? <div className="plan-grid">{data.plans.map((plan) => <PlanCard key={plan.id} plan={plan} data={data} download={downloadPlan} onEdit={() => setComposerOpen(true)} onWithdraw={() => { if (window.confirm("撤回后不再参与下一轮对齐。已冻结的对齐版本仍保留。确定撤回？")) run(() => api.withdrawPlan(plan.id, plan.revision), "提案已撤回"); }}/>)}</div>
              : <Empty>每位成员都可提交一份任意名称的 .md 提案。提交后全员可见，并且只有提案所有者可以继续更新。</Empty>}
            {captain && <div className="section-bottom"><span>开始时冻结每个节点的最新版本，后续上传自动进入下一轮。</span><button className="primary" disabled={!data.plans.length || busy} onClick={() => run(() => api.startAlignment(), "需求对齐已进入审核池")}><Bot size={14}/>开始对齐<ChevronRight size={13}/></button></div>}
          </Section>

          <Section id="alignment" active={activeSection === "alignment"} eyebrow="04 · 对齐" title="对齐与裁决" aside={latestAlignment && captain && latestAlignment.status === "READY" && <button className="primary" onClick={() => run(() => api.publish(latestAlignment.id), "任务阶段已发布")}><ChevronRight size={14}/>发布任务</button>}>
            {latestAlignment ? <AlignmentView alignment={latestAlignment} data={data} run={run}/> : <Empty>队长开始对齐后，专用 Codex 节点会在这里生成统一需求、任务稿和结构化分配。</Empty>}
          </Section>

          <Section id="tasks" active={activeSection === "tasks"} eyebrow="03 · 交付" title="工作项" aside={currentStage && <div className="stage-label"><Pill tone={currentStage.status === "ACTIVE" ? "green" : currentStage.status === "COMPLETED" ? "plain" : "amber"}>{labelStatus(currentStage.status)}</Pill><b>阶段 {currentStage.sequence}</b><span>需求 R{currentStage.requirementRevision}</span></div>}>
            {tasks.length ? <><div className="work-filters">{([ ["all", `全部 ${tasks.length}`], ["mine", `我的工作 ${tasks.filter((task) => task.assigneeNodeId === data.viewer.id).length}`], ["progress", `进行中 ${tasks.filter((task) => ["STARTING", "IN_PROGRESS"].includes(task.status)).length}`], ["confirm", `待确认 ${tasks.filter((task) => task.status === "WAITING_CONFIRMATION").length}`], ["done", `已完成 ${doneCount}`] ] as const).map(([key, title]) => <button key={key} className={taskFilter === key ? "selected" : ""} onClick={() => setTaskFilter(key)}>{title}</button>)}</div>{filteredTasks.length ? <div className="task-grid">{filteredTasks.map((task) => <TaskCard key={task.id} task={task} data={data} run={run} download={downloadTask}/>)}</div> : <Empty>当前筛选下没有工作项。</Empty>}</> : <Empty>尚未发布正式任务。对齐结果必须由队长确认后发布。</Empty>}
          </Section>

          <Section id="changes" active={activeSection === "changes"} eyebrow="05 · 变更" title="变更审核" aside={<FileButton label="上传变更 MD" disabled={!currentStage || currentStage.status === "COMPLETED"} onFile={(filename, content) => run(() => api.uploadChange(filename, content), `${filename} 已作为需求变更提交`)}/>}>
            <div className="change-layout">
              <div className="change-list">{data.pullRequests.length ? [...data.pullRequests].reverse().map((change, index) => <button className="change-row" key={change.id} onClick={() => run(async () => { const doc = await api.document(change.documentId); const blob = new Blob([doc.content], { type: "text/markdown;charset=utf-8" }); const url = URL.createObjectURL(blob); window.open(url, "_blank", "noopener"); setTimeout(() => URL.revokeObjectURL(url), 30_000); }, "已打开变更文档")}><i>{String(index + 1).padStart(2, "0")}</i><span><code>{change.id}</code><b>{data.nodes.find((node) => node.id === change.submitterNodeId)?.label}</b></span><Pill tone={change.status === "APPLIED" ? "green" : change.status === "REJECTED" ? "red" : "amber"}>{labelStatus(change.status)}</Pill><small>{time(change.createdAt)}</small></button>) : <Empty>开发期间可以持续提交需求变更，普通成员不能开启审核。</Empty>}</div>
              <article className="review-card"><div className="review-scan" aria-hidden="true"/><div className="review-title"><span className="agent-mark"><Bot size={18}/><i/></span><div><span>审核节点</span><h3>影响审核</h3></div>{latestReview && <Pill tone={latestReview.status === "AWAITING_CAPTAIN" ? "amber" : latestReview.status === "APPLIED" ? "green" : "plain"}>{labelStatus(latestReview.status)}</Pill>}</div>{latestReview?.summaryMarkdown ? <Markdown>{latestReview.summaryMarkdown}</Markdown> : <p>{latestReview?.status === "NEEDS_EVIDENCE" ? "正在分布式取证；离线节点重连后自动补查。" : "变更按阶段合并分析。开发结束后自动审核；队长也可提前强制审核，只暂停受影响任务。"}</p>}{latestReview?.status === "NEEDS_EVIDENCE" && <div className="affected"><span>待补证节点</span>{(latestReview.pendingNodeIds ?? []).map((id) => <Pill key={id}>{data.nodes.find((node) => node.id === id)?.label ?? short(id)}{latestReview.probes?.[id]?.uncertainTaskIds.length ? ` · ${latestReview.probes[id]!.uncertainTaskIds.length} 项待确认` : ""}</Pill>)}{latestReview.error && <small>{latestReview.error}</small>}{(latestReview.pendingNodeIds ?? []).flatMap((id) => (latestReview.probes?.[id]?.findings ?? []).filter((finding) => latestReview.probes?.[id]?.uncertainTaskIds.includes(finding.taskId)).map((finding) => <small key={`${id}-${finding.taskId}`}>{short(finding.taskId)}：{finding.reason}</small>))}</div>}{latestReview?.affectedNodeIds.length ? <div className="affected"><span>受影响节点</span>{latestReview.affectedNodeIds.map((id) => <Pill key={id}>{data.nodes.find((node) => node.id === id)?.label ?? short(id)}</Pill>)}</div> : null}<div className="button-row">{captain && queuedChanges.length > 0 && currentStage?.status === "ACTIVE" && <button onClick={() => run(() => api.forceReview(), "已强制开始影响审核")}><Pause size={13}/>立即审核</button>}{captain && latestReview && ["NEEDS_EVIDENCE", "QUEUED", "RUNNING"].includes(latestReview.status) && <button className="danger" onClick={() => run(() => api.cancelReview(latestReview.id), "审核已取消，变更返回待审队列")}><X size={13}/>取消审核</button>}{captain && latestReview?.status === "AWAITING_CAPTAIN" && <><button className="primary" onClick={() => run(() => api.applyReview(latestReview.id), "审核结果已应用")}><Check size={13}/>应用</button><button className="danger" onClick={() => run(() => api.rejectReview(latestReview.id), "审核结果已退回")}><X size={13}/>退回</button></>}</div></article>
            </div>
          </Section>

          <Section id="messages" active={activeSection === "messages"} eyebrow="07 · 消息" title="消息" aside={<button onClick={() => void refresh()}><RefreshCw size={13}/>刷新</button>}>
            {data.notifications.length ? <div className="messages">{data.notifications.map((item, index) => <article key={item.id}><span className="message-index">{String(index + 1).padStart(2, "0")}</span><span className={`message-icon ${item.type.toLowerCase()}`}>{item.type === "TASK" ? <GitBranch size={14}/> : item.type === "REVIEW" ? <Bot size={14}/> : <Activity size={14}/>}</span><div><div><b>{item.title}</b><Pill>{item.type}</Pill></div><p>{item.body}</p></div><time>{time(item.createdAt)}</time></article>)}</div> : <Empty>暂无消息。通知持久保存，离线节点重连后也能看到。</Empty>}
          </Section>
        </div>
      </div>

      <footer className="footer"><span><BrandGlyph/>VIBE—GIT</span><p>Local credentials · distributed audit · explicit delivery</p><code>CONTROL SURFACE / 0.20</code></footer>
    </main>

    {notice && <button className={`toast ${busy ? "is-busy" : ""}`} aria-live="polite" onClick={() => setNotice(null)}>{busy ? <span className="spinner"/> : <Check size={14}/>}<span>{notice}</span><X size={13}/></button>}
    {composerOpen && <ProposalComposer data={data} current={myPlan} onClose={() => setComposerOpen(false)} onSaved={() => refresh(true)}/>}
  </Fragment>;
}
