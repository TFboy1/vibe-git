import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { Bell, FolderGit2, FolderOpen, Network, UserPlus } from "lucide-react";
import type { V20BootstrapPayload } from "@vibe-git/protocol";
import { api, localCodexModels } from "../api";
import { Avatar } from "./TopologyCanvas";
import { codexState, type CanvasMode, type CanvasSurface, type InspectorTarget } from "./model";
import { bridge, type WorkspaceInfo, type CodexInfo } from "./localApi";
import { RecoveryHint } from "./RecoveryHint";

const folderNameFromPath = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;

export function TopCommandBar({
  data,
  mode,
  setMode,
  surface,
  setSurface,
  open,
  sync,
  local,
  refresh,
  unread,
  activity,
}: {
  data: V20BootstrapPayload;
  mode: CanvasMode;
  setMode: (m: CanvasMode) => void;
  surface: CanvasSurface;
  setSurface: (surface: CanvasSurface) => void;
  open: (t: InspectorTarget) => void;
  sync: string;
  local: boolean;
  refresh: () => Promise<void>;
  unread: number;
  activity: () => void;
}) {
  const [panel, setPanel] = useState("");
  const [error, setError] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [codex, setCodex] = useState<CodexInfo | null>(null);
  const [openai, setOpenAI] = useState<{ configured: boolean; source: string; model: string } | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [apiModel, setApiModel] = useState("gpt-5");
  const [showApiSettings, setShowApiSettings] = useState(false);
  const [modelError, setModelError] = useState("");
  const [invite, setInvite] = useState<{
    command: string;
    joinUrl: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [localAction, setLocalAction] = useState<"codex" | "rotate" | "install" | "start" | "stop" | null>(null);
  const [pendingProject, setPendingProject] = useState<{ path: string; name: string } | null>(null);
  const [projectError, setProjectError] = useState("");
  const [savingProject, setSavingProject] = useState(false);
  const [pickingFolder, setPickingFolder] = useState(false);
  const pickerAbort = useRef<AbortController | null>(null);
  const [confirmGitInit, setConfirmGitInit] = useState(false);
  const [initializingGit, setInitializingGit] = useState(false);
  const [gitInitError, setGitInitError] = useState("");
  const work = async (fn: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (p: string) => {
    if (p === "workspace" && panel === p) pickerAbort.current?.abort();
    setPanel(panel === p ? "" : p);
    setError("");
    if ((p === "workspace" || p === "project") && local)
      void work(async () => setWorkspace(await bridge("/api/local/workspace")));
    if (p === "codex" && local) {
      void work(async () => {
        const [codexStatus, apiStatus] = await Promise.all([bridge<CodexInfo>("/api/local/codex"), bridge<{ configured: boolean; source: string; model: string }>("/api/local/openai")]);
        setCodex(codexStatus); setOpenAI(apiStatus); setApiModel(apiStatus.model);
      });
      void localCodexModels().then(models => {
        setModelOptions(models);
        setModelError("");
        let stored = "default"; try { stored = localStorage.getItem("vibe-git:codex-model") || "default"; } catch { /* private storage */ }
        const selected = models.some(model => model.id === stored) ? stored : "default";
        setSelectedModel(selected);
        if (selected !== stored) try { localStorage.setItem("vibe-git:codex-model", selected); } catch { /* private storage */ }
      }).catch(error => setModelError(error instanceof Error ? error.message : "模型列表读取失败"));
    }
    if (p === "invite") void work(async () => setInvite(await api.invite()));
  };
  const confirmLocal = () => {
    const action = localAction; setLocalAction(null);
    if (!action) return;
    void work(async () => {
      if (action === "codex") { setCodex(await bridge("/api/local/codex/connect", {})); await refresh(); return; }
      const latest = await api.bootstrap();
      if (action === "rotate") { if (latest.nodes.length !== data.nodes.length) throw new Error("成员状态已变化，请重新检查邀请影响"); setInvite(await api.rotateInvite()); return; }
      if (latest.tunnel?.running !== data.tunnel?.running) throw new Error("Tunnel 状态已变化，请刷新后重试");
      if (action === "install") await api.tunnelInstall();
      if (action === "start") await api.tunnelStart();
      if (action === "stop") await api.tunnelStop();
      await refresh();
    });
  };
  useEffect(() => {
    if (codex?.status !== "connecting") return;
    const id = setInterval(
      () =>
        void bridge<CodexInfo>("/api/local/codex")
          .then(setCodex)
          .catch((e) => setError(e.message)),
      3000,
    );
    return () => clearInterval(id);
  }, [codex?.status]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        pickerAbort.current?.abort();
        setPanel("");
        if (!savingProject) setPendingProject(null);
        if (!initializingGit) setConfirmGitInit(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [savingProject, initializingGit]);

  const pickProject = () => {
    const controller = new AbortController();
    pickerAbort.current = controller;
    setPickingFolder(true);
    void work(async () => {
      try {
        const picked = await bridge<{ path: string | null }>("/api/local/workspace/pick", {}, controller.signal);
        if (!picked.path) return;
        setProjectError("");
        setPendingProject({ path: picked.path, name: folderNameFromPath(picked.path) });
        setPanel("");
      } catch (e) {
        if (!controller.signal.aborted) throw e;
      } finally {
        pickerAbort.current = null;
        setPickingFolder(false);
      }
    });
  };

  const confirmProject = async () => {
    if (!pendingProject || !pendingProject.name.trim() || savingProject) return;
    setSavingProject(true);
    setProjectError("");
    try {
      const next = await bridge<WorkspaceInfo>("/api/local/workspace/select", {
        path: pendingProject.path,
        name: pendingProject.name.trim(),
      });
      setWorkspace(next);
      setPendingProject(null);
      void refresh().catch(() => undefined);
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingProject(false);
    }
  };

  const initializeProject = async () => {
    if (!workspace?.selected || initializingGit) return;
    setInitializingGit(true);
    setGitInitError("");
    try {
      const next = await bridge<WorkspaceInfo>("/api/local/workspace/init", { path: workspace.path });
      setWorkspace(next);
      setConfirmGitInit(false);
      void refresh().catch(() => undefined);
    } catch (e) {
      setGitInitError(e instanceof Error ? e.message : String(e));
    } finally {
      setInitializingGit(false);
    }
  };
  useEffect(() => {
    if (local)
      void bridge<WorkspaceInfo>("/api/local/workspace")
        .then(setWorkspace)
        .catch(() => {});
  }, [local]);
  const [modelOptions, setModelOptions] = useState<Array<{ id: string; name: string }>>([{ id: "default", name: "Codex 默认模型" }]);
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    try {
      return localStorage.getItem("vibe-git:codex-model") || "default";
    } catch {
      return "default";
    }
  });

  useEffect(() => {
    if (local) {
      void bridge<{ configured: boolean; source: string; model: string }>("/api/local/openai").then(status => { setOpenAI(status); setApiModel(status.model); }).catch(() => undefined);
      localCodexModels()
        .then((models) => {
          if (Array.isArray(models) && models.length > 0) {
            setModelOptions(models);
            setModelError("");
            let stored = "default"; try { stored = localStorage.getItem("vibe-git:codex-model") || "default"; } catch { /* private storage */ }
            const selected = models.some(model => model.id === stored) ? stored : "default";
            setSelectedModel(selected);
            if (selected !== stored) try { localStorage.setItem("vibe-git:codex-model", selected); } catch { /* private storage */ }
          }
        })
        .catch(error => setModelError(error instanceof Error ? error.message : "模型列表读取失败"));
    }
  }, [local]);

  const member = data.viewer;
  const active = data.tasks.find(
    (t) => t.assigneeNodeId === member.id && !t.archived && (t.activeJobId || t.pauseRequested || ["IN_PROGRESS", "STARTING", "PREPARING_MOCK", "WAITING_CONFIRMATION", "WAITING_INTEGRATION", "PAUSED"].includes(t.status) || (t.executionMode === "external" && t.status === "BLOCKED")),
  );
  const codexLabel = codex
    ? {
        available: "已接入 Codex",
        connecting: "正在接入",
        login_required: "需要登录",
        unavailable: "暂不可用",
      }[codex.status]
    : codexState(member) === "available"
      ? "已接入 Codex"
      : codexState(member) === "unverified"
        ? "需要登录"
        : "暂不可用";
  return (
    <header className="command-bar">
      <button className="wb-project-trigger" onClick={() => toggle("project")} aria-expanded={panel === "project"}>
        <img src="/vibe-git-logo.png" alt="" /><span>{workspace?.name || "Vibe-Git"}</span><span aria-hidden="true">⌄</span>
      </button>
      <nav className="wb-navigation" aria-label="工作页面">
        <button aria-current={surface === "workbench" ? "page" : undefined} onClick={() => setSurface("workbench")}>工作台</button>
        <button aria-current={surface === "changes" ? "page" : undefined} onClick={() => setSurface("changes")}>变更{(data.coordination?.changes.filter(change => change.status === "PENDING").length ?? 0) > 0 && <span className="wb-nav-count">{data.coordination!.changes.filter(change => change.status === "PENDING").length}</span>}</button>
      </nav>
      <div className="wb-nav-spacer" />
      <button className="wb-pool-trigger" onClick={() => toggle("codex")} aria-expanded={panel === "codex"} aria-label="算力网设置">
        <span className={`wb-pool-dot ${data.auditPool.available || openai?.configured ? "available" : ""}`} aria-hidden="true" />
        <span className="wb-pool-full">算力网</span><span className="wb-pool-short">算力网</span>
        <small>{data.auditPool.available ? `${data.auditPool.available} 可用` : openai?.configured ? "API 可用" : "未就绪"}</small>
      </button>
      <button className="notification-trigger" onClick={activity} aria-label={`通知，${unread} 条未读`}><Bell size={18} />{unread > 0 && <b>{unread}</b>}</button>
      <button className="profile-trigger" onClick={() => toggle("profile")} aria-label="当前成员"><Avatar id={member.id} captain={member.role === "captain"} /></button>
      {panel && createPortal(
        <section
          className={`top-popover wb-popover ${panel}`}
          aria-label={
            panel === "project" ? "项目菜单" : panel === "workspace"
              ? "本地工作区"
              : panel === "codex"
                ? "算力网"
                : panel === "invite"
                  ? "邀请成员"
                  : "当前成员"
          }
        >
          <header>
            <h3>
          {panel === "project" ? "项目" : panel === "workspace"
                ? "本地工作区"
                : panel === "codex"
                  ? "算力网"
                  : panel === "invite"
                    ? "邀请成员"
                    : member.label}
            </h3>
            <button onClick={() => { pickerAbort.current?.abort(); setPanel(""); }} aria-label="关闭弹层">
              ×
            </button>
          </header>
              {panel === "project" && <div className="wb-project-menu">
            <button onClick={() => toggle("workspace")}><FolderOpen size={16} />本地工作区<span>{workspace?.name || "选择项目"}</span></button>
            {member.role === "captain" && <button onClick={() => toggle("invite")}><UserPlus size={16} />成员与邀请</button>}
            <div className="wb-menu-divider" />
            <button onClick={() => { setPanel(""); setMode("topology"); }}>人员拓扑</button>
            <button onClick={() => { setPanel(""); setMode("gantt"); }}>项目甘特</button>
            <button onClick={() => { setPanel(""); setSurface("guide"); }}>多人提案对齐</button>
            <button onClick={() => { setPanel(""); setSurface("versions"); }}>版本历史</button>
            <button onClick={() => { setPanel(""); setSurface("advanced"); }}>完整任务与契约</button>
            <small className="wb-muted">需求 v{data.room.requirementRevision} · {sync}</small>
          </div>}
          {panel === "workspace" && (!local ? (
            <div className="workspace-local-required">
              <b>本机控制桥尚未连接</b>
              <p>在这台电脑运行 <code>vibe-git open</code>，即可选择项目文件夹。</p>
            </div>
          ) : (
            <div className="workspace-project-menu">
              {(workspace?.selected || workspace?.valid) && (
                <div className="workspace-project-current">
                  <b>{workspace.name}</b>
                  <small title={workspace.path}>{workspace.path}</small>
                  {!workspace.valid && <small>Git 待初始化</small>}
                </div>
              )}
              {!workspace?.selected && !workspace?.valid && !workspace?.recent?.length && (
                <p className="workspace-project-empty">还没有项目。选择文件夹即可开始。</p>
              )}
              {!workspace?.valid && workspace?.error && /未找到 Git|无法启动 Git|GIT_BIN/.test(workspace.error) && (
                <p className="workspace-project-error">{workspace.error}</p>
              )}
              {workspace?.recent?.filter((item) => item.path !== workspace.path).map((item) => (
                <button
                  key={item.path}
                  type="button"
                  className="workspace-project-row"
                  disabled={busy || !!active}
                  onClick={() => void work(async () => {
                    const next = await bridge<WorkspaceInfo>("/api/local/workspace/select", { path: item.path });
                    setWorkspace(next);
                    setPanel("");
                    void refresh().catch(() => undefined);
                  })}
                >
                  <b>{item.name}</b>
                  <small title={item.path}>{item.path}</small>
                </button>
              ))}
              {workspace?.selected && !workspace.valid && (
                <button type="button" className="journey-primary workspace-project-create" disabled={busy || !!active} onClick={() => { setGitInitError(""); setPanel(""); setConfirmGitInit(true); }}>
                  初始化 Git
                </button>
              )}
              <button
                type="button"
                className={`workspace-project-create ${workspace?.selected && !workspace.valid ? "" : "journey-primary"}`}
                disabled={busy || !!active}
                onClick={pickProject}
              >
                <FolderOpen size={15} /> {workspace?.selected || workspace?.valid || workspace?.recent?.length ? "新建或打开项目" : "新建项目"}
              </button>
              {active && <p className="workspace-project-note">「{active.title}」正在执行，完成后可切换项目。</p>}
            </div>
          ))}
          {panel === "codex" && (
            <>
              <div className="wb-pool-summary"><strong>{data.auditPool.available} 可用</strong><span>{data.auditPool.busy} 忙碌</span></div>
              <details className="wb-disclosure"><summary>团队节点</summary>{data.nodes.map(node => <div className="wb-pool-node" key={node.id}><span>{node.label}</span><small>{!node.connected ? "离线" : codexState(node) !== "available" ? "未就绪" : node.activeJobCount > 0 ? `忙碌 · ${node.activeJobCount} 作业` : "可用"}</small></div>)}</details>
              <h4>本机接入</h4><p>{codexLabel}</p>
              <div className="wb-pool-settings">
                <label htmlFor="wb-codex-model">Codex 模型</label>
                <select
                  id="wb-codex-model"
                  value={modelOptions.some(option => option.id === selectedModel) ? selectedModel : "default"}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedModel(val);
                    try { localStorage.setItem("vibe-git:codex-model", val); } catch {}
                  }}
                >
                  {modelOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.name}
                    </option>
                  ))}
                </select>
                {modelError && <small className="wb-inline-error">{modelError}</small>}
              </div>
              <div className="wb-pool-settings">
                <div className="wb-pool-setting-head"><strong>OpenAI API</strong><span>{openai?.source === "environment" ? "环境变量" : openai?.configured ? "已配置" : "未配置"}</span></div>
                <button type="button" disabled={!local} onClick={() => setShowApiSettings(!showApiSettings)}>{showApiSettings ? "收起" : "配置 API Key"}</button>
                {showApiSettings && <div className="wb-pool-api-form">
                  <label htmlFor="wb-openai-key">API Key</label>
                  <input id="wb-openai-key" type="password" autoComplete="off" value={apiKey} placeholder={openai?.configured ? "输入新 Key 可替换" : "sk-…"} onChange={event => setApiKey(event.target.value)} />
                  <label htmlFor="wb-openai-model">API 模型</label>
                  <input id="wb-openai-model" value={apiModel} onChange={event => setApiModel(event.target.value)} />
                  <div className="wb-pool-api-actions"><button type="button" disabled={busy || (!apiKey.trim() && apiModel === openai?.model)} onClick={() => void work(async () => {
                    const status = await bridge<{ configured: boolean; source: string; model: string }>("/api/local/openai", { apiKey: apiKey || undefined, model: apiModel });
                    setOpenAI(status); setApiModel(status.model); setApiKey(""); setShowApiSettings(false);
                  })}>保存</button>{openai?.source === "local" && <button type="button" disabled={busy} onClick={() => void work(async () => {
                    const status = await bridge<{ configured: boolean; source: string; model: string }>("/api/local/openai", { clear: true });
                    setOpenAI(status); setApiKey(""); setShowApiSettings(false);
                  })}>清除 Key</button>}</div>
                </div>}
              </div>
              {!(codex?.rateLimits ?? member.rateLimits).length && (
                <p>
                  5 小时额度：未知
                  <br />
                  周额度：未知
                </p>
              )}
              {(codex?.rateLimits ?? member.rateLimits).map((r) => (
                <p key={r.label}>
                  {r.label}{" "}
                  <b>
                    {r.remainingPercent === null
                      ? "额度未知"
                      : `${r.remainingPercent}% 剩余`}
                  </b>
                </p>
              ))}
              {codex?.reason && <p>{codex.reason}</p>}
              {codex?.verificationUrl &&
                /^https:\/\//.test(codex.verificationUrl) && (
                  <a
                    href={codex.verificationUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    打开设备授权页面
                  </a>
                )}
              {codex?.userCode && <code>{codex.userCode}</code>}
              <button
                disabled={
                  !local || busy || !codex || codex.status === "connecting"
                }
                onClick={() => setLocalAction("codex")}
              >
                {codex?.status === "connecting"
                  ? "等待授权"
                  : codex?.status === "available"
                    ? "重新接入"
                    : "接入算力池"}
              </button>
            </>
          )}
          {panel === "invite" && (
            <>
              <p>
                {data.nodes.filter((n) => n.connected).length} 人在线 · Tunnel{" "}
                {data.tunnel?.running ? "运行中" : "未启动"}
              </p>
              {invite && (
                <>
                  <code className="break">{invite.command}</code>
                  <button
                    onClick={() =>
                      void work(() =>
                        navigator.clipboard.writeText(invite.command),
                      )
                    }
                  >
                    复制加入命令
                  </button>
                  <button
                    onClick={() =>
                      void work(() =>
                        navigator.clipboard.writeText(invite.joinUrl),
                      )
                    }
                  >
                    复制邀请链接
                  </button>
                </>
              )}
              <details>
                <summary>更多设置</summary>
                <button
                  disabled={!local || busy}
                  onClick={() => setLocalAction("rotate")}
                >
                  轮换邀请
                </button>
                <button
                  disabled={!local || busy}
                  onClick={() => setLocalAction("install")}
                >
                  安装 Tunnel
                </button>
                <button
                  disabled={!local || busy}
                  onClick={() => setLocalAction(data.tunnel?.running ? "stop" : "start")}
                >
                  {data.tunnel?.running ? "停止" : "启动"} Tunnel
                </button>
              </details>
            </>
          )}
          {panel === "profile" && (
            <>
              <p>
                {member.role === "captain" ? "队长" : "成员"} ·{" "}
                {member.connected ? "在线" : "离线"}
              </p>
              <code>{member.id}</code>
              <p>
                重新连接：在本机运行 <code>vibe-git open</code>
              </p>
              <button
                onClick={() => {
                  open({ type: "member", id: member.id, tab: "plan" });
                  setPanel("");
                }}
              >
                我的提案
                {Math.max(
                  0,
                  ...data.alignments.flatMap((a) =>
                    a.planSnapshot
                      .filter((p) => p.nodeId === member.id)
                      .map((p) => p.revision),
                  ),
                ) > 0 &&
                  (data.plans.find((plan) => plan.ownerNodeId === member.id)
                    ?.revision ?? 0) >
                    Math.max(
                      0,
                      ...data.alignments.flatMap((a) =>
                        a.planSnapshot
                          .filter((p) => p.nodeId === member.id)
                          .map((p) => p.revision),
                      ),
                    ) && <i className="revision-dot" />}
              </button>
              <button
                onClick={() => {
                  open({ type: "member", id: member.id, tab: "changes" });
                  setPanel("");
                }}
              >
                我的需求 PR
              </button>
            </>
          )}
          {!local && panel === "codex" && (
            <p>
              请在自己的电脑运行 <code>vibe-git open</code> 后操作。
            </p>
          )}
          {error && (panel === "workspace" ? <p className="workspace-project-error" role="alert">{error}</p> : <RecoveryHint error={error} />)}
          {busy && (pickingFolder ? <div className="workspace-picker-wait" role="status">请在 Windows 文件夹窗口选择目录。<button onClick={() => pickerAbort.current?.abort()}>取消选择</button></div> : <p role="status">处理中…</p>)}
        </section>, document.body
      )}
      {localAction && createPortal(<div className="impact-backdrop" role="dialog" aria-modal="true" aria-label="确认本机操作"><section className="impact-dialog"><h2>{localAction === "codex" ? "连接本机 Codex？" : localAction === "rotate" ? "轮换邀请链接？" : localAction === "install" ? "安装 Cloudflare Tunnel？" : localAction === "start" ? "启动 Cloudflare Tunnel？" : "停止 Cloudflare Tunnel？"}</h2><p>{localAction === "codex" ? "将启动本机 Codex 登录或连接流程。若尚未安装，请先安装 Codex 并登录。" : localAction === "rotate" ? "旧邀请链接会失效；已加入的队友不会退出。" : localAction === "install" ? "将在队长本机安装 Tunnel 组件，可能需要网络连接。" : localAction === "start" ? "将在队长本机启动 Tunnel，房间会获得远程邀请入口。" : "远程邀请与只读访问会中断；本机房间仍可用。"}</p><div><button onClick={() => setLocalAction(null)}>取消</button><button className="journey-primary" onClick={confirmLocal}>确认执行</button></div></section></div>, document.body)}
      {pendingProject && createPortal(
        <div className="impact-backdrop" role="dialog" aria-modal="true" aria-label="确认项目工作区">
          <section className="impact-dialog">
            <h2>使用这个项目文件夹</h2>
            <p className="workspace-picked-path" title={pendingProject.path}>{pendingProject.path}</p>
            <label className="workspace-project-name">
              项目名称
              <input
                autoFocus
                value={pendingProject.name}
                maxLength={80}
                disabled={savingProject}
                onChange={(event) => setPendingProject({ ...pendingProject, name: event.target.value })}
              />
            </label>
            <p>先绑定此文件夹；Git 初始化将在下一步单独进行。</p>
            {projectError && <p className="workspace-project-error" role="alert">{projectError}</p>}
            <div>
              <button disabled={savingProject} onClick={() => setPendingProject(null)}>取消</button>
              <button className="journey-primary" disabled={savingProject || !pendingProject.name.trim()} onClick={() => void confirmProject()}>
                {savingProject ? "处理中…" : "确认使用"}
              </button>
            </div>
          </section>
        </div>, document.body
      )}
      {confirmGitInit && workspace && createPortal(
        <div className="impact-backdrop" role="dialog" aria-modal="true" aria-label="确认初始化 Git">
          <section className="impact-dialog">
            <h2>初始化 Git？</h2>
            <p className="workspace-picked-path" title={workspace.path}>{workspace.path}</p>
            <p>将创建 Git 仓库和首个空提交。已有文件保持原样，不会被自动提交。</p>
            {gitInitError && <p className="workspace-project-error" role="alert">{gitInitError}</p>}
            <div>
              <button disabled={initializingGit} onClick={() => setConfirmGitInit(false)}>取消</button>
              <button className="journey-primary" disabled={initializingGit} onClick={() => void initializeProject()}>{initializingGit ? "初始化中…" : "确认初始化"}</button>
            </div>
          </section>
        </div>, document.body
      )}
    </header>
  );
}
