import {
  Fragment,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
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
  X,
} from "lucide-react";
import type {
  AlignmentRun,
  CollaborationNode,
  MarkdownDocument,
  StageTask,
  V20BootstrapPayload,
} from "@vibe-git/protocol";
import { api, ApiError, localCapabilities } from "./api";
import {
  ModuleManager,
  ProjectTimeline,
  ProposalComposer,
} from "./WorkspacePanels";
import { Markdown } from "./Markdown";
import { PlanHistory } from "./PlanHistory";
import { ContractBoard, TaskChat, WorkstreamBoard } from "./ContractWorkspace";

const NAV_ITEMS = [
  ["overview", "房间总览", "01"],
  ["plans", "项目提案", "02"],
  ["tasks", "工作项", "03"],
  ["alignment", "对齐与裁决", "04"],
  ["changes", "变更审核", "05"],
  ["nodes", "成员与连接", "06"],
  ["messages", "消息", "07"],
] as const;

const SATELLITE_POSITIONS = [
  { x: 50, y: 15 },
  { x: 82, y: 31 },
  { x: 79, y: 72 },
  { x: 50, y: 85 },
  { x: 18, y: 69 },
  { x: 20, y: 29 },
] as const;

const time = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "—";
const short = (value: string | null | undefined, size = 8) =>
  value ? value.slice(0, size) : "—";
const statusText: Record<string, string> = {
  DRAFT: "草稿",
  PUBLISHED: "已发布",
  REFINING: "细化中",
  READY: "待发布",
  STARTING: "准备开工",
  PREPARING_MOCK: "准备接口替身",
  IN_PROGRESS: "进行中",
  WAITING_INTEGRATION: "待真实集成",
  WAITING_CONFIRMATION: "待本人确认",
  PAUSED: "已暂停",
  BLOCKED: "受阻",
  DONE: "已确认完成",
  FAILED: "失败",
  QUEUED: "排队中",
  RUNNING: "处理中",
  NEEDS_DECISION: "待裁决",
  ACTIVE: "进行中",
  COMPLETED: "已完成",
  REVIEWING: "审核中",
  AWAITING_APPLY: "待应用",
  AWAITING_CAPTAIN: "待队长处理",
  NEEDS_EVIDENCE: "待补证",
  APPLIED: "已应用",
  REJECTED: "已退回",
  IN_REVIEW: "审核中",
  CANCELLED: "已取消",
};
const labelStatus = (value: string) => statusText[value] ?? value;

function alignmentProgress(alignment: AlignmentRun): string {
  if (alignment.status === "QUEUED") {
    const total = alignment.summaryJobIds?.length ?? 0;
    const complete = Object.keys(alignment.summaryParts ?? {}).length;
    return total
      ? `正在汇总提案 ${Math.min(complete, total)}/${total}`
      : "等待审核节点接取";
  }
  if (alignment.status === "RUNNING")
    return alignment.phase === "FINALIZE"
      ? "正在分批补齐各成员工作主线与接口契约"
      : "Codex 正在分析提案与任务分工";
  if (alignment.status === "NEEDS_DECISION")
    return "对齐稿已生成，等待队长裁决";
  if (alignment.status === "READY")
    return "对齐稿与任务草稿已生成，等待队长检查";
  if (alignment.status === "PUBLISHED") return "任务阶段已发布";
  return alignment.error || "本轮对齐失败";
}

function BrandGlyph() {
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true">
      <path d="M8 8v12.5c0 5 3.2 7.5 8.4 7.5H28" />
      <path d="M8 14.5h12.5L28 7M20.5 14.5 28 22" />
      <circle cx="8" cy="8" r="2.2" />
      <circle cx="28" cy="7" r="2.2" />
      <circle cx="28" cy="22" r="2.2" />
      <circle cx="28" cy="28" r="2.2" />
    </svg>
  );
}

function Pill({
  children,
  tone = "plain",
}: {
  children: ReactNode;
  tone?: "plain" | "green" | "amber" | "red" | "blue";
}) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

function Section({
  id,
  eyebrow,
  title,
  aside,
  children,
  active,
}: {
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
    messages: "查看房间保存的通知与任务消息。",
  };
  return (
    <section id={id} className={`section section-${id}`} hidden={!active}>
      <header className="section-title page-titlebar">
        <div className="section-heading">
          <div className="eyebrow">房间 / {eyebrow}</div>
          <h1>{title}</h1>
          <p className="lead">{descriptions[id]}</p>
        </div>
        {aside && <div className="section-actions">{aside}</div>}
      </header>
      <div className="section-content">{children}</div>
    </section>
  );
}

