import { useEffect, useRef, useState } from "react";
import type {
  MarkdownDocument,
  ProjectModule,
  ProjectWorkPackage,
  V20BootstrapPayload,
} from "@vibe-git/protocol";
import { api } from "../api";
import { Markdown } from "../Markdown";
import { AlignmentView, TaskCard, FileButton } from "../InspectorContent";
import { ProposalComposer, ModuleManager } from "../WorkspacePanels";
import { PlanHistory } from "../PlanHistory";
import { ContractBoard, WorkstreamBoard } from "../ContractWorkspace";
import { Avatar } from "./TopologyCanvas";
import { RecoveryHint } from "./RecoveryHint";
import {
  codexState,
  derivePackageParticipants,
  derivePackageProgress,
  label,
  liveTasks,
  type InspectorTarget,
} from "./model";
type Props = {
  data: V20BootstrapPayload;
  target: InspectorTarget;
  open: (target: InspectorTarget) => void;
  close: () => void;
  refresh: () => Promise<void>;
  local: boolean;
};
const download = (filename: string, content: string) => {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/markdown;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
function ScheduleEditor({
  data,
  module,
  pack,
  refresh,
}: {
  data: V20BootstrapPayload;
  module: ProjectModule;
  pack?: ProjectWorkPackage | undefined;
  refresh: () => Promise<void>;
}) {
  const item = pack ?? module;
  const [name, setName] = useState(item.name);
  const [status, setStatus] = useState(item.status);
  const [start, setStart] = useState(item.plannedStart ?? "");
  const [end, setEnd] = useState(item.plannedEnd ?? "");
  const [ids, setIds] = useState(pack?.taskIds ?? []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(data.moduleRevision);
  const reload = async () => {
    setBusy(true);
    try {
      const latest = await api.bootstrap();
      const currentModule = latest.modules.find((m) => m.id === module.id);
      const current = pack
        ? currentModule?.packages.find((p) => p.id === pack.id)
        : currentModule;
      if (!current) throw new Error("该条目已被删除，请关闭详情后选择其他条目。");
      await refresh();
      setName(current.name);
      setStatus(current.status);
      setStart(current.plannedStart ?? "");
      setEnd(current.plannedEnd ?? "");
      setIds("taskIds" in current ? current.taskIds : []);
      setRevision(latest.moduleRevision);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setError("");
    if (!name.trim() || (start && end && start > end)) {
      setError("请填写名称，并确保结束日期不早于开始日期。");
      return;
    }
    setBusy(true);
    try {
      const items = structuredClone(data.modules);
      const m = items.find((m) => m.id === module.id)!;
      const value = pack ? m.packages.find((p) => p.id === pack.id)! : m;
      Object.assign(value, {
        name: name.trim(),
        status,
        plannedStart: start || null,
        plannedEnd: end || null,
      });
      if (pack) (value as ProjectWorkPackage).taskIds = ids;
      const saved = await api.setModules(revision, items);
      setRevision(saved.revision);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="schedule-editor">
      <label>
        名称
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        状态
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          {["planned", "in_progress", "blocked", "done"].map((s) => (
            <option value={s} key={s}>
              {label(s)}
            </option>
          ))}
        </select>
      </label>
      <div className="date-inputs">
        <label>
          计划开始
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          计划结束
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
      </div>
      {pack && (
        <fieldset>
          <legend>关联任务</legend>
          {liveTasks(data).map((t) => (
            <label key={t.id}>
              <input
                type="checkbox"
                checked={ids.includes(t.id)}
                onChange={(e) =>
                  setIds(
                    e.target.checked
                      ? [...ids, t.id]
                      : ids.filter((id) => id !== t.id),
                  )
                }
              />
              {t.title}
            </label>
          ))}
        </fieldset>
      )}
      <button disabled={busy} onClick={() => void save()}>
        保存排期
      </button>
      {error && (
        <p role="alert" className="form-error">
          {error}
          <button
            disabled={busy}
            onClick={() => void reload()}
          >
            重新载入
          </button>
        </p>
      )}
    </div>
  );
}
export function InspectorDrawer({
  data,
  target,
  open,
  close,
  refresh,
  local,
}: Props) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [compose, setCompose] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [confirmation, setConfirmation] = useState<{ kind: "apply" | "cancel" | "reject" | "revoke"; id: string } | null>(null);
  const [doc, setDoc] = useState<MarkdownDocument | null>(null);
  const [alignmentId, setAlignmentId] = useState("");
  const [newName, setNewName] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const readStarted = useRef(false);
  const run = (work: () => Promise<unknown>, message: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    void work()
      .then(() => refresh())
      .then(() => setNotice(message))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    heading.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const captain = data.viewer.role === "captain";
  const member =
    target.type === "member"
      ? data.nodes.find((n) => n.id === target.id)
      : undefined;
  const task =
    target.type === "task"
      ? data.tasks.find((t) => t.id === target.id)
      : undefined;
  const change =
    target.type === "change"
      ? data.pullRequests.find((p) => p.id === target.id)
      : undefined;
  const module = data.modules.find(
    (m) => m.id === target.id || m.packages.some((p) => p.id === target.id),
  );
  const pack =
    target.type === "package"
      ? module?.packages.find((p) => p.id === target.id)
      : undefined;
  const stage =
    [...data.stages].reverse().find((s) => s.status !== "COMPLETED") ??
    data.stages.at(-1);
  const alignment =
    data.alignments.find((a) => a.id === alignmentId) ??
    [...data.alignments].reverse().find((a) => a.status !== "PUBLISHED") ??
    data.alignments.at(-1);
  const review = change
    ? data.reviews.find((r) => r.id === change.reviewId)
    : data.reviews.at(-1);
  const myMember = member?.id === data.viewer.id;
  const plan = member
    ? data.plans.find((p) => p.ownerNodeId === member.id)
    : undefined;
  const tab = target.tab ?? (member ? "overview" : "stage");
  const title =
    member?.label ??
    task?.title ??
    pack?.name ??
    (target.type === "module" ? module?.name : undefined) ??
    (change ? "需求变更" : "项目控制");
  useEffect(() => {
    if (
      readStarted.current ||
      !change
    )
      return;
    readStarted.current = true;
    for (const n of data.notifications.filter(
      (n) => n.entityId === change.id && !n.readAt,
    ))
      void fetch(`/api/v1/notifications/${encodeURIComponent(n.id)}/read`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
        .then((r) => {
          if (!r.ok)
            throw new Error("通知已读暂未保存，待通知接口就绪后可重试。");
          return refresh();
        })
        .catch((e) => setError(e.message));
  }, [change?.id]);
  useEffect(() => {
    let stopped = false;
    setDoc(null);
    if (change)
      void api
        .document(change.documentId)
        .then((d) => {
          if (!stopped) setDoc(d);
        })
        .catch((e) => {
          if (!stopped) setError(e.message);
        });
    return () => {
      stopped = true;
    };
  }, [change?.id]);
  const tabs = member
    ? [
        ["overview", "概览"],
        ["plan", "提案"],
        ["tasks", "工作项"],
        ["changes", "需求变更"],
        ["packages", "参与功能"],
      ]
    : target.type === "project"
      ? captain ? [
          ["stage", "阶段概览"],
          ["alignment", "提案对齐"],
          ["decisions", "裁决问题"],
          ["publish", "任务发布"],
          ["review", "变更审核"],
        ] : [["stage", "现行需求"], ["alignment", "统一计划"], ["publish", "我的接口确认"]]
      : [];
  const taskLinks = (ids: string[]) =>
    ids.map((id) => {
      const t = data.tasks.find((t) => t.id === id);
      return t ? (
        <button
          className="object-row"
          key={id}
          onClick={() => open({ type: "task", id })}
        >
          <span>
            {t.title}
            <small>
              {data.nodes.find((n) => n.id === t.assigneeNodeId)?.label}
            </small>
          </span>
          <span>{label(t.status)} →</span>
        </button>
      ) : null;
    });
  const changesList = (owner?: string) => {
    const items = data.pullRequests.filter(
      (c) =>
        !owner || c.submitterNodeId === owner,
    );
    return (
      <>
        {["QUEUED", "IN_REVIEW", "APPLIED", "REJECTED"].map((status) => (
          <section key={status}>
            <h4>
              {label(status)} ·{" "}
              {items.filter((c) => c.status === status).length}
            </h4>
            {items
              .filter((c) => c.status === status)
              .map((c) => (
                <button
                  key={c.id}
                  className="object-row"
                  onClick={() => open({ type: "change", id: c.id })}
                >
                  <span>
                    {data.nodes.find((n) => n.id === c.submitterNodeId)?.label}
                    <small>
                      需求 R{c.baseRequirementRevision} ·{" "}
                      {new Date(c.createdAt).toLocaleString("zh-CN")}
                    </small>
                  </span>
                  <span>查看 →</span>
                </button>
              ))}
          </section>
        ))}
      </>
    );
  };
  const addSchedule = (parent?: ProjectModule) => {
    if (!newName.trim()) {
      setError("请先填写名称。");
      return;
    }
    run(async () => {
      const items = structuredClone(data.modules);
      const item = {
        id: crypto.randomUUID(),
        name: newName.trim(),
        status: "planned" as const,
        plannedStart: null,
        plannedEnd: null,
      };
      if (parent)
        items
          .find((m) => m.id === parent.id)!
          .packages.push({ ...item, taskIds: [] });
      else items.push({ ...item, packages: [] });
      await api.setModules(data.moduleRevision, items);
      setNewName("");
      open({ type: parent ? "package" : "module", id: item.id });
    }, "已创建");
  };
  const reviewActions = () => (
    <>
      {captain && (
        <div className="button-row">
          <button
            disabled={
              !local ||
              busy ||
              stage?.status !== "ACTIVE" ||
              !data.pullRequests.some((p) => p.status === "QUEUED") ||
              data.auditPool.available === 0
            }
            onClick={() => run(() => api.forceReview(), "审核已发起")}
          >
            立即审核
          </button>
          {review &&
            ["QUEUED", "RUNNING", "NEEDS_EVIDENCE"].includes(review.status) && (
              <button
                disabled={!local || busy}
                onClick={() => setConfirmation({ kind: "cancel", id: review.id })}
              >
                取消审核
              </button>
            )}
          {review?.status === "AWAITING_CAPTAIN" && (
            <>
              <button
                disabled={!local || busy}
                onClick={() => setConfirmation({ kind: "apply", id: review.id })}
              >
                应用
              </button>
              <button
                disabled={!local || busy}
                onClick={() => setConfirmation({ kind: "reject", id: review.id })}
              >
                退回
              </button>
            </>
          )}
        </div>
      )}
      <p className="muted">
        {!captain
          ? "由队长发起和裁决审核。"
          : stage?.status !== "ACTIVE"
            ? "当前阶段不支持发起新的审核。"
            : !data.pullRequests.some((p) => p.status === "QUEUED")
              ? "没有待审核的需求变更。"
              : data.auditPool.available === 0
                ? "暂无可用审核节点。"
                : "可对待审变更发起影响分析。"}
      </p>
    </>
  );
  return (
    <aside className="inspector" aria-label="详情抽屉">
      <header className="inspector-heading">
        <div>
          <small>
            {
              {
                member: "成员",
                module: "模块",
                package: "工作包",
                task: "任务",
                change: "需求 PR",
                project: "协作控制",
              }[target.type]
            }
          </small>
          <h2 tabIndex={-1} ref={heading}>
            {title}
          </h2>
        </div>
        <button onClick={close} aria-label="关闭详情">
          ×
        </button>
      </header>
      {member && !target.tab && <div className="inspector-next"><small>当前最相关的操作</small>{(() => {
        const memberTasks = liveTasks(data).filter(item => item.assigneeNodeId === member.id);
        const memberChange = data.pullRequests.find(item => item.submitterNodeId === member.id && ["QUEUED", "IN_REVIEW"].includes(item.status));
        const activeTask = memberTasks.find(item => ["BLOCKED", "PAUSED", "FAILED"].includes(item.status)) ?? memberTasks.find(item => item.status !== "DONE");
        if (memberChange) return <button className="journey-primary" onClick={() => open({ type: "change", id: memberChange.id })}>{memberChange.status === "QUEUED" ? "查看待审变更" : "查看取证进度"}</button>;
        if (activeTask) return <button className="journey-primary" onClick={() => open({ type: "task", id: activeTask.id })}>查看当前任务：{activeTask.title}</button>;
        if (myMember && !plan) return <button className="journey-primary" onClick={() => open({ ...target, tab: "plan" })}>提交我的提案</button>;
        return <button onClick={() => open({ ...target, tab: "tasks" })}>查看任务与交接</button>;
      })()}</div>}
      {!!tabs.length && (
        <nav className="inspector-tabs">
          {tabs.map(([id, text]) => (
            <button
              key={id}
              className={tab === id ? "selected" : ""}
              onClick={() => open({ ...target, tab: id })}
            >
              {text}
            </button>
          ))}
        </nav>
      )}
      <div className="inspector-body">
        {target.type !== "project" && !member && !task && !change && !module && (
          <p className="inline-note">该对象已移除或当前身份无权访问。请关闭详情后选择其他对象。</p>
        )}
        {!local && (
          <p className="inline-note">
            当前为只读连接。执行操作请在自己的电脑运行{" "}
            <code>vibe-git open</code>。
          </p>
        )}
        {error && (
          <RecoveryHint error={error} />
        )}
        {notice && (
          <p role="status" className="success">
            {notice}
          </p>
        )}
        {member && tab === "overview" && (
          <>
            <div className="member-overview">
              <Avatar id={member.id} captain={member.role === "captain"} />
              <div>
                <h3>{member.label}</h3>
                <p>
                  {member.role === "captain" ? "队长" : "成员"} ·{" "}
                  {member.connected ? "在线" : "离线"}
                </p>
              </div>
            </div>
            <dl>
              <dt>工作区</dt>
              <dd>{member.workspaceReady ? "已就绪" : "未就绪"}</dd>
              <dt>Codex 算力网</dt>
              <dd>
                {codexState(member) === "available" ? "已接入" : "暂不可用"}
              </dd>
              <dt>分支</dt>
              <dd>{member.git?.branch ?? "—"}</dd>
              <dt>HEAD</dt>
              <dd>
                <code>{member.git?.headSha ?? "—"}</code>
              </dd>
              <dt>文件修改</dt>
              <dd>{member.git?.dirty ? "有未提交修改" : "无修改"}</dd>
              <dt>完成任务</dt>
              <dd>
                {
                  liveTasks(data).filter(
                    (t) =>
                      t.assigneeNodeId === member.id && t.status === "DONE",
                  ).length
                }{" "}
                项
              </dd>
              <dt>受阻任务</dt>
              <dd>
                {
                  liveTasks(data).filter(
                    (t) =>
                      t.assigneeNodeId === member.id &&
                      ["BLOCKED", "PAUSED"].includes(t.status),
                  ).length
                }{" "}
                项
              </dd>
              <dt>需求变更</dt>
              <dd>{data.pullRequests.filter(p => p.submitterNodeId === member.id).length} 项</dd>
            </dl>
            {!member.rateLimits.length && <p className="muted">Codex 额度暂不可用</p>}
            {member.rateLimits.map((r) => (
              <p key={r.label}>
                {r.label}：
                {r.remainingPercent === null
                  ? "未知"
                  : `${r.remainingPercent}% 剩余`}
              </p>
            ))}
            {taskLinks(
              liveTasks(data)
                .filter((t) => t.assigneeNodeId === member.id && t.activeJobId)
                .map((t) => t.id),
            )}
            {captain && !myMember && (
              <details>
                <summary>更多操作</summary>
                <button
                  disabled={!local || busy}
                  onClick={() => setConfirmation({ kind: "revoke", id: member.id })}
                >
                  撤销成员
                </button>
              </details>
            )}
          </>
        )}
        {member && tab === "plan" && (
          <>
            {compose || (!plan && myMember) ? (
              <fieldset disabled={!local || busy}>
                <ProposalComposer
                  inline
                  key={plan?.id ?? "new"}
                  data={data}
                  current={plan}
                  onClose={() => setCompose(false)}
                  onSaved={refresh}
                />
              </fieldset>
            ) : plan ? (
              <>
                <div className="document-meta">
                  <b>{plan.filename}</b>
                  <p>
                    修订 {plan.revision} ·{" "}
                    {new Date(plan.createdAt).toLocaleString("zh-CN")} ·{" "}
                    {plan.bytes} B
                  </p>
                </div>
                <h4>影响模块</h4>
                {(() => {
                  const finding = [...data.alignments]
                    .reverse()
                    .find(
                      (a) =>
                        a.moduleRevisionSnapshot === data.moduleRevision &&
                        a.planImpacts?.some((p) => p.documentId === plan.id),
                    )
                    ?.planImpacts?.find((p) => p.documentId === plan.id);
                  return finding ? (
                    <>
                      <p>
                        {finding.moduleIds
                          .map(
                            (id) =>
                              data.modules.find((m) => m.id === id)?.name ?? id,
                          )
                          .join("、") || "无模块影响"}
                      </p>
                      <p>{finding.rationale}</p>
                    </>
                  ) : (
                    <p>待队长端 Agent 分析</p>
                  );
                })()}
                <Markdown>{plan.content}</Markdown>
                <div className="button-row">
                  <button onClick={() => download(plan.filename, plan.content)}>
                    下载
                  </button>
                  {myMember && (
                    <>
                      <button
                        disabled={!local}
                        onClick={() => setCompose(true)}
                      >
                        更新
                      </button>
                      <button
                        disabled={!local}
                        onClick={() => setConfirmWithdraw(true)}
                      >
                        撤回
                      </button>
                    </>
                  )}
                </div>
                {confirmWithdraw && (
                  <div className="inline-note">
                    撤回后不再参与下一轮对齐，冻结版本保留。
                    <button
                      onClick={() =>
                        run(async () => {
                          await api.withdrawPlan(plan.id, plan.revision);
                          setConfirmWithdraw(false);
                        }, "提案已撤回")
                      }
                    >
                      确认撤回
                    </button>
                    <button onClick={() => setConfirmWithdraw(false)}>
                      取消
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p>尚未提交提案。</p>
            )}
            <fieldset disabled={busy}>
              <PlanHistory
                writable={local}
                data={data}
                ownerId={member.id}
                active
                onChanged={refresh}
              />
            </fieldset>
          </>
        )}
        {member && tab === "tasks" && (
          <>
            {taskLinks(
              liveTasks(data)
                .filter((t) => t.assigneeNodeId === member.id)
                .map((t) => t.id),
            )}
            <WorkstreamBoard
              data={{
                ...data,
                workstreams: data.workstreams.filter(
                  (w) => w.ownerNodeId === member.id,
                ),
              }}
              stageId={stage?.id}
            />
          </>
        )}
        {member && tab === "changes" && changesList(member.id)}
        {member && tab === "packages" && (
          <>
            {data.modules
              .flatMap((m) => m.packages)
              .filter((p) =>
                derivePackageParticipants(p, data).some(
                  (n) => n.id === member.id,
                ),
              )
              .map((p) => (
                <button
                  className="object-row"
                  key={p.id}
                  onClick={() => open({ type: "package", id: p.id })}
                >
                  {p.name}
                  <span>{derivePackageProgress(p, data).percent}% →</span>
                </button>
              ))}
          </>
        )}
        {module && ["module", "package"].includes(target.type) && (
          <>
            <p>
              {pack ? module.name : "模块"} · {label((pack ?? module).status)}
            </p>
            <p>
              {(pack ?? module).plannedStart ?? "未排期"} —{" "}
              {(pack ?? module).plannedEnd ?? "—"}
            </p>
            {pack ? (
              <>
                <div className="participants">
                  {derivePackageParticipants(pack, data).map((n) => (
                    <button
                      key={n.id}
                      onClick={() => open({ type: "member", id: n.id })}
                    >
                      <Avatar id={n.id} />
                      {n.label}
                    </button>
                  ))}
                </div>
                <p>{derivePackageProgress(pack, data).percent}% 完成</p>
                {taskLinks(pack.taskIds)}
              </>
            ) : (
              module.packages.map((p) => (
                <button
                  className="object-row"
                  key={p.id}
                  onClick={() => open({ type: "package", id: p.id })}
                >
                  {p.name}
                  <span>{label(p.status)} →</span>
                </button>
              ))
            )}
            {captain && target.type === "module" && (
              <div className="button-row">
                <input
                  aria-label="工作包名称"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="新工作包名称"
                />
                <button
                  disabled={!local || busy}
                  onClick={() => addSchedule(module)}
                >
                  创建工作包
                </button>
              </div>
            )}
            {captain && (
              <fieldset disabled={!local || busy}>
                <ScheduleEditor
                  key={target.id}
                  data={data}
                  module={module}
                  pack={pack}
                  refresh={refresh}
                />
                <details>
                  <summary>更多 · JSON 排期</summary>
                  <ModuleManager data={data} onSaved={refresh} />
                </details>
              </fieldset>
            )}
          </>
        )}
        {task && (
          <fieldset disabled={busy}>
            <TaskCard
              writable={local}
              task={task}
              data={data}
              run={run}
              download={(t) =>
                run(
                  async () =>
                    download("task.md", (await api.taskDetail(t.id)).markdown),
                  "任务说明已下载",
                )
              }
            />
          </fieldset>
        )}
        {change && (
          <>
            <h3>{doc?.filename ?? "需求变更"}</h3>
            <p>
              {data.nodes.find((n) => n.id === change.submitterNodeId)?.label} ·
              需求 R{change.baseRequirementRevision} · {label(change.status)}
            </p>
            <p className="muted">提交于 {new Date(change.createdAt).toLocaleString("zh-CN")}</p>
            {doc ? <Markdown>{doc.content}</Markdown> : <p>正在载入正文…</p>}
            {review && (
              <>
                <h3>审核结论</h3>
                <Markdown>{review.summaryMarkdown ?? "尚无审核结论"}</Markdown>
                <h4>影响任务</h4>
                {taskLinks(review.affectedTaskIds)}
                <h4>影响成员</h4>
                <p>
                  {review.affectedNodeIds
                    .map(
                      (id) => data.nodes.find((n) => n.id === id)?.label ?? id,
                    )
                    .join("、") || "无"}
                </p>
                {review.replacementTasks.map((t, i) => (
                  <p key={i}>
                    {t.title} · {t.goal}
                  </p>
                ))}
              </>
            )}
            {reviewActions()}
          </>
        )}
        {target.type === "project" && (
          <>
            {tab === "stage" && (
              <>
                <h3>
                  需求 R{data.room.requirementRevision} · 阶段{" "}
                  {stage?.sequence ?? "—"}
                </h3>
                <p>{stage ? label(stage.status) : "尚未发布阶段"}</p>
                <Markdown>
                  {data.room.currentRequirementMarkdown ?? "尚未形成统一需求。"}
                </Markdown>
                <h3>模块与工作包</h3>
                {data.modules.map((m) => (
                  <button
                    className="object-row"
                    key={m.id}
                    onClick={() => open({ type: "module", id: m.id })}
                  >
                    {m.name}
                    <span>{m.packages.length} 个工作包 →</span>
                  </button>
                ))}
                {captain && (
                  <div className="button-row">
                    <input
                      aria-label="模块名称"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="新模块名称"
                    />
                    <button
                      disabled={!local || busy}
                      onClick={() => addSchedule()}
                    >
                      创建模块
                    </button>
                  </div>
                )}
                {captain && (
                  <fieldset disabled={!local || busy}>
                    <details>
                      <summary>更多 · JSON 排期</summary>
                      <ModuleManager data={data} onSaved={refresh} />
                    </details>
                    <button
                      disabled={
                        !stage ||
                        liveTasks(data).some(
                          (t) =>
                            t.stageId === stage.id &&
                            (t.startedAt || t.activeJobId || t.doneAt),
                        )
                      }
                      onClick={() =>
                        stage &&
                        run(async () => {
                          const result = await api.replanStage(stage.id);
                          setAlignmentId(result.id);
                          open({ ...target, tab: "alignment" });
                        }, "已提交阶段重编排")
                      }
                    >
                      重编排未开工阶段
                    </button>
                  </fieldset>
                )}
              </>
            )}
            {["alignment", "decisions", "publish"].includes(tab) && (
              <>
                <div className="button-row">
                  {captain && tab === "alignment" && <p className="inline-note">请从顶部「带队向导」开始对齐；向导会检查提案到齐情况，并在跳过缺席成员前展示影响。</p>}
                  <select
                    aria-label="对齐轮次"
                    value={alignment?.id ?? ""}
                    onChange={(e) => setAlignmentId(e.target.value)}
                  >
                    {data.alignments.map((a) => (
                      <option key={a.id} value={a.id}>
                        {new Date(a.createdAt).toLocaleString("zh-CN")} ·{" "}
                        {label(a.status)}
                      </option>
                    ))}
                  </select>
                </div>
                {alignment ? (
                  <fieldset disabled={!local || busy}>
                    <AlignmentView
                      alignment={alignment}
                      data={data}
                      run={run}
                      section={tab as "alignment" | "decisions" | "publish"}
                    />
                    {tab === "publish" && <ContractBoard
                      alignment={alignment}
                      data={data}
                      run={run}
                    />}
                    {tab === "publish" && captain && alignment.status === "READY" && (
                      <button
                        onClick={() =>
                          run(
                            () =>
                              alignment.source === "stage_replan"
                                ? api.activateReplan(alignment.id)
                                : api.publish(alignment.id),
                            "任务已发布",
                          )
                        }
                      >
                        {alignment.source === "stage_replan"
                          ? "确认重编排"
                          : "发布任务"}
                      </button>
                    )}
                  </fieldset>
                ) : (
                  <p>暂无对齐记录。</p>
                )}
              </>
            )}
            {tab === "review" && (
              <>
                {changesList()}
                {review && (
                  <Markdown>
                    {review.summaryMarkdown ?? "等待审核结论"}
                  </Markdown>
                )}
                {reviewActions()}
              </>
            )}
          </>
        )}
      </div>
      {confirmation && <div className="impact-backdrop" role="dialog" aria-modal="true" aria-label="确认操作影响"><section className="impact-dialog">
        <h2>{confirmation.kind === "apply" ? "应用已确认需求变更？" : confirmation.kind === "cancel" ? "取消本轮审核？" : confirmation.kind === "reject" ? "退回本轮需求变更？" : "撤销成员访问？"}</h2>
        {confirmation.kind === "revoke" ? <p>该成员的凭据会失效，运行中的作业将取消。尚未完成的任务：{data.tasks.filter(item => item.assigneeNodeId === confirmation.id && item.status !== "DONE").map(item => item.title).join("、") || "无"}。</p> : <><p>本轮涉及 {review?.changeIds.length ?? 0} 项变更、{review?.affectedTaskIds.length ?? 0} 个受影响任务、{review?.contractUpdates?.length ?? 0} 份契约。</p><p>{confirmation.kind === "apply" ? `获批后可能形成需求 R${data.room.requirementRevision + 1}；相关任务暂停或重编排，契约旧确认失效。` : confirmation.kind === "reject" ? "本轮变更将退回，审核中暂停的任务恢复至原状态。" : "取证作业将取消，变更返回待审队列。"}</p></>}
        <div><button onClick={() => setConfirmation(null)}>返回</button><button className={confirmation.kind === "apply" ? "journey-primary" : "danger"} disabled={busy} onClick={() => {
          const selected = confirmation; setConfirmation(null);
          run(async () => {
            const latest = await api.bootstrap();
            if (selected.kind === "revoke") {
              const before = data.nodes.find(item => item.id === selected.id);
              const current = latest.nodes.find(item => item.id === selected.id);
              const taskState = (value: V20BootstrapPayload) => value.tasks.filter(item => item.assigneeNodeId === selected.id && item.status !== "DONE").map(item => `${item.id}:${item.revision}`).sort().join("|");
              if (!before || !current || before.lastSeenAt !== current.lastSeenAt || taskState(data) !== taskState(latest)) throw new Error("成员或任务状态已变化，请重新查看撤销影响");
              await api.revokeNode(selected.id, Object.fromEntries(data.tasks.filter(item => item.assigneeNodeId === selected.id && item.status !== "DONE").map(item => [item.id, item.revision])));
            } else {
              const current = latest.reviews.find(item => item.id === selected.id);
              if (!review || !current || current.status !== review.status || latest.room.requirementRevision !== data.room.requirementRevision || JSON.stringify(current.affectedTaskIds) !== JSON.stringify(review.affectedTaskIds)) throw new Error("审核证据或需求版本已变化，请重新查看影响");
              if (selected.kind === "apply") await api.applyReview(selected.id);
              else if (selected.kind === "reject") await api.rejectReview(selected.id);
              else await api.cancelReview(selected.id);
            }
          }, selected.kind === "apply" ? "审核已应用" : selected.kind === "cancel" ? "审核已取消" : selected.kind === "reject" ? "审核已退回" : "成员已撤销");
        }}>确认{confirmation.kind === "apply" ? "应用" : confirmation.kind === "cancel" ? "取消审核" : confirmation.kind === "reject" ? "退回" : "撤销成员"}</button></div>
      </section></div>}
      <footer className="inspector-footer">
        {((member && myMember && tab === "changes") || (target.type === "project" && tab === "review")) && (
          <FileButton
            disabled={!local || busy || !stage || stage.status === "COMPLETED"}
            label="提交需求变更"
            onFile={(filename, content) => run(() => api.uploadChange(filename, content), "需求变更已提交")}
          />
        )}
        <span>{busy ? "正在保存…" : "房间数据以 Host 同步为准"}</span>
        <button onClick={close}>关闭</button>
      </footer>
    </aside>
  );
}
