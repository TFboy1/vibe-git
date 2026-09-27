import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { Bell, FolderGit2, Network, UserPlus } from "lucide-react";
import type { V20BootstrapPayload } from "@vibe-git/protocol";
import { api } from "../api";
import { Avatar } from "./TopologyCanvas";
import { codexState, type CanvasMode, type CanvasSurface, type InspectorTarget } from "./model";
import { bridge, type WorkspaceInfo, type CodexInfo } from "./localApi";
import { RecoveryHint } from "./RecoveryHint";
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
  const [invite, setInvite] = useState<{
    command: string;
    joinUrl: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [localAction, setLocalAction] = useState<"codex" | "rotate" | "install" | "start" | "stop" | null>(null);
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
    setPanel(panel === p ? "" : p);
    setError("");
    if (p === "workspace" && local)
      void work(async () => setWorkspace(await bridge("/api/local/workspace")));
    if (p === "codex" && local)
      void work(async () => setCodex(await bridge("/api/local/codex")));
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
      if (e.key === "Escape") setPanel("");
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (local)
      void bridge<WorkspaceInfo>("/api/local/workspace")
        .then(setWorkspace)
        .catch(() => {});
  }, [local]);
  const member = data.viewer;
  const active = data.tasks.find(
    (t) => t.assigneeNodeId === member.id && t.activeJobId,
  );
  const codexLabel = codex
    ? {
        available: "已接入 Codex 算力网",
        connecting: "正在接入",
        login_required: "需要登录",
        unavailable: "暂不可用",
      }[codex.status]
    : codexState(member) === "available"
      ? "已接入 Codex 算力网"
      : codexState(member) === "unverified"
        ? "需要登录"
        : "暂不可用";
  return (
    <header className="command-bar">
      <button
        className={`canvas-brand ${sync === "正在重连" ? "reconnecting" : ""}`}
        onClick={() => open({ type: "project", id: "project" })}
      >
        <img src="/vibe-git-logo.png" alt="" />
        <span>
          vibe-git
          <small>
            需求 R{data.room.requirementRevision} · {sync}
          </small>
        </span>
      </button>
      <button className="workspace-trigger" onClick={() => toggle("workspace")}>
        <FolderGit2 size={16} />
        <span>
          {workspace?.name ?? "本地工作区"}
          <small>
            {member.git?.branch ?? "未就绪"}
            {member.git?.dirty ? " •" : ""}
          </small>
        </span>
      </button>
      <button className="codex-trigger" title={codexLabel} onClick={() => toggle("codex")}>
        <Network size={16} />
        <span className="codex-full">{codexLabel}</span><span className="codex-short">算力网</span>
      </button>
      <div className="segmented view-switch" aria-label="画布视角">
        <button
          className={surface === "canvas" && mode === "topology" ? "selected" : ""}
          onClick={() => setMode("topology")}
        >
          人员拓扑
        </button>
        <button
          className={surface === "canvas" && mode === "gantt" ? "selected" : ""}
          onClick={() => setMode("gantt")}
        >
          项目甘特
        </button>
      </div>
      <nav className="surface-switch" aria-label="工作页面">
        <button className={surface === "guide" ? "selected" : ""} onClick={() => setSurface("guide")}>{member.role === "captain" ? "带队向导" : "我的向导"}</button>
        <button className={surface === "versions" ? "selected" : ""} onClick={() => setSurface("versions")}>版本与变更</button>
        <button className={surface === "advanced" ? "selected" : ""} onClick={() => setSurface("advanced")}>高级模式</button>
      </nav>
      {member.role === "captain" && (
        <button onClick={() => toggle("invite")} aria-label="邀请成员">
          <UserPlus size={17} />
          <span className="wide-label">邀请成员</span>
        </button>
      )}
      <button
        className="notification-trigger"
        onClick={activity}
        aria-label={`活动通知 ${unread} 条未读`}
      >
        <Bell size={18} />
        {unread > 0 && <b>{unread}</b>}
      </button>
      <button
        className="profile-trigger"
        onClick={() => toggle("profile")}
        aria-label="当前成员"
      >
        <Avatar id={member.id} captain={member.role === "captain"} />
      </button>
      {panel && createPortal(
        <section
          className={`top-popover ${panel}`}
          aria-label={
            panel === "workspace"
              ? "本地工作区"
              : panel === "codex"
                ? "Codex 算力网"
                : panel === "invite"
                  ? "邀请成员"
                  : "当前成员"
          }
        >
          <header>
            <h3>
              {panel === "workspace"
                ? "本地工作区"
                : panel === "codex"
                  ? "Codex 算力网"
                  : panel === "invite"
                    ? "邀请成员"
                    : member.label}
            </h3>
            <button onClick={() => setPanel("")} aria-label="关闭弹层">
              ×
            </button>
          </header>
          {panel === "workspace" && (
            <>
              <p>分支 {workspace?.branch ?? member.git?.branch ?? "—"}</p>
              <code title={workspace?.headSha ?? member.git?.headSha ?? ""}>HEAD · {(workspace?.headSha ?? member.git?.headSha)?.slice(0, 8) ?? "—"}</code>
              <p>
                {workspace?.dirty ? "有未提交修改" : "工作区状态以本机为准"}
              </p>
              {workspace && (
                <>
                  <p className="break">{workspace.path}</p>
                  <h4>最近使用</h4>
                  {workspace.recent.map((w) => (
                    <button
                      disabled={busy || !!active}
                      key={w.path}
                      onClick={() =>
                        void work(async () => {
                          setWorkspace(
                            await bridge("/api/local/workspace/select", {
                              path: w.path,
                            }),
                          );
                          await refresh();
                        })
                      }
                    >
                      {w.name}
                    </button>
                  ))}
                </>
              )}
              <button
                disabled={!local || busy || !!active}
                onClick={() =>
                  void work(async () => {
                    const picked = await bridge<{ path: string | null }>(
                      "/api/local/workspace/pick",
                      {},
                    );
                    if (picked.path) {
                      setWorkspace(
                        await bridge("/api/local/workspace/select", {
                          path: picked.path,
                        }),
                      );
                      await refresh();
                    }
                  })
                }
              >
                选择其他 Git 工作区
              </button>
              {active && (
                <p>「{active.title}」正在执行，完成后可切换工作区。</p>
              )}
              <small>切换只影响后续任务的执行目录。</small>
            </>
          )}
          {panel === "codex" && (
            <>
              <p>{codexLabel}</p>
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
                    : "接入算力网"}
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
          {!local && ["workspace", "codex"].includes(panel) && (
            <p>
              请在自己的电脑运行 <code>vibe-git open</code> 后操作。
            </p>
          )}
          {error && (
            <RecoveryHint error={error} />
          )}
          {busy && <p role="status">处理中…</p>}
        </section>, document.body
      )}
      {localAction && createPortal(<div className="impact-backdrop" role="dialog" aria-modal="true" aria-label="确认本机操作"><section className="impact-dialog"><h2>{localAction === "codex" ? "连接本机 Codex？" : localAction === "rotate" ? "轮换邀请链接？" : localAction === "install" ? "安装 Cloudflare Tunnel？" : localAction === "start" ? "启动 Cloudflare Tunnel？" : "停止 Cloudflare Tunnel？"}</h2><p>{localAction === "codex" ? "将启动本机 Codex 登录或连接流程。若尚未安装，请先安装 Codex 并登录。" : localAction === "rotate" ? "旧邀请链接会失效；已加入的队友不会退出。" : localAction === "install" ? "将在队长本机安装 Tunnel 组件，可能需要网络连接。" : localAction === "start" ? "将在队长本机启动 Tunnel，房间会获得远程邀请入口。" : "远程邀请与只读访问会中断；本机房间仍可用。"}</p><div><button onClick={() => setLocalAction(null)}>取消</button><button className="journey-primary" onClick={confirmLocal}>确认执行</button></div></section></div>, document.body)}
    </header>
  );
}
