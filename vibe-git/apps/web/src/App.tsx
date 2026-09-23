import {
  Fragment,
  useCallback,
  useEffect,
  useState,
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
  LayoutGrid,
  ListTodo,
  Pause,
  Play,
  Radio,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  Upload,
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
import { Markdown } from "./Markdown";
import { PlanHistory } from "./PlanHistory";
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
  MOCK_PREPARING: "Mock 准备中", WAITING_INTEGRATION: "待真实集成",
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

function Section({ id, eyebrow, title, aside, children, active }: {
  id: string;
  eyebrow: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  active?: boolean;
}) {
  const descriptions: Record<string, string> = {
    plans: "按成员查看已提交的版本。成员可上传、更新或撤回自己的提案。",
    tasks: "查看模块、任务包和负责人。需要确认的结果单独标记。",
    alignment: "对齐提案、核对分工，需裁决的问题由队长处理。",
    changes: "查看需求变更及其影响审核进度。",
    nodes: "查看房间成员、连接状态和邀请方式。",
    messages: "查看房间保存的通知与任务消息。"
  };
  return <section id={id} className={`section section-${id}`} hidden={!active}>
    <header className="section-title page-titlebar">
      <div className="section-heading">
        <div className="eyebrow">房间 / {eyebrow}</div>
        <h1>{title}</h1><p className="lead">{descriptions[id]}</p>
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
  const [expanded, setExpanded] = useState(false);
  const mine = plan.ownerNodeId === data.viewer.id;
  const owner = data.nodes.find((node) => node.id === plan.ownerNodeId);
  const author = owner?.label ?? short(plan.ownerNodeId);
  const excerpt = plan.content.replace(/[#*>`_\[\]]/g, "").replace(/\s+/g, " ").trim();
  const assessment = [...data.alignments].reverse().find((alignment) => alignment.source === "plans" && alignment.moduleRevisionSnapshot === data.moduleRevision && alignment.planSnapshot.some((item) => item.documentId === plan.id) && alignment.planImpacts?.some((item) => item.documentId === plan.id));
  const finding = assessment?.planImpacts?.find((item) => item.documentId === plan.id);
  const overlap = finding?.moduleIds.some((id) => assessment?.planImpacts?.some((item) => item.documentId !== plan.id &&
    data.plans.some((other) => other.id === item.documentId) && item.moduleIds.includes(id)));
  return <article className="proposal-card">
    <div className="proposal-top"><span className="avatar">{author.slice(0, 1)}</span><div><strong>{author}</strong><small>最新版本 v{plan.revision} · {time(plan.createdAt)}</small></div><span className="status green">已提交</span></div>
    <h3>{plan.filename.replace(/\.md$/i, "")}</h3><p>{excerpt.slice(0, 105)}{excerpt.length > 105 ? "…" : ""}</p>
    <div className="plan-impact"><span>受影响模块</span>{finding ? finding.moduleIds.length ? finding.moduleIds.map((id) => <Pill key={id} tone="blue">{data.modules.find((item) => item.id === id)?.name ?? "已移除模块"}</Pill>) : <small>审核认为不涉及已登记模块</small> : <small>待队长端 Agent 分析</small>}</div>
    {finding && <p className="plan-impact-rationale">审核依据：{finding.rationale}</p>}
    {overlap && <p className="plan-overlap">有其他提案涉及相同模块，待对齐时核对。</p>}
    <div className="proposal-foot"><span>版本 {plan.revision} · {Math.ceil(plan.bytes / 1024)} KiB</span><button className="detail-button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "收起正文" : "查看正文 →"}</button></div>
    {expanded && <div className="proposal-full"><code>SHA-256 {plan.sha256}</code><Markdown>{plan.content}</Markdown><div className="button-row"><button onClick={() => download(plan)}><ArrowDownToLine size={13}/>下载</button>{mine && <><button onClick={onEdit}>更新</button><button className="danger" onClick={onWithdraw}>撤回</button></>}</div></div>}
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
        {captain && alignment.status === "READY" && !alignment.workstreams?.length
          ? <select value={task.assigneeNodeId} onChange={(event) => run(() => api.assign(alignment.id, task.id, event.target.value), "任务已改派")}>{data.nodes.map((node) => <option value={node.id} key={node.id}>{node.label}</option>)}</select>
          : <b>{data.nodes.find((node) => node.id === task.assigneeNodeId)?.label ?? short(task.assigneeNodeId)}</b>}
      </article>)}
    </aside>
    {!!alignment.workstreams?.length && <section className="alignment-contracts"><div className="section-head"><div><h2>工作主线与接口契约</h2><p>每位负责人一条主线。接口双方确认同一版本后，由队长冻结发布。</p></div></div>
      <div className="workstream-list">{alignment.workstreams.map((stream) => <article key={stream.id}><div><strong>{data.nodes.find((node) => node.id === stream.assigneeNodeId)?.label ?? short(stream.assigneeNodeId)}</strong><span>{stream.taskIds.length} 个切片</span></div><p>{stream.summary}</p>{stream.markdown ? <details><summary>查看细化</summary><Markdown>{stream.markdown}</Markdown></details> : <small>正在细化执行契约</small>}</article>)}</div>
      {!!alignment.contracts?.length && <div className="contract-list">{alignment.contracts.map((contract) => <article key={contract.id}><div className="contract-title"><strong>{contract.id} · v{contract.revision}</strong><Pill tone={contract.publishedAt ? "green" : "amber"}>{contract.publishedAt ? "已冻结" : "待确认"}</Pill></div><p>{contract.signature}</p><small>{contract.behavior}</small><small>测试：{contract.testCommand} · 交接：{contract.handoffArtifact}</small><code title={contract.hash}>{contract.hash.slice(0, 16)}…</code><div className="contract-parties"><span>提供方：{data.nodes.find((node) => node.id === contract.providerNodeId)?.label ?? short(contract.providerNodeId)} {contract.acknowledgements[contract.providerNodeId] === contract.hash ? "✓" : "待确认"}</span><span>消费方：{data.nodes.find((node) => node.id === contract.consumerNodeId)?.label ?? short(contract.consumerNodeId)} {contract.acknowledgements[contract.consumerNodeId] === contract.hash ? "✓" : "待确认"}</span></div><div className="button-row">{!contract.publishedAt && [contract.providerNodeId, contract.consumerNodeId].includes(data.viewer.id) && contract.acknowledgements[data.viewer.id] !== contract.hash && <button onClick={() => run(() => api.contractAck(alignment.id, contract.id, contract.revision, contract.hash), "契约版本已确认")}>确认本版</button>}{captain && !contract.publishedAt && <button onClick={() => { if (window.confirm("将此契约依赖改为硬等待？")) run(() => api.downgradeContract(alignment.id, contract.id, contract.hash), "已改为硬依赖"); }}>改为硬依赖</button>}</div></article>)}</div>}
      {captain && alignment.status === "READY" && !!alignment.contracts?.length && alignment.contracts.some((item) => !item.publishedAt) && <button className="primary" onClick={() => run(() => api.publishContracts(alignment.id), "接口契约已冻结发布")}>冻结已确认契约</button>}
    </section>}
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
  const edges = task.dependencyEdges ?? task.dependencies.map((upstreamTaskId) => ({ upstreamTaskId, mode: "HARD" as const, contractId: null }));
  const stage = data.stages.find((item) => item.id === task.stageId);
  const hardWaiting = edges.some((edge) => edge.mode === "HARD" && data.tasks.find((item) => item.id === edge.upstreamTaskId)?.status !== "DONE");
  const contractWaiting = edges.some((edge) => edge.mode === "CONTRACT" && !stage?.contracts?.some((item) => item.id === edge.contractId && item.publishedAt));
  const dependencyState = task.status === "MOCK_PREPARING" ? "Mock 准备中" : task.status === "WAITING_INTEGRATION" ? "待真实集成" : hardWaiting ? "硬等待" : contractWaiting ? "契约待确认" : edges.some((edge) => edge.mode === "CONTRACT") && !task.mockReadiness?.passed ? "启动时准备 Mock" : edges.some((edge) => edge.mode === "CONTRACT") ? "可并行" : "无阻塞";
  return <article className={`task-card status-${task.status.toLowerCase()} ${task.status === "PAUSED" ? "paused" : ""}`}>
    <div className="task-progress" aria-hidden="true"><i/></div>
    <div className="task-header"><div><code>{task.id}</code><h3>{task.title}</h3></div><Pill tone={task.status === "DONE" ? "green" : task.status === "FAILED" || task.status === "BLOCKED" ? "red" : task.status === "IN_PROGRESS" ? "blue" : "amber"}>{labelStatus(task.status)}</Pill></div>
    <p className="goal">{task.goal}</p>
    <p className="task-dependency-state">依赖：{dependencyState}{task.executionSpec ? ` · ${task.executionSpec.deliverables.length} 项交付物` : ""}</p>
    <div className="boundary"><span>工作边界</span>{task.boundary}</div>
    <ul className="acceptance">{task.acceptance.map((item) => <li key={item}><Check size={12}/>{item}</li>)}</ul>
    <div className="task-times"><span>发布 {time(task.publishedAt)}</span>{task.startedAt && <span>开工 {time(task.startedAt)}</span>}{task.finishedAt && <span>执行结束 {time(task.finishedAt)}</span>}{task.doneAt && <span>确认 {time(task.doneAt)}</span>}</div>
    <div className="task-foot"><span>{owner?.label ?? short(task.assigneeNodeId)}</span><span>r{task.revision}</span>{task.lastGit && <code>{short(task.lastGit.headSha)}</code>}</div>
    {(mine || data.viewer.role === "captain") && <div className="button-row">
      <button onClick={() => download(task)}><ArrowDownToLine size={13}/>下载</button>
      {task.workstreamId && <button onClick={() => run(async () => { const value = await api.workstream(task.workstreamId!); const url = URL.createObjectURL(new Blob([value.markdown], { type: "text/markdown;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "workstream.md"; anchor.click(); URL.revokeObjectURL(url); }, "workstream.md 已下载")}>工作主线</button>}
      {mine && <FileButton label="上传细化 MD" disabled={!(["PUBLISHED", "REFINING", "READY", "FAILED", "PAUSED"].includes(task.status))} onFile={(filename, content) => run(() => api.uploadTask(task.id, filename, content), `${filename} 已上传`)}/>} 
      {canStart && <button className="primary" onClick={() => run(() => api.taskStart(task.id), "开工命令已发送到本机 Codex")}><Play size={13}/>开工</button>}
      {mine && ["STARTING", "IN_PROGRESS", "WAITING_CONFIRMATION", "WAITING_INTEGRATION"].includes(task.status) && <button onClick={() => run(() => api.taskSync(task.id), "已请求立即同步")}><RefreshCw size={13}/>同步</button>}
      {mine && task.status === "WAITING_INTEGRATION" && <button onClick={() => { const summary = window.prompt("完成真实代码同步并运行契约测试后，填写验证摘要："); if (!summary?.trim()) return; const providerCommits = Object.fromEntries(edges.filter((edge) => edge.mode === "CONTRACT").map((edge) => [edge.upstreamTaskId, data.tasks.find((item) => item.id === edge.upstreamTaskId)?.lastGit?.headSha ?? ""])); run(() => api.taskIntegrate(task.id, providerCommits, summary), "真实集成已记录"); }}>确认真实集成</button>}
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
  const [planSearch, setPlanSearch] = useState("");
  const [selectedChange, setSelectedChange] = useState<MarkdownDocument | null>(null);
  const [taskFilter, setTaskFilter] = useState<"all" | "mine" | "progress" | "confirm" | "done">("all");
  const [openPackage, setOpenPackage] = useState<string | null>(null);

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
  const changeReason = !currentStage || currentStage.status === "COMPLETED" ? "当前没有活动开发阶段，发布工作项后才能提交需求变更。" : "当前阶段可以提交需求变更。";
  const reviewReason = !captain ? "影响审核由队长发起和裁决；成员可以提交变更并查看进度。" : !currentStage || currentStage.status === "COMPLETED" ? "当前没有活动开发阶段，审核暂不可用。" : latestReview?.status === "AWAITING_CAPTAIN" ? "审核结论已就绪，等待队长应用或退回。" : ["REVIEWING", "AWAITING_APPLY"].includes(currentStage.status) ? "已有审核正在进行，等待本批处理完成。" : !queuedChanges.length ? "当前阶段尚无待审变更。" : data.auditPool.available === 0 ? "当前没有可用的审核 Codex 节点，成员连接并就绪后可发起。" : "有待审变更，可提前发起影响审核。";
  const myPlan = data.plans.find((plan) => plan.ownerNodeId === data.viewer.id);
  const filteredPlans = data.plans.filter((plan) => `${plan.filename} ${data.nodes.find((node) => node.id === plan.ownerNodeId)?.label ?? ""}`.toLowerCase().includes(planSearch.trim().toLowerCase()));
  const latestPlan = [...data.plans].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const doneCount = tasks.filter((task) => task.status === "DONE").length;
  const filteredTasks = tasks.filter((task) => taskFilter === "all" ||
    (taskFilter === "mine" && task.assigneeNodeId === data.viewer.id) ||
    (taskFilter === "progress" && ["STARTING", "IN_PROGRESS"].includes(task.status)) ||
    (taskFilter === "confirm" && task.status === "WAITING_CONFIRMATION") ||
    (taskFilter === "done" && task.status === "DONE"));
  const phaseLabels = ["收集提案", "共同定案", "拆分工作", "并行开发", "集成验收"];
  const phaseIndex = !data.plans.length ? 0 : !data.alignments.length ? 0 : !data.stages.length ? 1 : !tasks.length ? 2 : tasks.every((task) => task.status === "DONE") ? 4 : 3;
  const navIcons = [LayoutGrid, FileText, ListTodo, GitBranch, GitCommitHorizontal, Cloud, Activity];
  const packageCount = data.modules.reduce((total, module) => total + module.packages.length, 0);
  const attentionCount = tasks.filter((task) => task.status === "WAITING_CONFIRMATION").length;

  return <Fragment>
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <div className="approved-ui"><div className="app">
      <aside className="sidebar" aria-label="房间导航">
        <a className="brand" href="#overview"><span className="brand-icon"><img src="/vibe-git-logo.png" alt=""/></span><span>vibe-git<small>协作房间</small></span></a>
        <div className="side-label">工作区</div>
        <nav className="nav" aria-label="工作区">{NAV_ITEMS.map(([id, label], index) => { const Icon = navIcons[index]!; return <a href={`#${id}`} className={activeSection === id ? "active" : ""} aria-current={activeSection === id ? "page" : undefined} key={id}><Icon size={16}/>{label}</a>; })}</nav>
        <div className="sidebar-bottom"><strong>{data.viewer.label} · {captain ? "队长" : "成员"}</strong><p>房间状态以 Host 同步为准</p></div>
      </aside>
      <div className="main">
        <header className="topbar"><div className="crumb">协作房间 <span aria-hidden="true">/</span> <b>{NAV_ITEMS.find(([id]) => id === activeSection)?.[1] ?? "房间总览"}</b></div><div className="top-right"><span className="online">Host 在线</span><span className="sync">自动同步</span><button className="refresh" onClick={() => void refresh()}>刷新</button></div></header>
        <main id="main-content" className="content">
          <section className="approved-page" id="overview" hidden={activeSection !== "overview"}>
            <div className="headline"><div><div className="eyebrow">房间 / 项目进度</div><h1>房间总览</h1><p className="lead">查看提案、工作分配和当前进度。需要确认的事项会单独列出。</p></div><span className="phase">{phaseLabels[phaseIndex]}</span></div>
            <div className="stages" aria-label="项目阶段">{phaseLabels.map((label, index) => <Fragment key={label}>{index > 0 && <i className="stage-line"/>}<div className={`stage ${index === phaseIndex ? "current" : ""}`}><span>{index < phaseIndex ? "✓" : index + 1}</span>{label}</div></Fragment>)}</div>
            <section className="stats" aria-label="房间摘要"><div className="stat"><label>成员</label><strong>{data.nodes.length}</strong><small>{data.nodes.filter((node) => node.connected).length} 人在线</small></div><div className="stat"><label>已提交提案</label><strong>{data.plans.length} <em>/ {data.nodes.length}</em></strong><small>按成员统计</small></div><div className="stat"><label>已拆分模块</label><strong>{data.modules.length}</strong><small>共 {packageCount} 个任务包</small></div><div className="stat"><label>需要确认</label><strong>{attentionCount}</strong><small>确认前不计入完成</small></div></section>
            <ProjectTimeline data={data}/>
            <section className="work-summary"><div className="section-head"><div><h2>工作概况</h2><p>看模块状态，也能看见正在等待什么。</p></div></div><div className="below"><div className="mini-panel"><h3>模块摘要</h3>{data.modules.length ? data.modules.map((module) => <div className="summary-row" key={module.id}><div><strong>{module.name}</strong><p>{module.packages.length} 个任务包 · {module.packages.filter((pack) => pack.status === "done").length} 个已完成</p></div><span className={`status ${module.status === "in_progress" ? "blue" : module.status === "done" ? "green" : module.status === "blocked" ? "amber" : ""}`}>{module.status === "in_progress" ? "进行中" : module.status === "done" ? "已完成" : module.status === "blocked" ? "受阻" : "待规划"}</span></div>) : <p className="subtle-note">尚未拆分模块。</p>}</div><div className="mini-panel"><h3>需要处理</h3>{latestAlignment?.status === "NEEDS_DECISION" && <a className="action" href="#alignment">对齐稿有待裁决问题 →</a>}{latestReview?.status === "NEEDS_EVIDENCE" && <a className="action" href="#changes">影响审核仍需补证 →</a>}{queuedChanges.length > 0 && captain && <a className="action" href="#changes">{queuedChanges.length} 项变更待审核 →</a>}{attentionCount > 0 && <a className="action" href="#tasks">{attentionCount} 个工作项待确认 →</a>}{latestReview?.status === "AWAITING_CAPTAIN" && captain && <a className="action" href="#changes">影响审核待队长处理 →</a>}{data.modules.some((module) => !module.plannedStart || !module.plannedEnd) && captain && <a className="action" href="#overview-schedule">有模块尚未排期，检查排期文件 →</a>}{!data.plans.length && <a className="action" href="#plans">尚无项目提案 →</a>}{!attentionCount && latestAlignment?.status !== "NEEDS_DECISION" && !(latestReview?.status === "AWAITING_CAPTAIN" && captain) && data.plans.length > 0 && <p className="subtle-note">目前没有待确认的工作项。</p>}</div></div></section>
            {captain && <div id="overview-schedule"><ModuleManager key={data.moduleRevision} data={data} onSaved={() => refresh(true)}/></div>}
            <div className="footer">房间显示 Host 已保存的数据。计划日期和实际任务状态分别记录。</div>
          </section>
          <Section id="nodes" active={activeSection === "nodes"} eyebrow="成员与连接" title="成员与连接" aside={captain && <><button onClick={() => run(async () => { const invite = await api.invite(); await navigator.clipboard.writeText(invite.command); }, "加入命令已复制")}><Copy size={13}/>复制加入命令</button><button onClick={() => run(() => api.rotateInvite(), "邀请密钥已轮换")}><RotateCw size={13}/>轮换邀请</button></>}>
            <div className="node-field"><div className="node-axis" aria-hidden="true"><span>CAPTAIN</span><i/><span>MEMBERS</span></div><div className="node-list">{data.nodes.map((node) => <NodeCard key={node.id} node={node} viewer={data.viewer} onRevoke={(id) => run(() => api.revokeNode(id), "节点已撤销")}/>)}</div></div>
            {captain && data.tunnel && <div className="tunnel"><span className="tunnel-icon"><Cloud size={16}/><i/></span><div><small>公开连接</small><b>Cloudflare Quick Tunnel</b><span>{data.tunnel.url || data.tunnel.phase}</span></div><Pill tone={data.tunnel.running ? "green" : "amber"}>{data.tunnel.running ? "运行中" : data.tunnel.phase}</Pill><div className="button-row">{!data.tunnel.installed && <button onClick={() => run(() => api.tunnelInstall(), "cloudflared 已安装")}>安装</button>}{!data.tunnel.running ? <button onClick={() => run(() => api.tunnelStart(), "Tunnel 已启动")}>启动</button> : <button onClick={() => run(() => api.tunnelStop(), "Tunnel 已停止")}>停止</button>}</div></div>}
          </Section>

          <Section id="plans" active={activeSection === "plans"} eyebrow="项目提案" title="项目提案" aside={<div className="plan-toolbar"><span><Eye size={12}/>{data.plans.length} 位成员已提交</span><button className="primary" onClick={() => setComposerOpen(true)}>{myPlan ? "更新我的提案" : "提交我的提案"}</button></div>}>
            <section className="page-metrics" aria-label="提案摘要"><div className="stat"><label>已提交成员</label><strong>{data.plans.length} <em>/ {data.nodes.length}</em></strong><small>每位成员保留一份当前提案</small></div><div className="stat"><label>Agent 已分析</label><strong>{data.plans.filter((plan) => data.alignments.some((alignment) => alignment.moduleRevisionSnapshot === data.moduleRevision && alignment.planImpacts?.some((item) => item.documentId === plan.id))).length}</strong><small>模块影响在队长端对齐时分析</small></div><div className="stat"><label>最近提交</label><strong>{latestPlan ? new Date(latestPlan.createdAt).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }) : "—"}</strong><small>{latestPlan ? time(latestPlan.createdAt) : "尚无提案"}</small></div></section>
            <section><div className="section-head"><div><h2>各成员的最新提案</h2><p>点开卡片可查看完整正文与内容 hash；模块影响由队长端 Agent 分析。</p></div><input className="search" type="search" value={planSearch} onChange={(event) => setPlanSearch(event.target.value)} placeholder="搜索成员或提案" aria-label="搜索成员或提案"/></div><div className="proposal-layout"><div>{filteredPlans.length ? <div className="proposal-grid">{filteredPlans.map((plan) => <PlanCard key={plan.id} plan={plan} data={data} download={downloadPlan} onEdit={() => setComposerOpen(true)} onWithdraw={() => { if (window.confirm("撤回后不再参与下一轮对齐。已冻结的对齐版本仍保留。确定撤回？")) run(() => api.withdrawPlan(plan.id, plan.revision), "提案已撤回"); }}/>)}</div> : <div className="no-results">{data.plans.length ? "没有找到匹配的提案。" : "尚无成员提案。"}</div>}</div><aside className="guide"><h3>如何提交提案</h3><p>从本机选择 Markdown 文件提交。可随时查看旧版本，也可以将旧正文恢复为新版本。</p><ol><li>准备并选择 .md 文件</li><li>提交或更新自己的提案</li><li>等待队长发起对齐审核</li></ol><p className="quiet-note">Agent 的模块分析与冲突判断在对齐审核中进行。提交不代表全队定案。</p></aside></div></section>
            <PlanHistory data={data} active={activeSection === "plans"} onChanged={() => refresh(true)}/>
            {captain && <div className="section-bottom"><span>开始时冻结每个节点的最新版本，后续上传自动进入下一轮。</span><button className="primary" disabled={!data.plans.length || busy} onClick={() => run(() => api.startAlignment(), "需求对齐已进入审核池")}><Bot size={14}/>开始对齐<ChevronRight size={13}/></button></div>}
          </Section>

          <Section id="alignment" active={activeSection === "alignment"} eyebrow="对齐与裁决" title="对齐与裁决" aside={latestAlignment && captain && latestAlignment.status === "READY" && <button className="primary" onClick={() => run(() => api.publish(latestAlignment.id), "任务阶段已发布")}><ChevronRight size={14}/>发布任务</button>}>
            {latestAlignment ? <AlignmentView alignment={latestAlignment} data={data} run={run}/> : <Empty>队长开始对齐后，专用 Codex 节点会在这里生成统一需求、任务稿和结构化分配。</Empty>}
          </Section>

          <Section id="tasks" active={activeSection === "tasks"} eyebrow="工作项" title="工作项" aside={currentStage && <div className="stage-label"><Pill tone={currentStage.status === "ACTIVE" ? "green" : currentStage.status === "COMPLETED" ? "plain" : "amber"}>{labelStatus(currentStage.status)}</Pill><b>阶段 {currentStage.sequence}</b><span>需求 R{currentStage.requirementRevision}</span>{captain && currentStage.status === "ACTIVE" && <button onClick={() => { if (window.confirm("只有所有切片都未开工且没有运行作业时才能重编排。开始生成新草稿？")) run(() => api.replanStage(currentStage.id), "重编排已排队，旧任务暂时保留"); }}>重编排</button>}</div>}>
            <section className="page-metrics" aria-label="工作项摘要"><div className="stat"><label>模块</label><strong>{data.modules.length}</strong><small>{data.modules.filter((module) => module.status === "in_progress").length} 个进行中</small></div><div className="stat"><label>任务包</label><strong>{packageCount}</strong><small>按房间排期统计</small></div><div className="stat"><label>待确认</label><strong>{attentionCount}</strong><small>人工确认前不计完成</small></div></section>
            {!!currentStage?.contracts?.length && <section className="stage-contracts"><div className="section-head"><div><h2>接口契约</h2><p>接口双方确认当前版本后，队长可以重新冻结。未确认前相关切片不能按契约并行。</p></div></div>
              <div className="contract-list">{currentStage.contracts.map((contract) => <article key={contract.id}><div className="contract-title"><strong>{contract.id} · v{contract.revision}</strong><Pill tone={contract.publishedAt ? "green" : "amber"}>{contract.publishedAt ? "已冻结" : "待确认"}</Pill></div><p>{contract.signature}</p><small>{contract.behavior}</small><small>提供：{data.nodes.find((item) => item.id === contract.providerNodeId)?.label ?? short(contract.providerNodeId)} · 消费：{data.nodes.find((item) => item.id === contract.consumerNodeId)?.label ?? short(contract.consumerNodeId)}</small><small>测试：{contract.testCommand} · 交接：{contract.handoffArtifact}</small><div className="contract-parties"><span>提供方 {contract.acknowledgements[contract.providerNodeId] === contract.hash ? "已确认" : "待确认"}</span><span>消费方 {contract.acknowledgements[contract.consumerNodeId] === contract.hash ? "已确认" : "待确认"}</span></div>{!contract.publishedAt && <div className="button-row">{[contract.providerNodeId, contract.consumerNodeId].includes(data.viewer.id) && contract.acknowledgements[data.viewer.id] !== contract.hash && <button onClick={() => run(() => api.stageContractAck(currentStage.id, contract.id, contract.revision, contract.hash), "当前契约已确认")}>确认此版本</button>}{captain && <button onClick={() => { if (window.confirm("改为等待提供方任务完成后再开工？")) run(() => api.downgradeStageContract(currentStage.id, contract.id, contract.hash), "已改为硬等待"); }}>改为硬等待</button>}</div>}</article>)}</div>
              {captain && currentStage.contracts.some((contract) => !contract.publishedAt) && <button className="primary" onClick={() => run(() => api.publishStageContracts(currentStage.id), "接口契约已冻结")}>冻结已确认契约</button>}
            </section>}
            <section><div className="section-head"><div><h2>模块与任务包</h2><p>按模块分组。打开任务包可查看关联的工作项。</p></div></div>{data.modules.length ? data.modules.map((module) => <div className="work-group" key={module.id}><div className="work-group-header"><div><strong>{module.name}</strong><p>{module.plannedStart && module.plannedEnd ? `计划 ${module.plannedStart} — ${module.plannedEnd}` : "模块时间待排"} · {module.packages.length} 个任务包</p></div><span className={`status ${module.status === "in_progress" ? "blue" : module.status === "done" ? "green" : module.status === "blocked" ? "amber" : ""}`}>{module.status === "in_progress" ? "进行中" : module.status === "done" ? "已完成" : module.status === "blocked" ? "受阻" : "待规划"}</span></div><div className="work-head"><span>任务包</span><span>负责人</span><span>状态</span><span>计划时间</span><span>关联任务</span><span>详情</span></div>{module.packages.length ? module.packages.map((pack) => { const linked = tasks.filter((task) => pack.taskIds.includes(task.id)); const owners = [...new Set(linked.map((task) => data.nodes.find((node) => node.id === task.assigneeNodeId)?.label ?? short(task.assigneeNodeId)))]; return <Fragment key={pack.id}><div className="work-row"><div><strong>{pack.name}</strong><small className="work-id">{pack.id}</small></div><span>{owners.length ? owners.join("、") : "未登记"}</span><span className={`status ${pack.status === "in_progress" ? "blue" : pack.status === "done" ? "green" : pack.status === "blocked" ? "amber" : ""}`}>{pack.status === "in_progress" ? "进行中" : pack.status === "done" ? "已完成" : pack.status === "blocked" ? "受阻" : "待开工"}</span><span>{pack.plannedStart && pack.plannedEnd ? `${pack.plannedStart} — ${pack.plannedEnd}` : "待排期"}</span><span>{linked.length} 项</span><button className="detail-button" aria-expanded={openPackage === pack.id} onClick={() => setOpenPackage((old) => old === pack.id ? null : pack.id)}>{openPackage === pack.id ? "收起" : "查看"}</button></div>{openPackage === pack.id && <div className="work-package-detail">{linked.length ? <div className="task-grid">{linked.map((task) => <TaskCard key={task.id} task={task} data={data} run={run} download={downloadTask}/>)}</div> : <p className="subtle-note">此任务包尚未关联本阶段工作项。</p>}</div>}</Fragment>; }) : <div className="work-empty">此模块尚无任务包。</div>}</div>) : <div className="work-empty panel">房间尚未登记模块和任务包。队长可在总览上传排期文件。</div>}</section>
            <section className="work-task-actions"><div className="section-head"><div><h2>正式工作项</h2><p>状态来自 Host；确认完成前不会计入已完成数量。</p></div></div><div className="work-filters">{([ ["all", `全部 ${tasks.length}`], ["mine", `我的工作 ${tasks.filter((task) => task.assigneeNodeId === data.viewer.id).length}`], ["progress", `进行中 ${tasks.filter((task) => ["STARTING", "IN_PROGRESS"].includes(task.status)).length}`], ["confirm", `待确认 ${attentionCount}`], ["done", `已完成 ${doneCount}`] ] as const).map(([key, title]) => <button key={key} className={taskFilter === key ? "selected" : ""} onClick={() => setTaskFilter(key)}>{title}</button>)}</div>{filteredTasks.length ? <div className="task-grid">{filteredTasks.map((task) => <TaskCard key={task.id} task={task} data={data} run={run} download={downloadTask}/>)}</div> : <Empty>{tasks.length ? "当前筛选下没有工作项。" : "尚未发布正式任务。对齐结果须由队长确认后发布。"}</Empty>}</section>
          </Section>

          <Section id="changes" active={activeSection === "changes"} eyebrow="变更审核" title="变更审核" aside={<FileButton label="上传变更 MD" disabled={!currentStage || currentStage.status === "COMPLETED"} onFile={(filename, content) => run(() => api.uploadChange(filename, content), `${filename} 已作为需求变更提交`)}/>}>
            <p className="change-prereq">{changeReason} {reviewReason}</p>
            <div className="change-layout">
              <div className="change-list">{data.pullRequests.length ? [...data.pullRequests].reverse().map((change, index) => <button className="change-row" key={change.id} onClick={() => run(async () => { setSelectedChange(await api.document(change.documentId)); }, "已打开变更正文")}><i>{String(index + 1).padStart(2, "0")}</i><span><code>{change.id}</code><b>{data.nodes.find((node) => node.id === change.submitterNodeId)?.label}</b></span><Pill tone={change.status === "APPLIED" ? "green" : change.status === "REJECTED" ? "red" : "amber"}>{labelStatus(change.status)}</Pill><small>{time(change.createdAt)}</small></button>) : <Empty>开发期间可以持续提交需求变更，普通成员不能开启审核。</Empty>}</div>
              <article className="review-card"><div className="review-scan" aria-hidden="true"/><div className="review-title"><span className="agent-mark"><Bot size={18}/><i/></span><div><span>审核节点</span><h3>影响审核</h3></div>{latestReview && <Pill tone={latestReview.status === "AWAITING_CAPTAIN" ? "amber" : latestReview.status === "APPLIED" ? "green" : "plain"}>{labelStatus(latestReview.status)}</Pill>}</div>{latestReview?.summaryMarkdown ? <Markdown>{latestReview.summaryMarkdown}</Markdown> : <p>{latestReview?.status === "NEEDS_EVIDENCE" ? "正在分布式取证；离线节点重连后自动补查。" : "变更按阶段合并分析。开发结束后自动审核；队长也可提前强制审核，只暂停受影响任务。"}</p>}{latestReview?.status === "NEEDS_EVIDENCE" && <div className="affected"><span>待补证节点</span>{(latestReview.pendingNodeIds ?? []).map((id) => <Pill key={id}>{data.nodes.find((node) => node.id === id)?.label ?? short(id)}{latestReview.probes?.[id]?.uncertainTaskIds.length ? ` · ${latestReview.probes[id]!.uncertainTaskIds.length} 项待确认` : ""}</Pill>)}{latestReview.error && <small>{latestReview.error}</small>}{(latestReview.pendingNodeIds ?? []).flatMap((id) => (latestReview.probes?.[id]?.findings ?? []).filter((finding) => latestReview.probes?.[id]?.uncertainTaskIds.includes(finding.taskId)).map((finding) => <small key={`${id}-${finding.taskId}`}>{short(finding.taskId)}：{finding.reason}</small>))}</div>}{latestReview?.affectedNodeIds.length ? <div className="affected"><span>受影响节点</span>{latestReview.affectedNodeIds.map((id) => <Pill key={id}>{data.nodes.find((node) => node.id === id)?.label ?? short(id)}</Pill>)}</div> : null}<div className="button-row">{captain && queuedChanges.length > 0 && currentStage?.status === "ACTIVE" && <button disabled={busy || data.auditPool.available === 0} onClick={() => run(() => api.forceReview(), "已强制开始影响审核")}><Pause size={13}/>立即审核</button>}{captain && latestReview && ["NEEDS_EVIDENCE", "QUEUED", "RUNNING"].includes(latestReview.status) && <button className="danger" onClick={() => run(() => api.cancelReview(latestReview.id), "审核已取消，变更返回待审队列")}><X size={13}/>取消审核</button>}{captain && latestReview?.status === "AWAITING_CAPTAIN" && <><button className="primary" onClick={() => run(() => api.applyReview(latestReview.id), "审核结果已应用")}><Check size={13}/>应用</button><button className="danger" onClick={() => run(() => api.rejectReview(latestReview.id), "审核结果已退回")}><X size={13}/>退回</button></>}</div></article>
            </div>
            {selectedChange && <article className="change-document"><div className="subsection-head"><div><h3>{selectedChange.filename}</h3><small>版本 {selectedChange.revision} · {time(selectedChange.createdAt)}</small></div><button onClick={() => setSelectedChange(null)}>关闭</button></div><Markdown>{selectedChange.content}</Markdown></article>}
          </Section>

          <Section id="messages" active={activeSection === "messages"} eyebrow="消息" title="消息" aside={<button onClick={() => void refresh()}><RefreshCw size={13}/>刷新</button>}>
            {data.notifications.length ? <div className="messages">{data.notifications.map((item, index) => <article key={item.id}><span className="message-index">{String(index + 1).padStart(2, "0")}</span><span className={`message-icon ${item.type.toLowerCase()}`}>{item.type === "TASK" ? <GitBranch size={14}/> : item.type === "REVIEW" ? <Bot size={14}/> : <Activity size={14}/>}</span><div><div><b>{item.title}</b><Pill>{item.type}</Pill></div><p>{item.body}</p></div><time>{time(item.createdAt)}</time></article>)}</div> : <Empty>暂无消息。通知持久保存，离线节点重连后也能看到。</Empty>}
          </Section>
        </main>
      </div>
    </div></div>

    {notice && <button className={`toast ${busy ? "is-busy" : ""}`} aria-live="polite" onClick={() => setNotice(null)}>{busy ? <span className="spinner"/> : <Check size={14}/>}<span>{notice}</span><X size={13}/></button>}
    {composerOpen && <div className="approved-ui"><ProposalComposer data={data} current={myPlan} onClose={() => setComposerOpen(false)} onSaved={() => refresh(true)}/></div>}
  </Fragment>;
}
