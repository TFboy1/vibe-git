import { useEffect, useState } from "react";
import {
  Sparkles,
  CheckCircle2,
  ArrowRight,
  Terminal,
  Copy,
  Check,
  Lightbulb,
  Compass,
  ShieldCheck,
  UserCheck,
  FileCode,
  Globe,
  Zap,
  Info,
  Layers,
  CircleDashed,
  RotateCw,
  Users,
  AlertCircle,
  Bot
} from "lucide-react";
import type { InterfaceContract, V20BootstrapPayload } from "@vibe-git/protocol";
import { api, localCodexModels } from "../api";
import { Markdown } from "../Markdown";
import { ProposalComposer } from "../WorkspacePanels";
import { bridge, type CodexInfo } from "./localApi";
import { liveTasks, type InspectorTarget } from "./model";
import { RecoveryHint } from "./RecoveryHint";

type Props = {
  data: V20BootstrapPayload;
  compact?: boolean;
  local: boolean;
  open(target: InspectorTarget): void;
  refresh(): Promise<void>;
};

type Readiness = Awaited<ReturnType<typeof api.alignmentReadiness>>;

const seenTip = (key: string) => {
  try {
    return localStorage.getItem(`vibe-git-tip:${key}`) === "1";
  } catch {
    return false;
  }
};

const markTip = (key: string) => {
  try {
    localStorage.setItem(`vibe-git-tip:${key}`, "1");
  } catch {
    /* 向导仍可继续 */
  }
};

const CAPTAIN_TEMPLATES = [
  {
    icon: "🚀",
    title: "现代全栈应用",
    prompt: "构建现代化全栈协作系统：前端采用 React/Next.js 并提供可视化看板与仪表盘，后端使用 Node.js 提供高性能 API，支持实时 WebSocket 协作与状态同步。",
  },
  {
    icon: "⚡",
    title: "微服务重构与性能治理",
    prompt: "重构单体系统为高可用分布式架构：拆分核心业务模块，设计 Redis 缓存与幂等保障，优化端到端吞吐量并添加分布式链路追踪。",
  },
  {
    icon: "🛡️",
    title: "前后端契约规范与治理",
    prompt: "建立自动化接口契约规范与自动化测试套件：明确各服务边界与 TypeScript 强类型定义，实现 Mock 联调与自动化回归测试。",
  },
  {
    icon: "📦",
    title: "CLI 工具链与端到端交付",
    prompt: "研发开发者专属的自动化 CLI 协作工具链：集成自动化部署、Git 分支对齐与环境自检功能，提升多端团队研发效能。",
  },
];

const MEMBER_TEMPLATES = [
  {
    icon: "✨",
    title: "认领前端界面与交互",
    prompt: "负责前端交互层开发：实现高交互仪表盘、响应式布局与暗黑科技风设计系统，严格对齐接口契约并完成联调。",
  },
  {
    icon: "⚙️",
    title: "认领核心后端与数据服务",
    prompt: "负责后端核心业务与数据层：实现稳定可靠的数据持久化、业务校验与对外 API，编写完整单元测试保障代码质量。",
  },
  {
    icon: "🧪",
    title: "认领接口契约与集成测试",
    prompt: "负责端到端质量保障：根据发布的接口契约编写全覆盖的集成测试与异常模拟用例，验证团队交接顺畅度。",
  },
];

