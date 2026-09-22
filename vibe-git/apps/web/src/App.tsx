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

const NAV_ITEMS = [
  ["nodes", "节点", "01"],
  ["plans", "Plans", "02"],
  ["alignment", "对齐稿", "03"],
  ["tasks", "任务", "04"],
  ["changes", "变更", "05"],
  ["messages", "消息", "06"]
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

function Section({ id, eyebrow, title, aside, children }: {
  id: string;
  eyebrow: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const [number = "", label = eyebrow] = eyebrow.split(" · ");
  return <section id={id} className={`section section-${id}`} data-reveal>
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
    <div><b>等待输入</b><p>{children}</p></div>
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
      <h1>面板在等你的<br/><em>CLI 身份。</em></h1>
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
      <div><span>{node.role === "captain" ? "CONTROL NODE" : "MEMBER NODE"}</span><b>{node.label}</b><code>{short(node.id, 18)}</code></div>
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

function PlanCard({ plan, data, run, download }: {
  plan: MarkdownDocument;
  data: V20BootstrapPayload;
  run(work: () => Promise<unknown>, message: string): void;
  download(plan: MarkdownDocument): void;
}) {
  const mine = plan.ownerNodeId === data.viewer.id;
  const owner = data.nodes.find((node) => node.id === plan.ownerNodeId);
  return <article className={`paper compact plan-card ${mine ? "is-mine" : "is-team"}`}>
    <div className="paper-fold" aria-hidden="true"/>
    <div className="paper-meta">
      <div className="plan-owner"><span>{mine ? "MY PROPOSAL" : "TEAM PROPOSAL"}</span><b>{owner?.label ?? short(plan.ownerNodeId)}</b></div>
      <Pill tone={mine ? "green" : "plain"}>{mine ? "我的提案" : "只读"}</Pill>
      <Pill>r{plan.revision}</Pill>
      <code>{short(plan.sha256)}</code>
    </div>
    <div className="plan-filename"><FileText size={13}/><b>{plan.filename}</b><span>{Math.ceil(plan.bytes / 1024)} KiB</span></div>
    <Markdown>{plan.content}</Markdown>
    <footer className="plan-actions">
      <span><Eye size={12}/>团队全员可见</span>
      <div className="button-row">
        <button onClick={() => download(plan)}><ArrowDownToLine size={13}/>下载</button>
        {mine && <FileButton label="更新我的提案" onFile={(filename, content) => run(() => api.updatePlan(plan.id, plan.revision, filename, content), `${filename} 已更新为 r${plan.revision + 1}`)}/>}
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
      <div className="paper-meta"><Pill tone={alignment.status === "READY" ? "green" : alignment.status === "FAILED" ? "red" : "amber"}>{alignment.status}</Pill><code>{alignment.id}</code><span>{time(alignment.createdAt)}</span></div>
      {alignment.alignmentMarkdown
        ? <Markdown>{alignment.alignmentMarkdown}</Markdown>
        : <div className="processing"><span className="processing-orbit"><Bot size={19}/><i/></span><span>{alignment.error || "专用 Codex 正在对齐需求与验收边界…"}</span></div>}
    </article>
    <aside className="drafts">
      <div className="drafts-heading"><div><span>STRUCTURED OUTPUT</span><h3>任务草稿</h3></div><b>{String(alignment.tasks.length).padStart(2, "0")}</b></div>
      {alignment.tasks.map((task, index) => <article key={task.id} className="draft-card">
        <div><code>{String(index + 1).padStart(2, "0")} / {short(task.id)}</code><Pill>{task.dependencies.length ? `${task.dependencies.length} 依赖` : "可独立"}</Pill></div>
        <h4>{task.title}</h4><p>{task.goal}</p><small>{task.boundary}</small>
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
    <div className="task-header"><div><code>{task.id}</code><h3>{task.title}</h3></div><Pill tone={task.status === "DONE" ? "green" : task.status === "FAILED" || task.status === "BLOCKED" ? "red" : task.status === "IN_PROGRESS" ? "blue" : "amber"}>{task.status}</Pill></div>
    <p className="goal">{task.goal}</p>
    <div className="boundary"><span>BOUNDARY</span>{task.boundary}</div>
    <ul className="acceptance">{task.acceptance.map((item) => <li key={item}><Check size={12}/>{item}</li>)}</ul>
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
  const [activeSection, setActiveSection] = useState("nodes");

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
    if (!data?.viewer.id) return;
    const revealElements = document.querySelectorAll<HTMLElement>("[data-reveal]");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -8%" });
    revealElements.forEach((element) => reduceMotion ? element.classList.add("is-visible") : revealObserver.observe(element));

    const sectionObserver = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible?.target.id) setActiveSection(visible.target.id);
    }, { threshold: [0.12, 0.35, 0.6], rootMargin: "-18% 0px -58%" });
    NAV_ITEMS.forEach(([id]) => {
      const section = document.getElementById(id);
      if (section) sectionObserver.observe(section);
    });
    return () => { revealObserver.disconnect(); sectionObserver.disconnect(); };
  }, [data?.viewer.id]);

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
  const activeIndex = Math.max(0, NAV_ITEMS.findIndex(([id]) => id === activeSection));
  const railStyle = { "--active-step": activeIndex } as CSSProperties;

  return <Fragment>
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <div className="ambient-grid" aria-hidden="true"/>
    <div className="ambient-orb ambient-orb-one" aria-hidden="true"/>
    <div className="ambient-orb ambient-orb-two" aria-hidden="true"/>

    <header className="topbar">
      <div className="topbar-shell">
        <a className="brand" href="#nodes"><span><BrandGlyph/></span><div><b>VIBE—GIT</b><small>CONTROL SURFACE / 0.20</small></div></a>
        <nav aria-label="工作流导航">{NAV_ITEMS.map(([href, label, number]) => <a href={`#${href}`} className={activeSection === href ? "active" : ""} aria-current={activeSection === href ? "location" : undefined} key={href}><i>{number}</i><span>{label}</span></a>)}</nav>
        <div className="viewer"><span className="viewer-signal"><i className={data.viewer.connected ? "online" : ""}/><em/></span><div><b>{data.viewer.label}</b><small>{captain ? "Captain / control" : "Member / connected"}</small></div></div>
      </div>
    </header>

    <main id="main-content" className="shell" onPointerMove={(event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      event.currentTarget.style.setProperty("--pointer-x", `${event.clientX - rect.left}px`);
      event.currentTarget.style.setProperty("--pointer-y", `${event.clientY - rect.top}px`);
    }}>
      <section className="overview" data-reveal>
        <div className="overview-copy">
          <div className="hero-coordinate"><span>CLI-FIRST COLLABORATION</span><code>{short(data.room.id, 13)}</code></div>
          <h1>协作不是列表，<br/>是一张<em>正在生长</em>的图。</h1>
          <p>计划留在 Markdown，身份留在本机，网页只把节点、任务与审核路径组织成一张实时控制面。</p>
          <div className="hero-meta"><span><i className="live-dot"/>HOST LIVE</span><span>ROLE / <b>{captain ? "CAPTAIN" : "MEMBER"}</b></span><span>SYNC / <b>08 SEC</b></span></div>
        </div>
        <CollaborationMap data={data} taskCount={tasks.length} doneCount={doneCount}/>
        <div className="hero-watermark" aria-hidden="true">VG<br/><span>20</span></div>
      </section>

      <SignalStrip data={data} taskCount={tasks.length}/>

      <div className="flow-layout">
        <aside className="flow-rail" style={railStyle} aria-label="协作流程">
          <div className="rail-title"><Workflow size={14}/><span>FLOW MAP</span></div>
          <div className="rail-track"><i/></div>
          <ol>{NAV_ITEMS.map(([id, label, number]) => <li className={activeSection === id ? "active" : ""} key={id}><a href={`#${id}`}><b>{number}</b><span>{label}</span></a></li>)}</ol>
          <div className="rail-foot"><ScanLine size={13}/><span>AUTO SYNC</span></div>
        </aside>

        <div className="workflow-canvas">
          <Section id="nodes" eyebrow="01 · CONNECTIONS" title="节点星图" aside={captain && <><button onClick={() => run(async () => { const invite = await api.invite(); await navigator.clipboard.writeText(invite.command); }, "加入命令已复制")}><Copy size={13}/>复制加入命令</button><button onClick={() => run(() => api.rotateInvite(), "邀请密钥已轮换")}><RotateCw size={13}/>轮换邀请</button></>}>
            <div className="node-field"><div className="node-axis" aria-hidden="true"><span>CAPTAIN</span><i/><span>MEMBERS</span></div><div className="node-list">{data.nodes.map((node) => <NodeCard key={node.id} node={node} viewer={data.viewer} onRevoke={(id) => run(() => api.revokeNode(id), "节点已撤销")}/>)}</div></div>
            {captain && data.tunnel && <div className="tunnel"><span className="tunnel-icon"><Cloud size={16}/><i/></span><div><small>PUBLIC EDGE</small><b>Cloudflare Quick Tunnel</b><span>{data.tunnel.url || data.tunnel.phase}</span></div><Pill tone={data.tunnel.running ? "green" : "amber"}>{data.tunnel.running ? "运行中" : data.tunnel.phase}</Pill><div className="button-row">{!data.tunnel.installed && <button onClick={() => run(() => api.tunnelInstall(), "cloudflared 已安装")}>安装</button>}{!data.tunnel.running ? <button onClick={() => run(() => api.tunnelStart(), "Tunnel 已启动")}>启动</button> : <button onClick={() => run(() => api.tunnelStop(), "Tunnel 已停止")}>停止</button>}</div></div>}
          </Section>

          <Section id="plans" eyebrow="02 · INPUT" title="团队提案桌面" aside={<div className="plan-toolbar"><span><Eye size={12}/>{data.plans.length} 份提案 · 全员可见</span><FileButton label={myPlan ? "更新我的提案" : "提交我的提案"} onFile={(filename, content) => run(() => myPlan ? api.updatePlan(myPlan.id, myPlan.revision, filename, content) : api.uploadPlan(filename, content), myPlan ? `${filename} 已更新为 r${myPlan.revision + 1}` : `${filename} 已作为提案提交`)}/></div>}>
            {data.plans.length
              ? <div className="plan-grid">{data.plans.map((plan) => <PlanCard key={plan.id} plan={plan} data={data} run={run} download={downloadPlan}/>)}</div>
              : <Empty>每位成员都可提交一份任意名称的 .md 提案。提交后全员可见，并且只有提案所有者可以继续更新。</Empty>}
            {captain && <div className="section-bottom"><span>开始时冻结每个节点的最新版本，后续上传自动进入下一轮。</span><button className="primary" disabled={!data.plans.length || busy} onClick={() => run(() => api.startAlignment(), "需求对齐已进入审核池")}><Bot size={14}/>开始对齐<ChevronRight size={13}/></button></div>}
          </Section>

          <Section id="alignment" eyebrow="03 · ALIGNMENT" title="对齐工作台" aside={latestAlignment && captain && latestAlignment.status === "READY" && <button className="primary" onClick={() => run(() => api.publish(latestAlignment.id), "任务阶段已发布")}><ChevronRight size={14}/>发布任务</button>}>
            {latestAlignment ? <AlignmentView alignment={latestAlignment} data={data} run={run}/> : <Empty>队长开始对齐后，专用 Codex 节点会在这里生成统一需求、任务稿和结构化分配。</Empty>}
          </Section>

          <Section id="tasks" eyebrow="04 · DELIVERY" title="任务航线" aside={currentStage && <div className="stage-label"><Pill tone={currentStage.status === "ACTIVE" ? "green" : currentStage.status === "COMPLETED" ? "plain" : "amber"}>{currentStage.status}</Pill><b>阶段 {currentStage.sequence}</b><span>需求 R{currentStage.requirementRevision}</span></div>}>
            {tasks.length ? <div className="task-grid">{tasks.map((task) => <TaskCard key={task.id} task={task} data={data} run={run} download={downloadTask}/>)}</div> : <Empty>尚未发布正式任务。对齐结果必须由队长确认后发布。</Empty>}
          </Section>

          <Section id="changes" eyebrow="05 · CHANGE CONTROL" title="变更雷达" aside={<FileButton label="上传变更 MD" disabled={!currentStage || currentStage.status === "COMPLETED"} onFile={(filename, content) => run(() => api.uploadChange(filename, content), `${filename} 已作为需求变更提交`)}/>}>
            <div className="change-layout">
              <div className="change-list">{data.pullRequests.length ? [...data.pullRequests].reverse().map((change, index) => <button className="change-row" key={change.id} onClick={() => run(async () => { const doc = await api.document(change.documentId); const blob = new Blob([doc.content], { type: "text/markdown;charset=utf-8" }); const url = URL.createObjectURL(blob); window.open(url, "_blank", "noopener"); setTimeout(() => URL.revokeObjectURL(url), 30_000); }, "已打开变更文档")}><i>{String(index + 1).padStart(2, "0")}</i><span><code>{change.id}</code><b>{data.nodes.find((node) => node.id === change.submitterNodeId)?.label}</b></span><Pill tone={change.status === "APPLIED" ? "green" : change.status === "REJECTED" ? "red" : "amber"}>{change.status}</Pill><small>{time(change.createdAt)}</small></button>) : <Empty>开发期间可以持续提交需求变更，普通成员不能开启审核。</Empty>}</div>
              <article className="review-card"><div className="review-scan" aria-hidden="true"/><div className="review-title"><span className="agent-mark"><Bot size={18}/><i/></span><div><span>MASTER AGENT</span><h3>影响审核</h3></div>{latestReview && <Pill tone={latestReview.status === "AWAITING_CAPTAIN" ? "amber" : latestReview.status === "APPLIED" ? "green" : "plain"}>{latestReview.status}</Pill>}</div>{latestReview?.summaryMarkdown ? <Markdown>{latestReview.summaryMarkdown}</Markdown> : <p>变更按阶段合并分析。开发结束后自动审核；队长也可提前强制审核，只暂停受影响任务。</p>}{latestReview?.affectedNodeIds.length ? <div className="affected"><span>受影响节点</span>{latestReview.affectedNodeIds.map((id) => <Pill key={id}>{data.nodes.find((node) => node.id === id)?.label ?? short(id)}</Pill>)}</div> : null}<div className="button-row">{captain && queuedChanges.length > 0 && currentStage?.status === "ACTIVE" && <button onClick={() => run(() => api.forceReview(), "已强制开始影响审核")}><Pause size={13}/>立即审核</button>}{captain && latestReview?.status === "AWAITING_CAPTAIN" && <><button className="primary" onClick={() => run(() => api.applyReview(latestReview.id), "审核结果已应用")}><Check size={13}/>应用</button><button className="danger" onClick={() => run(() => api.rejectReview(latestReview.id), "审核结果已退回")}><X size={13}/>退回</button></>}</div></article>
            </div>
          </Section>

          <Section id="messages" eyebrow="06 · INBOX" title="信号收件箱" aside={<button onClick={() => void refresh()}><RefreshCw size={13}/>刷新</button>}>
            {data.notifications.length ? <div className="messages">{data.notifications.map((item, index) => <article key={item.id}><span className="message-index">{String(index + 1).padStart(2, "0")}</span><span className={`message-icon ${item.type.toLowerCase()}`}>{item.type === "TASK" ? <GitBranch size={14}/> : item.type === "REVIEW" ? <Bot size={14}/> : <Activity size={14}/>}</span><div><div><b>{item.title}</b><Pill>{item.type}</Pill></div><p>{item.body}</p></div><time>{time(item.createdAt)}</time></article>)}</div> : <Empty>暂无消息。通知持久保存，离线节点重连后也能看到。</Empty>}
          </Section>
        </div>
      </div>

      <footer className="footer"><span><BrandGlyph/>VIBE—GIT</span><p>Local credentials · distributed audit · explicit delivery</p><code>CONTROL SURFACE / 0.20</code></footer>
    </main>

    {notice && <button className={`toast ${busy ? "is-busy" : ""}`} aria-live="polite" onClick={() => setNotice(null)}>{busy ? <span className="spinner"/> : <Check size={14}/>}<span>{notice}</span><X size={13}/></button>}
  </Fragment>;
}
