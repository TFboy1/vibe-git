import { ActivityCenter } from "./ActivityCenter";
import { useCallback, useEffect, useRef, useState } from "react";
import type { V20BootstrapPayload } from "@vibe-git/protocol";
import { api, localCapabilities } from "../api";
import { TopCommandBar } from "./TopCommandBar";
import { TopologyCanvas, Avatar } from "./TopologyCanvas";
import { GanttCanvas } from "./GanttCanvas";
import { InspectorDrawer } from "./InspectorDrawer";
import {
  deriveUnreadActivity,
  liveTasks,
  type CanvasMode,
  type InspectorTarget,
} from "./model";
import { bridge } from "./localApi";
function readTarget(): InspectorTarget | null {
  const q = new URLSearchParams(location.search);
  const type = q.get("object");
  const id = q.get("id");
  return type &&
    id &&
    ["member", "module", "package", "task", "change", "project"].includes(type)
    ? {
        type: type as InspectorTarget["type"],
        id,
        tab: q.get("tab") ?? undefined,
      }
    : null;
}
function Toast({
  name,
  ownerId,
  revision,
  filename,
  onView,
  onDismiss,
}: {
  name: string;
  ownerId: string;
  revision: number;
  filename: string;
  onView: () => void;
  onDismiss: () => void;
}) {
  const [hover, setHover] = useState(false);
  const remaining = useRef(10000);
  useEffect(() => {
    if (hover) return;
    const at = Date.now();
    const timer = setTimeout(onDismiss, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - at;
    };
  }, [hover]);
  return (
    <article
      className="change-toast"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
    >
      <Avatar id={ownerId} />
      <strong>{name} 提交了需求变更</strong>
      <p>{filename}</p>
      <small>需求 R{revision} · 刚刚</small>
      <div>
        <button onClick={onView}>查看变更</button>
        <button onClick={onDismiss}>稍后处理</button>
      </div>
    </article>
  );
}
export function AppShell() {
  const [data, setData] = useState<V20BootstrapPayload | null>(null);
  const [error, setError] = useState("");
  const [local, setLocal] = useState(false);
  const [sync, setSync] = useState("正在连接");
  const [updated, setUpdated] = useState("");
  const [mode, setModeState] = useState<CanvasMode>(() =>
    new URLSearchParams(location.search).get("view") === "gantt"
      ? "gantt"
      : "topology",
  );
  const [target, setTarget] = useState<InspectorTarget | null>(readTarget);
  const [visibleMode, setVisibleMode] = useState<CanvasMode>(mode);
  const [switching, setSwitching] = useState(false);
  const [activity, setActivity] = useState(false);
  const [read, setRead] = useState<Set<string>>(new Set());
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<
    Array<{ id: string; name: string; filename: string; ownerId: string; revision: number }>
  >([]);
  const prior = useRef<Set<string> | null>(null);
  const allowToasts = useRef(false);
  const seq = useRef(0);
  const live = useRef(true);
  const refreshing = useRef<Promise<void> | null>(null);
  const refresh = useCallback(() => {
    if (refreshing.current) return refreshing.current;
    const operation = api
      .bootstrap()
      .then((value) => {
        if (!live.current) return;
        if (
          prior.current &&
          allowToasts.current &&
          value.viewer.role === "captain"
        ) {
          const fresh = value.pullRequests.filter(
            (p) =>
              !prior.current!.has(p.id) &&
              p.submitterNodeId !== value.viewer.id,
          );
          for (const change of fresh)
            void api
              .document(change.documentId)
              .then((d) => {
                if (live.current)
                  setToasts((old) => [
                    ...old,
                    {
                      id: change.id,
                      ownerId: change.submitterNodeId,
                      revision: change.baseRequirementRevision,
                      name:
                        value.nodes.find((n) => n.id === change.submitterNodeId)
                          ?.label ?? "成员",
                      filename: d.filename,
                    },
                  ]);
              })
              .catch(() => {});
        }
        setSeen(
          (old) =>
            new Set([
              ...old,
              ...value.notifications
                .filter(
                  (n) =>
                    n.readAt &&
                    n.entityId &&
                    value.pullRequests.some((c) => c.id === n.entityId),
                )
                .map((n) => n.entityId!),
            ]),
        );
        prior.current = new Set(value.pullRequests.map((p) => p.id));
        seq.current = Math.max(seq.current, value.room.seq);
        setData(value);
        setError("");
        setUpdated(new Date().toLocaleTimeString("zh-CN"));
      })
      .catch((e) => {
        if (live.current) {
          setError(e.message);
          setSync("正在重连");
        }
      })
      .finally(() => {
        refreshing.current = null;
      });
    refreshing.current = operation;
    return operation;
  }, []);
  useEffect(() => {
    live.current = true;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let fallback: ReturnType<typeof setInterval> | undefined;
    let failures = 0;
    let stopped = false;
    let queued: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (stopped) return;
      source = new EventSource(`/api/v1/events?since=${seq.current}`, {
        withCredentials: true,
      });
      source.onopen = () => {
        allowToasts.current = false;
        void refresh().then(() => {
          allowToasts.current = true;
        });
        failures = 0;
        setSync("实时同步");
        if (fallback) {
          clearInterval(fallback);
          fallback = undefined;
        }
      };
      source.onmessage = (e) => {
        let next = Number(e.lastEventId);
        try {
          next = Number(JSON.parse(e.data).seq ?? next);
        } catch {
          return;
        }
        if (!Number.isFinite(next) || next <= seq.current) return;
        seq.current = next;
        if (!queued)
          queued = setTimeout(() => {
            queued = undefined;
            void refresh();
          }, 150);
      };
      source.onerror = () => {
        source?.close();
        allowToasts.current = false;
        if (stopped) return;
        setSync("正在重连");
        failures++;
        if (failures >= 3 && !fallback)
          fallback = setInterval(() => void refresh(), 30000);
        retry = setTimeout(
          connect,
          Math.min(30000, 1500 * 2 ** Math.min(failures, 4)),
        );
      };
    };
    void refresh().then(connect);
    void localCapabilities().then((c) => {
      if (!stopped) setLocal(c.local);
    });
    return () => {
      stopped = true;
      live.current = false;
      source?.close();
      clearTimeout(retry);
      clearTimeout(queued);
      clearInterval(fallback);
    };
  }, [refresh]);
  useEffect(() => {
    if (mode === visibleMode) { setSwitching(false); return; }
    setSwitching(true);
    const timer = setTimeout(
      () => {
        setVisibleMode(mode);
        setSwitching(false);
      },
      matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 160,
    );
    return () => clearTimeout(timer);
  }, [mode, visibleMode]);
  const historyState = (nextMode: CanvasMode, next: InspectorTarget | null) => {
    const url = new URL(location.href);
    url.searchParams.set("view", nextMode);
    for (const key of ["object", "id", "tab"]) url.searchParams.delete(key);
    if (next) {
      url.searchParams.set("object", next.type);
      url.searchParams.set("id", next.id);
      if (next.tab) url.searchParams.set("tab", next.tab);
    }
    url.hash = "";
    history.pushState(null, "", url);
  };
  const open = useCallback(
    (next: InspectorTarget) => {
      setTarget(next);
      setActivity(false);
      historyState(mode, next);
      if (next.type === "change") {
        setSeen((old) => new Set([...old, next.id]));
        setToasts((old) => old.filter((t) => t.id !== next.id));
      }
    },
    [mode],
  );
  const close = () => {
    setTarget(null);
    historyState(mode, null);
  };
  useEffect(() => {
    const pop = () => {
      setModeState(
        new URLSearchParams(location.search).get("view") === "gantt"
          ? "gantt"
          : "topology",
      );
      setTarget(readTarget());
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const markRead = async (id: string) => {
    try {
      await bridge(`/api/v1/notifications/${encodeURIComponent(id)}/read`, {});
      setRead((old) => new Set([...old, id]));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  if (!data)
    return (
      <main className="canvas-loading">
        <img src="/vibe-git-logo.png" alt="vibe-git" />
        <h1>{error ? "暂时无法连接房间" : "正在连接协作房间"}</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <p>
              在自己的工作区运行 <code>vibe-git open</code> 建立会话。
            </p>
            <button onClick={() => void refresh()}>重新连接</button>
          </>
        ) : (
          <div
            className={mode === "gantt" ? "skeleton-rows" : "skeleton-nodes"}
          >
            <i />
            <i />
            <i />
          </div>
        )}
      </main>
    );
  const unread = deriveUnreadActivity(data, read);
  const tasks = liveTasks(data);
  const done = tasks.filter((t) => t.status === "DONE").length;
  const stage = data.stages.at(-1);
  return (
    <div className="canvas-app">
      <a className="skip-link" href="#workspace-canvas">
        跳到协作画布
      </a>
      <TopCommandBar
        data={data}
        mode={mode}
        setMode={(m) => {
          setModeState(m);
          historyState(m, target);
        }}
        open={open}
        sync={sync}
        local={local}
        refresh={refresh}
        unread={unread.length}
        activity={() => setActivity((v) => !v)}
      />
      <div className={`canvas-body ${target ? "has-inspector" : ""}`}>
        <main id="workspace-canvas" className="workspace-canvas">
          <div className="sync-line">
            {data.nodes.filter((n) => n.connected).length} 人在线 ·{" "}
            <span className={sync === "正在重连" ? "blocked" : ""}>{sync}</span>{" "}
            · {updated}
          </div>
          <div
            className={`canvas-mode ${switching ? "leaving" : ""}`}
            hidden={visibleMode !== "topology"}
          >
            <TopologyCanvas
              active={visibleMode === "topology"}
              data={data}
              open={open}
              drawer={!!target}
              seen={seen}
            />
          </div>
          <div
            className={`canvas-mode ${switching ? "leaving" : ""}`}
            hidden={visibleMode !== "gantt"}
          >
            <GanttCanvas
              active={visibleMode === "gantt"}
              data={data}
              open={open}
            />
          </div>
          <button
            className="project-pulse"
            onClick={() => open({ type: "project", id: "project" })}
          >
            <div>
              <small>项目脉搏</small>
              <span>需求 R{data.room.requirementRevision}</span>
            </div>
            <strong>
              阶段 {stage?.sequence ?? "—"}{" "}
              <b>
                {tasks.length ? Math.round((done / tasks.length) * 100) : 0}%
              </b>
            </strong>
            <progress max={Math.max(1, tasks.length)} value={done} />
            <small>
              {done}/{tasks.length} 项完成 ·{" "}
              {data.alignments
                .filter((a) => a.status === "NEEDS_DECISION")
                .reduce(
                  (sum, a) =>
                    sum +
                    (a.issues?.filter((i) => !i.selectedOptionId).length ?? 0),
                  0,
                )}{" "}
              待裁决 ·{" "}
              {data.pullRequests.filter((c) => c.status === "QUEUED").length}{" "}
              待审
            </small>
          </button>
        </main>
        {target && (
          <InspectorDrawer
            key={`${target.type}:${target.id}`}
            data={data}
            target={target}
            open={open}
            close={close}
            refresh={refresh}
            local={local}
          />
        )}
      </div>
      {error && (
        <div className="global-error" role="alert">
          {error}
          <button onClick={() => setError("")}>关闭</button>
        </div>
      )}
      {activity && (
        <ActivityCenter
          data={data}
          read={read}
          close={() => setActivity(false)}
          open={open}
          markRead={markRead}
        />
      )}
      <div className="toast-stack" aria-live="polite">
        {toasts.slice(0, 3).map((t) => (
          <Toast
            key={t.id}
            {...t}
            onView={() => open({ type: "change", id: t.id })}
            onDismiss={() =>
              setToasts((old) => old.filter((item) => item.id !== t.id))
            }
          />
        ))}
        {toasts.length > 3 && (
          <button onClick={() => setActivity(true)}>
            还有 {toasts.length - 3} 条变更通知
          </button>
        )}
      </div>
    </div>
  );
}