export function JourneyPanel({ data, compact = false, local, open, refresh }: Props) {
  const captain = data.viewer.role === "captain";
  const ownPlan = data.plans.find(plan => plan.ownerNodeId === data.viewer.id);
  const members = data.nodes.filter(node => node.role === "member" && !node.revoked);
  const missing = members.filter(node => !data.plans.some(plan => plan.ownerNodeId === node.id));
  const alignment = data.alignments.at(-1);
  const ownTasks = liveTasks(data).filter(task => task.assigneeNodeId === data.viewer.id);
  const nextTask =
    ownTasks.find(task => ["PUBLISHED", "READY", "FAILED", "PAUSED", "BLOCKED"].includes(task.status)) ??
    ownTasks.find(task => task.status !== "DONE");
  const read =
    alignment &&
    data.alignmentReads.some(
      item =>
        item.alignmentId === alignment.id &&
        item.nodeId === data.viewer.id &&
        item.revision === (alignment.draftRevision ?? 0)
    );

  const [composer, setComposer] = useState(false);
  const [composerIdea, setComposerIdea] = useState<string | undefined>(undefined);
  const [captainIdeaInput, setCaptainIdeaInput] = useState("");
  const [invite, setInvite] = useState<Awaited<ReturnType<typeof api.invite>> | null>(null);
  const [copied, setCopied] = useState(false);
  const [codex, setCodex] = useState<CodexInfo | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [showPlan, setShowPlan] = useState(false);
  const [confirmConnect, setConfirmConnect] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tip, setTip] = useState(() => !seenTip("alignment"));

  const [selectedModel, setSelectedModel] = useState<string>(() => {
    try {
      return localStorage.getItem("vibe-git:codex-model") || "default";
    } catch {
      return "default";
    }
  });
  const [modelOptions, setModelOptions] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    if (local) {
      localCodexModels()
        .then(models => {
          if (Array.isArray(models) && models.length > 0) {
            setModelOptions(models);
            setSelectedModel(current => models.some(option => option.id === current) ? current : "default");
          }
        })
        .catch(() => {});
    }
  }, [local]);

  useEffect(() => {
    if (!captain && local) {
      void bridge<CodexInfo>("/api/local/codex").then(setCodex).catch(() => {});
    }
  }, [captain, local]);

  useEffect(() => {
    setShowPlan(false);
  }, [alignment?.id, alignment?.draftRevision]);

  const work = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const beginAlignment = () =>
    void work(async () => {
      const status = await api.alignmentReadiness();
      if (status.missing.length) {
        setReadiness(status);
        return;
      }
      await api.startAlignment([], status.requirementRevision);
      markTip("alignment");
      setTip(false);
      await refresh();
    });

  const skipMissing = () =>
    void work(async () => {
      if (!readiness) return;
      await api.startAlignment(readiness.missing.map(item => item.nodeId), readiness.requirementRevision);
      setReadiness(null);
      markTip("alignment");
      setTip(false);
      await refresh();
    });

  const connect = () =>
    void work(async () => {
      setCodex(await bridge<CodexInfo>("/api/local/codex/connect", {}));
      await refresh();
    });

  const inviteTeam = () =>
    void work(async () => {
      setInvite(await api.invite());
    });

  const copyInviteCommand = (cmd: string) => {
    void navigator.clipboard.writeText(cmd);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2200);
  };

  const receipt = () =>
    void work(async () => {
      if (!alignment) return;
      await api.readAlignment(alignment.id, alignment.draftRevision ?? 0);
      await refresh();
    });

  let title = "";
  let detail = "";
  let action = "";
  let execute = () => {};

  if (captain) {
    if (!ownPlan) {
      title = "描述项目核心设想";
      detail = "阐明项目目标或关键功能，Codex 将分析工作区并起草队长个人提案，供团队对齐使用。";
      action = "生成并编辑我的提案";
      execute = () => {
        setComposerIdea(captainIdeaInput);
        setComposer(true);
      };
    } else if (!members.length) {
      title = "邀请团队成员加入";
      detail = "将终端加入命令发送给队友；他们在本机工作区运行后将实时出现在协同房间。";
      action = "获取团队邀请命令";
      execute = inviteTeam;
    } else if (alignment && ["QUEUED", "RUNNING"].includes(alignment.status)) {
      title = "等待 AI 完成需求对齐";
      detail = "已冻结本轮提案快照，Codex 正在提取架构分歧并自动生成任务与接口契约草稿。";
      action = "查看对齐进度";
      execute = () => open({ type: "project", id: "project", tab: "alignment" });
    } else if (alignment?.status === "NEEDS_DECISION") {
      title = "处理需求架构分歧";
      detail = `${alignment.issues?.filter(issue => !issue.selectedOptionId).length ?? 0} 项技术与需求分歧等待队长裁决。`;
      action = "查看分歧与事实依据";
      execute = () => open({ type: "project", id: "project", tab: "decisions" });
    } else if (alignment?.status === "READY" && !alignment.publishedStageId) {
      title = "检查任务分工并发布";
      detail = "AI 已生成任务边界与接口契约草案。核对各成员负责人与交接确认后即可全员发布。";
      action = "检查任务分工与契约";
      execute = () => open({ type: "project", id: "project", tab: "publish" });
    } else if (data.stages.length) {
      const pendingReview = data.reviews.find(item => item.status === "AWAITING_CAPTAIN");
      const blocked = liveTasks(data).find(item => ["BLOCKED", "PAUSED", "FAILED"].includes(item.status));
      const pendingChange = data.pullRequests.find(item => item.status === "QUEUED");
      if (pendingReview) {
        title = "确认需求变更审核";
        detail = `${pendingReview.affectedTaskIds.length} 项任务已确认受到影响，等待你裁定审核结论。`;
        action = "查看审核结论";
        execute = () => open({ type: "project", id: "project", tab: "review" });
      } else if (blocked) {
        title = "处理团队阻塞事项";
        detail = `${blocked.title} · ${blocked.blockedReason ?? "需要检查任务状态与接口契约"}`;
        action = "查看阻塞任务详情";
        execute = () => open({ type: "task", id: blocked.id });
      } else if (pendingChange) {
        title = "查看待审需求提议";
        detail = "团队成员提交了新提议；先查看关联正文与版本上下文，再决定何时推进审核。";
        action = "查看待审变更";
        execute = () => open({ type: "change", id: pendingChange.id });
      } else {
        title = "推进团队协同流水线";
        detail = "在拓扑画布与甘特视图中查看成员交接、当前工期以及待处理的协作状态。";
        action = "进入项目全景状态";
        execute = () => open({ type: "project", id: "project" });
      }
    } else if (missing.length) {
      title = "等待队友提交方案";
      detail = `${missing.map(node => node.label).join("、")} 尚未提交方案。对齐流程默认等待所有成员完备。`;
      action = "查看缺席影响并开始对齐";
      execute = beginAlignment;
    } else if (!data.stages.length || alignment?.status === "FAILED") {
      title = "开启全员需求对齐";
      detail = "Codex 将深度分析全员提案，提取真实技术分歧并生成初始接口契约草案。";
      action = "立即开始需求对齐";
      execute = beginAlignment;
    } else {
      title = "处理团队下一步规划";
      detail = "通过人员拓扑与交接关系追踪阻塞、变更和交付进度。";
      action = "查看项目状态";
      execute = () => open({ type: "project", id: "project" });
    }
  } else if (!local) {
    title = "连接本机工作环境";
    detail = "在你的 Git 本地工作区运行 vibe-git open，网页端即可与本机 Codex 建立安全会话。";
    action = "查看我的连接状态";
    execute = () => open({ type: "member", id: data.viewer.id });
  } else if ((codex?.status ?? data.viewer.codex) !== "available") {
    title = "连接本机 Codex 引擎";
    detail = codex?.reason ?? "请确保本机已安装并登录 Codex，以开启只读代码分析与方案自动起草。";
    action = "连接本机 Codex";
    execute = () => setConfirmConnect(true);
  } else if (!ownPlan && !data.stages.length) {
    title = "提交我的个人技术方案";
    detail = "允许 Codex 只读分析本地工作区，检查并修改个人方案草稿后提交至房间。";
    action = "生成并编辑方案";
    execute = () => {
      setComposerIdea(captainIdeaInput);
      setComposer(true);
    };
  } else if (alignment && ["READY", "PUBLISHED"].includes(alignment.status) && !read) {
    title = "查阅统一计划与契约";
    detail = `队长发布前后的草稿修订会分别记录已读回执；当前版本为第 ${alignment.draftRevision ?? 0} 版。`;
    action = showPlan ? "确认已阅读当前版本" : "阅读统一计划正文";
    execute = showPlan ? receipt : () => setShowPlan(true);
  } else if (nextTask) {
    title = nextTask.status === "PAUSED" ? "处理已暂停的任务" : "认领并开始执行任务";
    detail = `${nextTask.title} · ${
      nextTask.status === "PAUSED" ? "等待新需求或接口契约确认" : "打开任务摘要，检查上下文并在本地开工"
    }`;
    action = "查看任务并开工";
    execute = () => open({ type: "task", id: nextTask.id });
  } else if (!ownPlan) {
    title = "补充我的技术提案";
    detail = "新加入成员可提交专属提案，供团队下一轮需求对齐与契约修订参考。";
    action = "生成个人方案";
    execute = () => {
      setComposerIdea(captainIdeaInput);
      setComposer(true);
    };
  } else {
    title = "等待团队分工发布";
    detail = "队长正在对齐团队提案或起草任务；有新版本发布时将即时提示你查阅。";
    action = "查看统一计划进度";
    execute = () => open({ type: "project", id: "project", tab: "alignment" });
  }

  const steps = captain
    ? [
        { name: "描述设想", desc: "起草队长提案" },
        { name: "邀请协作", desc: "收集全员方案" },
        { name: "分歧裁决", desc: "AI分析冲突" },
        { name: "检查契约", desc: "确认任务分工" },
        { name: "发布推进", desc: "全员开工协同" },
      ]
    : [
        { name: "连接 Codex", desc: "绑定工作环境" },
        { name: "提交方案", desc: "贡献个人草案" },
        { name: "统一计划", desc: "签署已读回执" },
        { name: "认领任务", desc: "本地执行开工" },
        { name: "交付与交接", desc: "闭环流水线" },
      ];

  const highlighted = captain
    ? !ownPlan
      ? 0
      : !members.length || missing.length
      ? 1
      : alignment?.status === "NEEDS_DECISION"
      ? 2
      : alignment?.status === "READY"
      ? 3
      : 4
    : !local || (codex?.status ?? data.viewer.codex) !== "available"
    ? 0
    : !ownPlan && !data.stages.length
    ? 1
    : !read
    ? 2
    : nextTask
    ? 3
    : 4;

  const templates = captain ? CAPTAIN_TEMPLATES : MEMBER_TEMPLATES;
  const onlineCount = data.nodes.filter(n => n.connected).length;

  if (compact) {
    return (
      <section className="journey compact" aria-label={captain ? "带队向导" : "我的向导"}>
        <div className="journey-compact-header">
          <div className="journey-compact-badges">
            <span className="journey-badge-micro">
              {captain ? <ShieldCheck size={12} /> : <UserCheck size={12} />}
              {captain ? "队长" : "成员"}
            </span>
            <span className="journey-step-count">
              {highlighted + 1}/{steps.length}
            </span>
          </div>
          <div className="journey-compact-dots">
            {steps.map((s, idx) => (
              <span
                key={s.name}
                title={`${idx + 1}. ${s.name}`}
                className={`compact-dot ${idx === highlighted ? "current" : idx < highlighted ? "complete" : ""}`}
              />
            ))}
          </div>
        </div>
        <div className="journey-heading">
          <h1>{title}</h1>
          <p>{detail}</p>
        </div>
        <button className="journey-primary compact-btn" disabled={busy} onClick={execute}>
          {busy ? <CircleDashed className="animate-spin" size={14} /> : <Sparkles size={14} />}
          <span>{busy ? "处理中…" : action}</span>
          <ArrowRight size={13} />
        </button>
        {invite && (
          <div className="journey-invite-compact">
            <code>{invite.command}</code>
            <button onClick={() => copyInviteCommand(invite.command)}>
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "已复制" : "复制"}
            </button>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="journey full" aria-label={captain ? "带队向导" : "我的工作向导"}>
      {/* 顶部微光氛围装饰 */}
      <div className="journey-glow-aura" aria-hidden="true" />

      {/* Hero 头部 */}
      <header className="journey-hero">
        <div className="journey-badge-row">
          <div className={`journey-role-badge ${captain ? "captain" : "member"}`}>
            <span className="journey-pulse-dot" />
            {captain ? <ShieldCheck size={13} /> : <UserCheck size={13} />}
            <span>{captain ? "队长主导视角 · 全周期协同推进" : "协作成员视角 · 分工协同与交接"}</span>
          </div>
          <div className="journey-status-pill">
            <Users size={12} />
            <span>{onlineCount} 人在线</span>
          </div>
          <div className="journey-stage-pill">
            <Compass size={12} />
            <span>第 {highlighted + 1} 阶段 · {steps[highlighted]?.name}</span>
          </div>
        </div>

        <div className="journey-heading">
          <h1>{title}</h1>
          <p>{detail}</p>
        </div>
      </header>

      {/* 连通式时间轴步进器 */}
      <nav className="journey-stepper-wrap" aria-label="项目推进阶段">
        <ol className="journey-stepper-track">
          {steps.map((step, index) => {
            const isCurrent = index === highlighted;
            const isComplete = index < highlighted;
            return (
              <li
                key={step.name}
                className={`journey-stepper-item ${isCurrent ? "current" : ""} ${isComplete ? "complete" : ""}`}
              >
                <div className="journey-stepper-node">
                  <span className="journey-stepper-num">
                    {isComplete ? (
                      <CheckCircle2 size={15} />
                    ) : isCurrent ? (
                      <span className="stepper-ping-wrap">
                        <span className="stepper-ping" />
                        <span className="stepper-dot" />
                      </span>
                    ) : (
                      <span>{index + 1}</span>
                    )}
                  </span>
                  {index < steps.length - 1 && (
                    <div className={`journey-stepper-line ${isComplete ? "complete" : isCurrent ? "active" : ""}`} />
                  )}
                </div>
                <div className="journey-stepper-info">
                  <span className="journey-stepper-name">{step.name}</span>
                  <span className="journey-stepper-desc">{step.desc}</span>
                </div>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* 核心卡片区域 */}
      {!ownPlan ? (
        <div className="journey-glass-card idea-card">
          <div className="journey-card-header">
            <div className="journey-sparkle-avatar">
              <Sparkles size={18} />
            </div>
            <div className="journey-card-titles">
              <div className="journey-card-tag-row">
                <span className="journey-ai-tag">
                  <Zap size={11} /> AI 提案生成引擎
                </span>
                {modelOptions.length > 0 && (
                  <div className="journey-model-badge">
                    <Bot size={12} />
                    <span>模型:</span>
                    <select
                      value={modelOptions.some(option => option.id === selectedModel) ? selectedModel : "default"}
                      onChange={e => {
                        const val = e.target.value;
                        setSelectedModel(val);
                        try {
                          localStorage.setItem("vibe-git:codex-model", val);
                        } catch {}
                      }}
                      className="journey-model-select"
                      title="选择用于起草提案的 Codex 模型"
                    >
                      {modelOptions.map(opt => (
                        <option key={opt.id} value={opt.id}>
                          {opt.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <span className="journey-tag-sub">支持自由选用灵感或切换模型</span>
              </div>
              <h2>{captain ? "输入项目核心设想与目标" : "输入我的方案设想与认领范围"}</h2>
            </div>
          </div>

          {/* 快捷灵感模板 Chips */}
          <div className="journey-presets">
            <span className="journey-presets-title">
              <Lightbulb size={13} /> 快捷灵感参考：
            </span>
            <div className="journey-chips-list">
              {templates.map(tpl => (
                <button
                  key={tpl.title}
                  type="button"
                  className="journey-chip"
                  onClick={() => setCaptainIdeaInput(tpl.prompt)}
                  title="点击将设想模版载入输入框"
                >
                  <span className="chip-icon">{tpl.icon}</span>
                  <span className="chip-text">{tpl.title}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 输入框 */}
          <div className="journey-textarea-wrap">
            <textarea
              value={captainIdeaInput}
              onChange={e => setCaptainIdeaInput(e.target.value)}
              rows={4}
              placeholder={
                captain
                  ? "简要描述项目核心目标、技术栈或关键功能规划（例如：构建高并发微服务系统，采用 Redis 缓存与分布式追踪...），Codex 将分析工作区并起草方案。"
                  : "描述你期望负责的模块设想或技术实现方案，提交后将纳入团队需求对齐..."
              }
              className="journey-textarea"
            />
          </div>

          {/* 操作按钮组 */}
          <div className="journey-actions-row">
            <button
              className="journey-btn-magic"
              disabled={busy}
              onClick={() => {
                setComposerIdea(captainIdeaInput);
                setComposer(true);
              }}
            >
              {busy ? <CircleDashed className="animate-spin" size={16} /> : <Sparkles size={16} />}
              <span>{busy ? "正在解析…" : captain ? "生成并编辑团队提案" : "生成并编辑个人方案"}</span>
              <ArrowRight size={15} />
            </button>
            <button
              type="button"
              className="journey-btn-secondary"
              disabled={busy}
              onClick={() => {
                setComposerIdea(undefined);
                setComposer(true);
              }}
            >
              <FileCode size={15} />
              <span>打开内置 Markdown 编辑器</span>
            </button>
          </div>
        </div>
      ) : (
        /* 已有提案时的行动待办卡片 */
        <div className="journey-action-mission-card">
          <div className="journey-mission-glow" aria-hidden="true" />
          <div className="journey-mission-content">
            <div className="journey-mission-tag">
              <Compass size={13} /> 当前核心行动推荐
            </div>
            <h2>{title}</h2>
            <p>{detail}</p>
          </div>
          <div className="journey-mission-cta">
            <button className="journey-btn-cta" disabled={busy} onClick={execute}>
              {busy ? <CircleDashed className="animate-spin" size={17} /> : <Sparkles size={17} />}
              <span>{busy ? "处理中…" : action}</span>
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* 提示与重要提醒 */}
      {tip && captain && (action === "开始需求对齐" || action === "查看缺席影响并对齐") && (
        <div className="journey-alert-banner">
          <div className="journey-alert-icon">
            <Info size={16} />
          </div>
          <div className="journey-alert-text">
            <strong>首次需求对齐提示：</strong>
            <span>首次对齐将冻结当前提案版本快照，并由本机 Codex 深度提取全员分歧与任务草稿。</span>
          </div>
          <button
            type="button"
            className="journey-alert-dismiss"
            onClick={() => {
              markTip("alignment");
              setTip(false);
            }}
          >
            我知道了
          </button>
        </div>
      )}

      {/* 团队邀请仿真终端卡片 */}
      {invite && (
        <div className="journey-terminal-box">
          <div className="journey-terminal-header">
            <div className="terminal-dots">
              <span className="dot dot-red" />
              <span className="dot dot-yellow" />
              <span className="dot dot-green" />
            </div>
            <span className="terminal-title">
              <Terminal size={13} /> 队友加入终端命令 (Terminal)
            </span>
            <button
              type="button"
              className={`terminal-copy-btn ${copied ? "copied" : ""}`}
              onClick={() => copyInviteCommand(invite.command)}
            >
              {copied ? (
                <>
                  <Check size={13} /> 已复制命令
                </>
              ) : (
                <>
                  <Copy size={13} /> 复制加入命令
                </>
              )}
            </button>
          </div>
          <div className="journey-terminal-code">
            <code>{invite.command}</code>
          </div>
          <div className="journey-terminal-footer">
            <div className="tunnel-status-indicator">
              <span className={`tunnel-dot ${data.tunnel?.running ? "online" : "offline"}`} />
              <Globe size={13} />
              <span>
                {data.tunnel?.running
                  ? "Cloudflare Tunnel 远程隧道服务已就绪（支持互联网任意位置加入）"
                  : "Cloudflare Tunnel 未运行（局域网/本机可直接连通；若需公网协同请在顶部邀请设置开启 Tunnel）"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 离线成员提示 */}
      {captain && missing.some(node => !node.connected) && (
        <div className="journey-alert-banner warning">
          <div className="journey-alert-icon warning">
            <AlertCircle size={16} />
          </div>
          <div className="journey-alert-text">
            <strong>有协同成员尚未连接：</strong>
            <span>请让队友在其本地工作区终端运行 <code>vibe-git open</code> 并提交方案。如确实缺席可点击上方对齐按钮查看影响后显式跳过。</span>
          </div>
        </div>
      )}

      {/* 统一计划阅读抽屉 */}
      {alignment && showPlan && !captain && ["READY", "PUBLISHED"].includes(alignment.status) && (
        <div className="journey-plan-container">
          <div className="journey-plan-header">
            <Layers size={16} />
            <strong>统一计划正文 · 草稿第 {alignment.draftRevision ?? 0} 版</strong>
          </div>
          <div className="journey-plan-markdown">
            <Markdown>{alignment.alignmentMarkdown ?? ""}</Markdown>
          </div>
        </div>
      )}

      {/* 错误恢复提示 */}
      {error && <RecoveryHint error={error} />}

      {/* 弹窗：跳过缺席成员 */}
      {readiness && (
        <div className="impact-backdrop" role="dialog" aria-modal="true" aria-label="跳过缺席成员的影响">
          <section className="impact-dialog">
            <h2>确认跳过缺席成员并开始对齐？</h2>
            <p>
              本轮将不纳入以下成员的方案，也不会为其指派本轮任务；缺席成员之后提交的方案将放入下一轮对齐。当前需求版本 R
              {readiness.requirementRevision}。
            </p>
            <ul>
              {readiness.missing.map(item => (
                <li key={item.nodeId}>
                  <strong>{item.label}</strong> · {item.connected ? "在线但未提交方案" : "离线且未提交"}
                </li>
              ))}
            </ul>
            <div>
              <button onClick={() => setReadiness(null)}>继续等待成员</button>
              <button className="danger" disabled={busy} onClick={skipMissing}>
                确认跳过并开启对齐
              </button>
            </div>
          </section>
        </div>
      )}

      {/* 弹窗：连接本机 Codex */}
      {confirmConnect && (
        <div className="impact-backdrop" role="dialog" aria-modal="true" aria-label="确认连接本机 Codex">
          <section className="impact-dialog">
            <h2>连接本机 Codex 协同引擎？</h2>
            <p>
              将拉起本机 Codex 的环境检测与连接流程；若未安装，请先完成安装并登录。此操作仅在当前电脑执行，保护代码私密性。
            </p>
            <div>
              <button onClick={() => setConfirmConnect(false)}>取消</button>
              <button
                className="journey-btn-magic"
                onClick={() => {
                  setConfirmConnect(false);
                  connect();
                }}
              >
                确认连接本机 Codex
              </button>
            </div>
          </section>
        </div>
      )}

      {/* 提案编辑弹窗 */}
      {composer && (
        <ProposalComposer
          data={data}
          current={ownPlan}
          initialIdea={composerIdea}
          onClose={() => setComposer(false)}
          onSaved={refresh}
        />
      )}
    </section>
  );
}

export function AdvancedWorkspace({ data, open, refresh }: Omit<Props, "compact" | "local">) {
  const [editing, setEditing] = useState<InterfaceContract | null>(null);
  const [form, setForm] = useState<Pick<
    InterfaceContract,
    "name" | "signature" | "behavior" | "examples" | "errors" | "testCommand" | "handoff"
  > | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const alignment = data.alignments.at(-1);
  const tasks = liveTasks(data);

  const change = (contract: InterfaceContract) => {
    setEditing(contract);
    setForm({
      name: contract.name,
      signature: contract.signature,
      behavior: contract.behavior,
      examples: contract.examples,
      errors: contract.errors,
      testCommand: contract.testCommand,
      handoff: contract.handoff,
    });
  };

  const save = async () => {
    if (!editing || !form) return;
    setBusy(true);
    setError("");
    try {
      await api.reviseDraftContract(editing, form);
      setEditing(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="advanced-workspace">
      <header>
        <small>高级模式</small>
        <h1>完整任务看板与依赖</h1>
        <p>查看所有任务、真实交接和接口契约草稿。契约修订会清除旧确认并重新细化相关工作。</p>
      </header>
      <div className="advanced-grid">
        <section>
          <h2>任务看板</h2>
          {tasks.length ? (
            tasks.map(task => (
              <button className="advanced-task" key={task.id} onClick={() => open({ type: "task", id: task.id })}>
                <strong>{task.title}</strong>
                <span>
                  {data.nodes.find(node => node.id === task.assigneeNodeId)?.label} · {task.status}
                </span>
                <small>
                  {(task.dependencyEdges ?? [])
                    .map(
                      edge =>
                        `${edge.mode === "HARD" ? "硬等待" : "契约交接"} ${
                          tasks.find(t => t.id === edge.upstreamTaskId)?.title ?? edge.upstreamTaskId
                        }`
                    )
                    .join("；") || "无上游依赖"}
                </small>
              </button>
            ))
          ) : alignment?.tasks.length ? (
            alignment.tasks.map(task => (
              <button
                className="advanced-task"
                key={task.id}
                onClick={() => open({ type: "project", id: "project", tab: "publish" })}
              >
                <strong>{task.title}</strong>
                <span>{data.nodes.find(node => node.id === task.assigneeNodeId)?.label} · 待发布草稿</span>
                <small>
                  {(task.dependencyEdges ?? [])
                    .map(
                      edge =>
                        `${edge.mode === "HARD" ? "硬等待" : "契约交接"} ${
                          alignment.tasks.find(item => item.id === edge.upstreamTaskId)?.title ?? edge.upstreamTaskId
                        }`
                    )
                    .join("；") || "无上游依赖"}
                </small>
              </button>
            ))
          ) : (
            <p>尚无任务。队长完成需求对齐后可从向导检查并发布。</p>
          )}
        </section>
        <section>
          <h2>协作契约</h2>
          {data.contracts
            .filter(item => item.alignmentId === alignment?.id)
            .map(contract => (
              <article className="advanced-contract" key={contract.id}>
                <strong>
                  {contract.name} · r{contract.revision}
                </strong>
                <p>{contract.signature}</p>
                <small>
                  {contract.status} · {contract.acknowledgedNodeIds.length} 人已确认
                </small>
                {data.viewer.role === "captain" && !contract.stageId && alignment?.status === "READY" && (
                  <button onClick={() => change(contract)}>编辑草稿</button>
                )}
              </article>
            ))}
          {!data.contracts.length && <p>对齐后会生成接口契约草稿。</p>}
        </section>
      </div>
      {alignment && (
        <details className="advanced-versions">
          <summary>
            对齐草稿版本与已读记录 · 第 {alignment.draftRevision ?? 0} 版
          </summary>
          {data.alignmentDraftVersions
            .filter(item => item.alignmentId === alignment.id)
            .map(version => (
              <article key={version.revision}>
                <strong>草稿 r{version.revision}</strong>
                <span>
                  {new Date(version.createdAt).toLocaleString("zh-CN")} ·{" "}
                  {data.nodes.find(node => node.id === version.editorNodeId)?.label ?? "Agent"}
                </span>
                <small>{version.tasks.map(task => task.title).join("、")}</small>
              </article>
            ))}
          <p>
            本版已阅读：
            {data.alignmentReads
              .filter(item => item.alignmentId === alignment.id && item.revision === (alignment.draftRevision ?? 0))
              .map(item => data.nodes.find(node => node.id === item.nodeId)?.label ?? item.nodeId)
              .join("、") || "暂无"}
          </p>
        </details>
      )}
      {editing && form && (
        <div className="impact-backdrop" role="dialog" aria-modal="true" aria-label="编辑契约草稿">
          <section className="impact-dialog contract-editor">
            <h2>编辑 {editing.name}</h2>
            <p>保存后版本升级，旧确认失效，相关工作主线重新细化。</p>
            {(["name", "signature", "testCommand", "handoff"] as const).map(key => (
              <label key={key}>
                {key}
                <input
                  value={form[key]}
                  onChange={event => setForm({ ...form, [key]: event.target.value })}
                />
              </label>
            ))}
            {(["behavior", "examples", "errors"] as const).map(key => (
              <label key={key}>
                {key}
                <textarea
                  value={form[key].join("\n")}
                  onChange={event =>
                    setForm({
                      ...form,
                      [key]: event.target.value.split("\n").filter(Boolean),
                    })
                  }
                />
              </label>
            ))}
            {error && <RecoveryHint error={error} />}
            <div>
              <button onClick={() => setEditing(null)}>取消</button>
              <button className="journey-primary" disabled={busy} onClick={() => void save()}>
                保存新版本
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
