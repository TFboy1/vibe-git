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
      !change ||
      !(captain || change.submitterNodeId === data.viewer.id)
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
    if (change && (captain || change.submitterNodeId === data.viewer.id))
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
      ? [
          ["stage", "阶段概览"],
          ["alignment", "提案对齐"],
          ["decisions", "裁决问题"],
          ["publish", "任务发布"],
          ["review", "变更审核"],
        ]
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
        (!owner || c.submitterNodeId === owner) &&
        (captain || c.submitterNodeId === data.viewer.id),
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
                onClick={() =>
                  run(() => api.cancelReview(review.id), "审核已取消")
                }
              >
                取消审核
              </button>
            )}
          {review?.status === "AWAITING_CAPTAIN" && (
            <>
              <button
                disabled={!local || busy}
                onClick={() =>
                  run(() => api.applyReview(review.id), "审核已应用")
                }
              >
                应用
              </button>
              <button
                disabled={!local || busy}
                onClick={() =>
                  run(() => api.rejectReview(review.id), "审核已退回")
                }
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
          <p className="form-error" role="alert">
            {error}
          </p>
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
                  onClick={() =>
                    run(() => api.revokeNode(member.id), "成员已撤销")
                  }
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
        {change && (captain || change.submitterNodeId === data.viewer.id) && (
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
                  {captain && tab === "alignment" && (
                    <button
                      disabled={
                        !local ||
                        busy ||
                        !data.plans.length ||
                        data.alignments.some((a) =>
                          ["QUEUED", "RUNNING"].includes(a.status),
                        )
                      }
                      onClick={() =>
                        run(async () => {
                          const result = await api.startAlignment();
                          setAlignmentId(result.id);
                        }, "已开始对齐")
                      }
                    >
                      开始对齐
                    </button>
                  )}
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