export function FileButton({
  label,
  onFile,
  disabled,
}: {
  label: string;
  onFile(filename: string, content: string): void;
  disabled?: boolean;
}) {
  return (
    <label className={`button upload-button ${disabled ? "disabled" : ""}`}>
      <Upload size={14} />
      <span>{label}</span>
      <i aria-hidden="true" />
      <input
        type="file"
        accept=".md,text/markdown,text/plain"
        disabled={disabled}
        onChange={async (event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          if (!/\.md$/i.test(file.name)) {
            window.alert("请选择任意一个 .md 文件");
            return;
          }
          if (file.size > 256 * 1024) {
            window.alert("Markdown 不能超过 256 KiB");
            return;
          }
          try {
            onFile(
              file.name,
              new TextDecoder("utf-8", { fatal: true }).decode(
                await file.arrayBuffer(),
              ),
            );
          } catch {
            window.alert("Markdown 必须是有效 UTF-8");
          }
        }}
      />
    </label>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-radar">
        <i />
        <i />
        <FileText size={19} />
      </div>
      <div>
        <b>暂无内容</b>
        <p>{children}</p>
      </div>
    </div>
  );
}

export function BootScreen() {
  return (
    <main className="boot-screen">
      <div className="ambient-grid" aria-hidden="true" />
      <div className="boot-orbit" aria-hidden="true">
        <i />
        <i />
        <span>
          <BrandGlyph />
        </span>
      </div>
      <code>ESTABLISHING LOCAL SESSION</code>
      <p>正在读取节点、阶段与审核池状态</p>
    </main>
  );
}

export function Welcome({ error }: { error: string | null }) {
  const connect = "vibe-git connect <队长提供的 join-url>\nvibe-git open";
  return (
    <main className="welcome">
      <div className="ambient-grid" aria-hidden="true" />
      <div className="welcome-shell is-visible" data-reveal>
        <div className="welcome-mark">
          <BrandGlyph />
        </div>
        <span className="kicker">VIBE—GIT / LOCAL ACCESS</span>
        <h1>连接房间</h1>
        <p>
          这里不输入项目名称或成员名字。队长启动
          Host，成员在自己的工作区运行加入命令，节点会自动注册。
        </p>
        <div className="terminal">
          <span className="terminal-lights">
            <i />
            <i />
            <i />
          </span>
          <code>{connect}</code>
          <button onClick={() => navigator.clipboard.writeText(connect)}>
            <Copy size={14} />
            复制
          </button>
        </div>
        {error && <div className="welcome-error">{error}</div>}
        <small>
          已经连接？在终端运行 <b>vibe-git open</b>，一次性票据会建立安全会话。
        </small>
      </div>
    </main>
  );
}

function NodeCard({
  node,
  viewer,
  onRevoke,
}: {
  node: CollaborationNode;
  viewer: CollaborationNode;
  onRevoke(id: string): void;
}) {
  return (
    <article
      className={`node-card ${node.connected ? "is-online" : "is-offline"}`}
    >
      <div className="node-scan" aria-hidden="true" />
      <div className="node-top">
        <div className={`node-orb ${node.connected ? "online" : ""}`}>
          {node.role === "captain" ? (
            <ShieldCheck size={17} />
          ) : (
            <Circle size={12} />
          )}
          <i />
        </div>
        <div>
          <span>{node.role === "captain" ? "队长" : "成员"}</span>
          <b>{node.label}</b>
          <code>{short(node.id, 18)}</code>
        </div>
        <Pill tone={node.connected ? "green" : "plain"}>
          {node.connected ? "在线" : "离线"}
        </Pill>
      </div>
      <div className="node-grid">
        <span>
          审核 Codex<b>{node.auditCodex}</b>
        </span>
        <span>
          开发 Codex<b>{node.workCodex}</b>
        </span>
        <span>
          作业负载<b>{String(node.activeJobCount).padStart(2, "0")}</b>
        </span>
        <span>
          工作区<b>{node.workspaceReady ? "就绪" : "未就绪"}</b>
        </span>
      </div>
      {node.git && (
        <div className="git-line">
          <GitCommitHorizontal size={13} />
          <b>{node.git.branch}</b>
          <code>{short(node.git.headSha)}</code>
          <span>{node.git.dirty ? "有修改" : "干净"}</span>
        </div>
      )}
      {node.rateLimits.length > 0 && (
        <div className="quota">
          {node.rateLimits.map((item) => (
            <span key={item.label}>
              {item.label}
              <i>
                <em style={{ width: `${item.remainingPercent ?? 0}%` }} />
              </i>
              <b>
                {item.remainingPercent == null
                  ? "?"
                  : `${Math.round(item.remainingPercent)}%`}
              </b>
            </span>
          ))}
        </div>
      )}
      {viewer.role === "captain" && node.role !== "captain" && (
        <button className="text danger" onClick={() => onRevoke(node.id)}>
          撤销节点
        </button>
      )}
    </article>
  );
}

