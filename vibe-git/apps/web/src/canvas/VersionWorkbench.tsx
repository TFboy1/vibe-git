import { useEffect, useMemo, useState } from "react";
import type { MarkdownDocument, V20BootstrapPayload, VibePullRequest } from "@vibe-git/protocol";
import { api } from "../api";
import { label, type InspectorTarget } from "./model";
import { RecoveryHint } from "./RecoveryHint";

type Props = { data: V20BootstrapPayload; open(target: InspectorTarget): void };
function changedLines(before: string, after: string): Array<{ text: string; type: "same" | "add" | "remove" }> {
  const a = before.split("\n"), b = after.split("\n");
  if (a.length * b.length > 160_000) return [
    ...a.map(text => ({ text, type: "remove" as const })), ...b.map(text => ({ text, type: "add" as const }))
  ];
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const lines: Array<{ text: string; type: "same" | "add" | "remove" }> = []; let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { lines.push({ text: a[i]!, type: "same" }); i++; j++; }
    else if (j < b.length && (i === a.length || table[i]![j + 1]! >= table[i + 1]![j]!)) lines.push({ text: b[j++]!, type: "add" });
    else lines.push({ text: a[i++]!, type: "remove" });
  }
  return lines;
}

export function VersionWorkbench({ data, open }: Props) {
  const [mine, setMine] = useState(true);
  const [visibleRevision, setVisibleRevision] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [document, setDocument] = useState<MarkdownDocument | null>(null);
  const [error, setError] = useState("");
  const viewer = data.viewer.id;
  const relevant = (change: VibePullRequest) => change.submitterNodeId === viewer ||
    Boolean(data.reviews.find(review => review.id === change.reviewId &&
      (review.affectedNodeIds.includes(viewer) || review.affectedTaskIds.some(id => data.tasks.find(task => task.id === id)?.assigneeNodeId === viewer))));
  const changes = [...data.pullRequests].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).filter(change => !mine || relevant(change));
  const selected = data.pullRequests.find(change => change.id === selectedId) ?? changes[0] ?? null;
  const review = data.reviews.find(item => item.id === selected?.reviewId);
  const acceptedInReview = review?.decisions.some(decision => decision.changeId === selected?.id && decision.verdict === "accept") ?? false;
  const base = data.requirementVersions.find(version => version.revision === selected?.baseRequirementRevision)?.markdown ??
    (selected?.baseRequirementRevision === data.room.requirementRevision ? data.room.currentRequirementMarkdown : "");
  const approved = review?.status === "APPLIED" && selected?.status === "APPLIED"
    ? data.requirementVersions.find(version => version.sourceId === review.id)?.markdown ?? "" : "";
  const proposed = selected && acceptedInReview && review?.requirementPatchMarkdown
    ? `${base.trimEnd()}\n\n---\n\n${review.requirementPatchMarkdown.trim()}` : document?.content ?? "";
  const comparison = useMemo(() => changedLines(base, approved || proposed), [base, approved, proposed]);
  useEffect(() => {
    let active = true; setDocument(null); setError("");
    if (selected) void api.document(selected.documentId).then(value => { if (active) setDocument(value); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [selected?.documentId]);
  const submitter = data.nodes.find(node => node.id === selected?.submitterNodeId);
  const currentGit = submitter?.git;
  const linkedTasks = (review?.affectedTaskIds ?? []).flatMap(id => { const task = data.tasks.find(item => item.id === id); return task ? [task] : []; });
  const linkedContracts = data.contracts.filter(contract => linkedTasks.some(task => task.id === contract.providerTaskId || contract.consumerTaskIds.includes(task.id)) ||
    review?.contractUpdates?.some(update => update.contractId === contract.id));
  return <section className="version-workbench"><header><small>版本与变更</small><h1>需求主线与内部 PR</h1><p>在同一处核对需求版本、变更正文和代码元数据。代码分支由成员在本机管理。</p></header>
    <div className="requirement-rail"><strong>需求主线</strong>{data.requirementVersions.length ? data.requirementVersions.map((version, index) => <span key={version.revision}>{index > 0 && <i>→</i>}<button className={visibleRevision === version.revision ? "selected" : ""} onClick={() => setVisibleRevision(version.revision)}>R{version.revision}</button><small>{version.source === "review" ? "审核应用" : "任务发布"}</small></span>) : <span><b>R{data.room.requirementRevision}</b><small>{data.room.requirementRevision ? "现行版本" : "尚未发布"}</small></span>}</div>
    <details className="requirement-current" open><summary>{visibleRevision === null ? `现行需求 R${data.room.requirementRevision}` : `需求 R${visibleRevision}`}</summary><pre>{data.requirementVersions.find(version => version.revision === visibleRevision)?.markdown ?? data.room.currentRequirementMarkdown ?? "尚未发布统一需求"}</pre></details>
    <div className="version-grid"><aside className="change-list"><div className="change-list-head"><h2>需求变更</h2><label><input type="checkbox" checked={mine} onChange={event => { setMine(event.target.checked); setSelectedId(null); }}/>与我有关</label></div>{changes.length ? changes.map(change => <button key={change.id} className={selected?.id === change.id ? "active" : ""} onClick={() => setSelectedId(change.id)}><strong>{data.nodes.find(node => node.id === change.submitterNodeId)?.label ?? "成员"} 的提议</strong><small>基于 R{change.baseRequirementRevision} · {label(change.status)}</small><time>{new Date(change.createdAt).toLocaleString("zh-CN")}</time></button>) : <p>当前筛选下没有变更。可关闭“与我有关”查看全队记录。</p>}</aside>
      <main className="change-detail">{selected ? <>{error && <RecoveryHint error={error}/>}<div className="change-detail-head"><div><small>内部需求 PR · {selected.id}</small><h2>{document?.filename ?? "正在加载变更正文…"}</h2><p>{label(selected.status)} · {submitter?.label ?? "成员"} · 基于 R{selected.baseRequirementRevision}</p></div>{data.viewer.role === "captain" && <button className="journey-primary" onClick={() => open({ type: "change", id: selected.id })}>查看审核与裁决</button>}</div>
      <div className="evidence-grid"><article><small>提交时快照</small><strong>{selected.submittedGit?.branch ?? "待分析"}</strong><code>{selected.submittedGit?.headSha ?? "未取得提交时 SHA"}</code><span>{selected.submittedGit?.observedAt ? new Date(selected.submittedGit.observedAt).toLocaleString("zh-CN") : "未同步 Git"}</span></article><article><small>当前状态</small><strong>{currentGit?.branch ?? "成员离线或未连接"}</strong><code>{currentGit?.headSha ?? "当前 SHA 未知"}</code><span>{currentGit?.observedAt ? new Date(currentGit.observedAt).toLocaleString("zh-CN") : "等待心跳"}</span></article><article><small>审核批次取证</small><strong>{selected.reviewedAt ? "已取证" : "待分析"}</strong><span>{selected.reviewedAt ? new Date(selected.reviewedAt).toLocaleString("zh-CN") : "尚无可靠的文件影响证据"}</span><small>{(selected.reviewedPaths ?? []).length} 个文件路径摘要{(review?.changeIds.length ?? 0) > 1 ? " · 同批次未逐项归因" : ""}</small></article></div>
      <div className="change-content"><section><h3>变更正文</h3><pre>{document?.content ?? (error || "正在加载…")}</pre></section><section><h3>需求差异 · {approved ? "已批准" : selected.status === "REJECTED" ? "已退回" : acceptedInReview && review?.requirementPatchMarkdown ? "拟议修订" : "提交提议"}</h3>{!base && selected.baseRequirementRevision > 0 && <p>基础版本快照缺失，差异待分析。</p>}{acceptedInReview && (review?.requirementPatchMarkdown || approved) ? <pre className="line-diff">{comparison.map((line, index) => <span key={index} className={line.type}>{line.type === "add" ? "+" : line.type === "remove" ? "−" : " "} {line.text}{"\n"}</span>)}</pre> : <pre>{document?.content ?? "提议正文待加载；审核后展示正式需求修订差异。"}</pre>}</section></div>
      {(review?.changeIds.length ?? 0) > 1 && <p className="batch-note">本批次包含多项提议；下方任务、契约与文件证据是审核批次范围，尚未逐项归因。</p>}
      <div className="linked-evidence"><section><h3>关联任务</h3>{linkedTasks.length ? linkedTasks.map(task => <button key={task.id} onClick={() => open({ type: "task", id: task.id })}>{task.title} · {label(task.status)}</button>) : <p>{review?.status === "NEEDS_EVIDENCE" || !review ? "影响范围待分析" : "审核未确认任务影响"}</p>}</section><section><h3>关联契约</h3>{linkedContracts.length ? linkedContracts.map(contract => <p key={contract.id}>{contract.name} · r{contract.revision} · {label(contract.status)}</p>) : <p>尚无确认的契约影响</p>}</section><section><h3>文件路径摘要</h3>{selected.reviewedPaths?.length ? <ul>{selected.reviewedPaths.map(path => <li key={path}><code>{path}</code></li>)}</ul> : <p>待分析；不会上传源码或完整代码差异。</p>}</section></div>
      {!!Object.keys(review?.indexes ?? {}).length && <section className="review-git-evidence"><h3>成员代码快照</h3>{Object.entries(review?.indexes ?? {}).map(([nodeId, index]) => <article key={nodeId}><strong>{data.nodes.find(node => node.id === nodeId)?.label ?? nodeId}</strong><span>审核 SHA <code>{index.headSha}</code></span><span>当前分支 {data.nodes.find(node => node.id === nodeId)?.git?.branch ?? "未知"}</span><small>{index.changedPaths.length ? index.changedPaths.join(" · ") : "轻检未报告变更路径"}</small></article>)}</section>}
      </> : <div className="version-empty"><h2>尚无需求变更</h2><p>开发期间成员可提交 change.md；提交后这里会记录需求脉络与 Git 快照。</p></div>}</main></div>
  </section>;
}