export function PlanCard({
  plan,
  data,
  download,
  onEdit,
  onWithdraw,
}: {
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
  const excerpt = plan.content
    .replace(/[#*>`_\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const assessment = [...data.alignments]
    .reverse()
    .find(
      (alignment) =>
        alignment.source === "plans" &&
        alignment.moduleRevisionSnapshot === data.moduleRevision &&
        alignment.planSnapshot.some((item) => item.documentId === plan.id) &&
        alignment.planImpacts?.some((item) => item.documentId === plan.id),
    );
  const finding = assessment?.planImpacts?.find(
    (item) => item.documentId === plan.id,
  );
  const overlap = finding?.moduleIds.some((id) =>
    assessment?.planImpacts?.some(
      (item) =>
        item.documentId !== plan.id &&
        data.plans.some((other) => other.id === item.documentId) &&
        item.moduleIds.includes(id),
    ),
  );
  return (
    <article className="proposal-card">
      <div className="proposal-top">
        <span className="avatar">{author.slice(0, 1)}</span>
        <div>
          <strong>{author}</strong>
          <small>
            最新版本 v{plan.revision} · {time(plan.createdAt)}
          </small>
        </div>
        <span className="status green">已提交</span>
      </div>
      <h3>{plan.filename.replace(/\.md$/i, "")}</h3>
      <p>
        {excerpt.slice(0, 105)}
        {excerpt.length > 105 ? "…" : ""}
      </p>
      <div className="plan-impact">
        <span>受影响模块</span>
        {finding ? (
          finding.moduleIds.length ? (
            finding.moduleIds.map((id) => (
              <Pill key={id} tone="blue">
                {data.modules.find((item) => item.id === id)?.name ??
                  "已移除模块"}
              </Pill>
            ))
          ) : (
            <small>审核认为不涉及已登记模块</small>
          )
        ) : (
          <small>待队长端 Agent 分析</small>
        )}
      </div>
      {finding && (
        <p className="plan-impact-rationale">审核依据：{finding.rationale}</p>
      )}
      {overlap && (
        <p className="plan-overlap">有其他提案涉及相同模块，待对齐时核对。</p>
      )}
      <div className="proposal-foot">
        <span>
          版本 {plan.revision} · {Math.ceil(plan.bytes / 1024)} KiB
        </span>
        <button
          className="detail-button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起正文" : "查看正文 →"}
        </button>
      </div>
      {expanded && (
        <div className="proposal-full">
          <code>SHA-256 {plan.sha256}</code>
          <Markdown>{plan.content}</Markdown>
          <div className="button-row">
            <button onClick={() => download(plan)}>
              <ArrowDownToLine size={13} />
              下载
            </button>
            {mine && (
              <>
                <button onClick={onEdit}>更新</button>
                <button className="danger" onClick={onWithdraw}>
                  撤回
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function CollaborationMap({
  data,
  taskCount,
  doneCount,
}: {
  data: V20BootstrapPayload;
  taskCount: number;
  doneCount: number;
}) {
  const visibleNodes = data.nodes.slice(0, SATELLITE_POSITIONS.length);
  const onlineCount = data.nodes.filter((node) => node.connected).length;
  return (
    <div className="network-stage" aria-label={`${onlineCount} 个在线节点`}>
      <div className="network-grid" aria-hidden="true" />
      <div className="network-sweep" aria-hidden="true" />
      <svg className="network-lines" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="35" />
        <circle cx="50" cy="50" r="23" />
        {visibleNodes.map((node, index) => (
          <line
            key={node.id}
            x1="50"
            y1="50"
            x2={SATELLITE_POSITIONS[index]!.x}
            y2={SATELLITE_POSITIONS[index]!.y}
          />
        ))}
      </svg>
      <div className="network-core">
        <span>ROOM</span>
        <strong>R{data.room.requirementRevision}</strong>
        <small>live mesh</small>
      </div>
      {visibleNodes.map((node, index) => (
        <div
          key={node.id}
          className={`satellite satellite-${index} ${node.connected ? "online" : ""}`}
        >
          <i />
          <span>
            {node.role === "captain" ? "C" : String(index).padStart(2, "0")}
          </span>
          <b>{node.label}</b>
        </div>
      ))}
      <div className="telemetry telemetry-online">
        <span>ONLINE</span>
        <b>{String(onlineCount).padStart(2, "0")}</b>
      </div>
      <div className="telemetry telemetry-pool">
        <span>AUDIT POOL</span>
        <b>{String(data.auditPool.available).padStart(2, "0")}</b>
      </div>
      <div className="telemetry telemetry-tasks">
        <span>DELIVERY</span>
        <b>
          {doneCount}/{taskCount}
        </b>
      </div>
      <div className="network-caption">
        <Radio size={12} />
        <span>节点心跳每 15 秒回传，不上传对话正文</span>
      </div>
    </div>
  );
}

export function AlignmentView({
  alignment,
  data,
  run,
  section = "all",
}: {
  alignment: AlignmentRun;
  data: V20BootstrapPayload;
  run(work: () => Promise<unknown>, message: string): void;
  section?: "all" | "alignment" | "decisions" | "publish";
}) {
  const captain = data.viewer.role === "captain";
  return (
    <div className="alignment-layout">
      {section !== "publish" && <article className="paper alignment-paper">
        <div className="paper-meta">
          <Pill
            tone={
              alignment.status === "READY"
                ? "green"
                : alignment.status === "FAILED"
                  ? "red"
                  : "amber"
            }
          >
            {labelStatus(alignment.status)}
          </Pill>
          <code>{alignment.id}</code>
          <span>{time(alignment.createdAt)}</span>
        </div>
        {section !== "decisions" && (alignment.alignmentMarkdown ? (
          <Markdown>{alignment.alignmentMarkdown}</Markdown>
        ) : (
          <div className="processing" role="status">
            <span className="processing-orbit">
              <Bot size={19} />
              <i />
            </span>
            <span>{alignmentProgress(alignment)}。状态会自动同步。</span>
          </div>
        ))}
        {section === "decisions" && !alignment.issues?.length && <p>本轮没有需要裁决的问题。</p>}
        {(section === "all" || section === "decisions") && !!alignment.issues?.length && (
          <div className="decision-list">
            <h3>
              队长裁决 ·{" "}
              {
                alignment.issues.filter((issue) => !issue.selectedOptionId)
                  .length
              }{" "}
              项待选择
            </h3>
            {alignment.issues.map((issue) => (
              <section className="decision-card" key={issue.id}>
                <div>
                  <code>{issue.id}</code>
                  <h4>{issue.title}</h4>
                </div>
                <div className="decision-evidence">
                  {issue.evidence.map((item, index) => (
                    <blockquote key={`${item.nodeId}-${index}`}>
                      <b>
                        {data.nodes.find((node) => node.id === item.nodeId)
                          ?.label ?? short(item.nodeId)}
                      </b>{" "}
                      · {item.excerpt}
                    </blockquote>
                  ))}
                </div>
                <div className="decision-options">
                  {issue.options.map((option) => (
                    <button
                      key={option.id}
                      className={
                        issue.selectedOptionId === option.id ? "primary" : ""
                      }
                      disabled={
                        !captain || alignment.status !== "NEEDS_DECISION"
                      }
                      onClick={() =>
                        run(
                          () =>
                            api.resolveAlignment(
                              alignment.id,
                              issue.id,
                              option.id,
                              alignment.decisionRevision ?? 0,
                            ),
                          "裁决已记录",
                        )
                      }
                    >
                      {option.label}
                      {issue.recommendedOptionId === option.id ? " · 建议" : ""}
                      <small>{option.impact}</small>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </article>}
      {(section === "all" || section === "publish") && <aside className="drafts">
        <div className="drafts-heading">
          <div>
            <span>对齐结果</span>
            <h3>{alignment.status === "PUBLISHED" ? "已发布任务" : "任务草稿"}</h3>
          </div>
          <b>{String(alignment.tasks.length).padStart(2, "0")}</b>
        </div>
        {alignment.tasks.map((task, index) => (
          <article key={task.id} className="draft-card">
            <div>
              <code>
                {String(index + 1).padStart(2, "0")} / {short(task.id)}
              </code>
              <Pill>
                {task.dependencyEdges?.length
                  ? `${task.dependencyEdges.filter((edge) => edge.mode === "CONTRACT").length} 契约 · ${task.dependencyEdges.filter((edge) => edge.mode === "HARD").length} 硬等待`
                  : "可独立"}
              </Pill>
            </div>
            <h4>{task.title}</h4>
            <p>{task.goal}</p>
            <small>{task.boundary}</small>
            {task.assignmentRationale && (
              <small>
                分工依据：{task.assignmentRationale} · {task.effort ?? "M"}
              </small>
            )}
            {task.brief && (
              <div className="draft-deliverables">
                <b>验收交付物</b>
                {task.brief.deliverables.map((item) => (
                  <small key={item}>{item}</small>
                ))}
                <small>文件所有权：{task.brief.ownedPaths.join("、")}</small>
              </div>
            )}
            {captain && alignment.status === "READY" ? (
              <select
                value={task.assigneeNodeId}
                onChange={(event) =>
                  run(
                    () => api.assign(alignment.id, task.id, event.target.value),
                    "任务已改派",
                  )
                }
              >
                {data.nodes.map((node) => (
                  <option value={node.id} key={node.id}>
                    {node.label}
                  </option>
                ))}
              </select>
            ) : (
              <b>
                {data.nodes.find((node) => node.id === task.assigneeNodeId)
                  ?.label ?? short(task.assigneeNodeId)}
              </b>
            )}
          </article>
        ))}
      </aside>}
    </div>
  );
}

export function TaskCard({
  task,
  data,
  run,
  download,
  writable = true,
}: {
  task: StageTask;
  data: V20BootstrapPayload;
  run(work: () => Promise<unknown>, message: string): void;
  download(task: StageTask): void;
  writable?: boolean;
}) {
  const [detail, setDetail] = useState<string | null>(null);
  const mine = task.assigneeNodeId === data.viewer.id;
  const owner = data.nodes.find((node) => node.id === task.assigneeNodeId);
  const canStart =
    mine && ["PUBLISHED", "READY", "FAILED"].includes(task.status);
  const edges =
    task.dependencyEdges ??
    task.dependencies.map((upstreamTaskId) => ({
      upstreamTaskId,
      mode: "HARD" as const,
      reason: "需等待上游完成",
      contractId: null,
    }));
  return (
    <article
      className={`task-card status-${task.status.toLowerCase()} ${task.status === "PAUSED" ? "paused" : ""}`}
    >
      <div className="task-progress" aria-hidden="true">
        <i />
      </div>
      <div className="task-header">
        <div>
          <code>{task.id}</code>
          <h3>{task.title}</h3>
        </div>
        <Pill
          tone={
            task.status === "DONE"
              ? "green"
              : task.status === "FAILED" || task.status === "BLOCKED"
                ? "red"
                : task.status === "IN_PROGRESS"
                  ? "blue"
                  : "amber"
          }
        >
          {labelStatus(task.status)}
        </Pill>
      </div>
      <p className="goal">{task.goal}</p>
      <button
        onClick={() =>
          detail
            ? setDetail(null)
            : run(
                async () => setDetail((await api.taskDetail(task.id)).markdown),
                "已载入任务正文",
              )
        }
      >
        {detail ? "收起正文" : "查看完整任务说明"}
      </button>
      {detail && <Markdown>{detail}</Markdown>}
      {task.blockedReason && (
        <p className="task-blocker">阻塞原因：{task.blockedReason}</p>
      )}
      <div className="boundary">
        <span>工作边界</span>
        {task.boundary}
      </div>
      {task.brief && (
        <div className="task-brief">
          <b>本切片交付</b>
          {task.brief.deliverables.map((item) => (
            <p key={item}>{item}</p>
          ))}
          <small>负责：{task.brief.ownedPaths.join("、")}</small>
          <small>禁改：{task.brief.excludedPaths.join("、")}</small>
        </div>
      )}
      {!!edges.length && (
        <div className="task-dependencies">
          <b>上游交接</b>
          {edges.map((edge) => {
            const upstream = data.tasks.find(
              (item) => item.id === edge.upstreamTaskId,
            );
            const contract = data.contracts.find(
              (item) => item.id === edge.contractId,
            );
            return (
              <div key={edge.upstreamTaskId}>
                <strong>
                  {edge.mode === "HARD"
                    ? "硬等待"
                    : contract?.status === "PUBLISHED"
                      ? "契约并行"
                      : "契约待确认"}
                </strong>
                <span>
                  {upstream?.title ?? edge.upstreamTaskId} · {edge.reason}
                </span>
                {contract && (
                  <small>
                    {contract.signature} · {contract.handoff}
                  </small>
                )}
              </div>
            );
          })}
        </div>
      )}
      <ul className="acceptance">
        {task.acceptance.map((item) => (
          <li key={item}>
            <Check size={12} />
            {item}
          </li>
        ))}
      </ul>
      <div className="task-times">
        <span>发布 {time(task.publishedAt)}</span>
        {task.startedAt && <span>开工 {time(task.startedAt)}</span>}
        {task.finishedAt && <span>执行结束 {time(task.finishedAt)}</span>}
        {task.doneAt && <span>确认 {time(task.doneAt)}</span>}
      </div>
      <div className="task-foot">
        <span>{owner?.label ?? short(task.assigneeNodeId)}</span>
        <span>r{task.revision}</span>
        {task.lastGit && <code>{short(task.lastGit.headSha)}</code>}
      </div>
      {(mine || data.viewer.role === "captain") && (
        <div className="button-row">
          <button onClick={() => download(task)}>
            <ArrowDownToLine size={13} />
            下载
          </button>
          {mine && (
            <FileButton
              label="上传细化 MD"
              disabled={
                !writable ||
                ![
                  "PUBLISHED",
                  "REFINING",
                  "READY",
                  "FAILED",
                  "PAUSED",
                ].includes(task.status)
              }
              onFile={(filename, content) =>
                run(
                  () => api.uploadTask(task.id, filename, content),
                  `${filename} 已上传`,
                )
              }
            />
          )}
          {canStart && (
            <button
              className="primary"
              disabled={!writable}
              onClick={() =>
                run(() => api.taskStart(task.id), "开工命令已发送到本机 Codex")
              }
            >
              <Play size={13} />
              开工
            </button>
          )}
          {mine &&
            ["STARTING", "IN_PROGRESS", "WAITING_CONFIRMATION"].includes(
              task.status,
            ) && (
              <button
                disabled={!writable}
                onClick={() =>
                  run(() => api.taskSync(task.id), "已请求立即同步")
                }
              >
                <RefreshCw size={13} />
                同步
              </button>
            )}
          {mine && task.status === "WAITING_INTEGRATION" && (
            <button
              className="primary"
              disabled={!writable}
              onClick={() =>
                run(() => api.taskIntegrate(task.id), "已请求本机真实集成验证")
              }
            >
              <GitBranch size={13} />
              验证真实集成
            </button>
          )}
          {mine && task.status === "WAITING_CONFIRMATION" && (
            <button
              className="primary"
              disabled={!writable}
              onClick={() => run(() => api.taskDone(task.id), "任务已确认完成")}
            >
              <Check size={13} />
              确认完成
            </button>
          )}
        </div>
      )}
      {mine && writable && task.brief && (
        <TaskChat
          task={task}
          onSaved={() => run(async () => undefined, "执行细化已保存")}
        />
      )}
    </article>
  );
}

function SignalStrip({
  data,
  taskCount,
}: {
  data: V20BootstrapPayload;
  taskCount: number;
}) {
  const items = [
    `ROOM ${short(data.room.id, 12)}`,
    `REQUIREMENT R${data.room.requirementRevision}`,
    `${data.nodes.filter((node) => node.connected).length} NODES ONLINE`,
    `${taskCount} TASKS IN CURRENT STAGE`,
    `${data.pullRequests.filter((item) => item.status === "QUEUED").length} CHANGES QUEUED`,
  ];
  return (
    <div className="signal-strip" aria-label="协作状态摘要">
      <div className="signal-track">
        {[...items, ...items].map((item, index) => (
          <span key={`${item}-${index}`}>
            <i />
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
