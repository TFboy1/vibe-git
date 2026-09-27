import { useEffect, useState } from "react";
import type { InterfaceContract, V20BootstrapPayload } from "@vibe-git/protocol";
import { api } from "../api";
import { Markdown } from "../Markdown";
import { ProposalComposer } from "../WorkspacePanels";
import { bridge, type CodexInfo } from "./localApi";
import { liveTasks, type InspectorTarget } from "./model";
import { RecoveryHint } from "./RecoveryHint";

type Props = { data: V20BootstrapPayload; compact?: boolean; local: boolean; open(target: InspectorTarget): void; refresh(): Promise<void> };
type Readiness = Awaited<ReturnType<typeof api.alignmentReadiness>>;
const seenTip = (key: string) => { try { return localStorage.getItem(`vibe-git-tip:${key}`) === "1"; } catch { return false; } };
const markTip = (key: string) => { try { localStorage.setItem(`vibe-git-tip:${key}`, "1"); } catch { /* 向导仍可继续 */ } };

export function JourneyPanel({ data, compact = false, local, open, refresh }: Props) {
  const captain = data.viewer.role === "captain";
  const ownPlan = data.plans.find(plan => plan.ownerNodeId === data.viewer.id);
  const members = data.nodes.filter(node => node.role === "member" && !node.revoked);
  const missing = members.filter(node => !data.plans.some(plan => plan.ownerNodeId === node.id));
  const alignment = data.alignments.at(-1);
  const ownTasks = liveTasks(data).filter(task => task.assigneeNodeId === data.viewer.id);
  const nextTask = ownTasks.find(task => ["PUBLISHED", "READY", "FAILED", "PAUSED", "BLOCKED"].includes(task.status)) ?? ownTasks.find(task => task.status !== "DONE");
  const read = alignment && data.alignmentReads.some(item => item.alignmentId === alignment.id && item.nodeId === data.viewer.id && item.revision === (alignment.draftRevision ?? 0));
  const [composer, setComposer] = useState(false);
  const [invite, setInvite] = useState<Awaited<ReturnType<typeof api.invite>> | null>(null);
  const [codex, setCodex] = useState<CodexInfo | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [showPlan, setShowPlan] = useState(false);
  const [confirmConnect, setConfirmConnect] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tip, setTip] = useState(() => !seenTip("alignment"));
  useEffect(() => { if (!captain && local) void bridge<CodexInfo>("/api/local/codex").then(setCodex).catch(() => {}); }, [captain, local]);
  useEffect(() => setShowPlan(false), [alignment?.id, alignment?.draftRevision]);
  const work = async (fn: () => Promise<void>) => { setBusy(true); setError(""); try { await fn(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } };
  const beginAlignment = () => void work(async () => {
    const status = await api.alignmentReadiness();
    if (status.missing.length) { setReadiness(status); return; }
    await api.startAlignment([], status.requirementRevision);
    markTip("alignment"); setTip(false); await refresh();
  });
  const skipMissing = () => void work(async () => {
    if (!readiness) return;
    await api.startAlignment(readiness.missing.map(item => item.nodeId), readiness.requirementRevision);
    setReadiness(null); markTip("alignment"); setTip(false); await refresh();
  });
  const connect = () => void work(async () => { setCodex(await bridge<CodexInfo>("/api/local/codex/connect", {})); await refresh(); });
  const inviteTeam = () => void work(async () => { setInvite(await api.invite()); });
  const receipt = () => void work(async () => { if (!alignment) return; await api.readAlignment(alignment.id, alignment.draftRevision ?? 0); await refresh(); });

  let title = ""; let detail = ""; let action = ""; let execute = () => {};
  if (captain) {
    if (!ownPlan) { title = "描述项目想法"; detail = "项目描述会成为你的个人提案，供团队对齐使用。"; action = "生成并编辑我的提案"; execute = () => setComposer(true); }
    else if (!members.length) { title = "邀请队友加入"; detail = "把加入命令发给队友；他们在自己的电脑上运行后会出现在房间。"; action = "获取邀请命令"; execute = inviteTeam; }
    else if (alignment && ["QUEUED", "RUNNING"].includes(alignment.status)) { title = "等待 AI 完成对齐"; detail = "已冻结本轮提案快照，结果生成后会显示分歧、任务与契约草稿。"; action = "查看对齐进度"; execute = () => open({ type: "project", id: "project", tab: "alignment" }); }
    else if (alignment?.status === "NEEDS_DECISION") { title = "处理需求分歧"; detail = `${alignment.issues?.filter(issue => !issue.selectedOptionId).length ?? 0} 项分歧等待裁决。`; action = "查看分歧与证据"; execute = () => open({ type: "project", id: "project", tab: "decisions" }); }
    else if (alignment?.status === "READY" && !alignment.publishedStageId) { title = "检查分工并发布"; detail = "AI 已生成任务名称和接口契约草稿。检查负责人、边界与确认状态后发布。"; action = "检查任务与契约"; execute = () => open({ type: "project", id: "project", tab: "publish" }); }
    else if (data.stages.length) {
      const pendingReview = data.reviews.find(item => item.status === "AWAITING_CAPTAIN");
      const blocked = liveTasks(data).find(item => ["BLOCKED", "PAUSED", "FAILED"].includes(item.status));
      const pendingChange = data.pullRequests.find(item => item.status === "QUEUED");
      if (pendingReview) { title = "确认需求审核"; detail = `${pendingReview.affectedTaskIds.length} 项任务已确认受到影响，等待你处理审核结论。`; action = "查看审核结论"; execute = () => open({ type: "project", id: "project", tab: "review" }); }
      else if (blocked) { title = "处理团队阻塞"; detail = `${blocked.title} · ${blocked.blockedReason ?? "需要查看任务与契约状态"}`; action = "查看阻塞任务"; execute = () => open({ type: "task", id: blocked.id }); }
      else if (pendingChange) { title = "查看待审需求变更"; detail = "团队提交了新提议；先查看正文与版本关联，再决定何时审核。"; action = "查看变更"; execute = () => open({ type: "change", id: pendingChange.id }); }
      else { title = "推进团队协作"; detail = "拓扑图显示真实交接、当前任务和待处理变化。"; action = "查看项目状态"; execute = () => open({ type: "project", id: "project" }); }
    }
    else if (missing.length) { title = "等待队友提交方案"; detail = `${missing.map(node => node.label).join("、")} 尚未提交。对齐默认等待全部成员。`; action = "查看缺席影响并对齐"; execute = beginAlignment; }
    else if (!data.stages.length || alignment?.status === "FAILED") { title = "对齐团队提案"; detail = "Codex 会找出真实分歧，并生成任务与协作契约草稿。"; action = "开始需求对齐"; execute = beginAlignment; }
    else { title = "处理团队下一步"; detail = "从人员拓扑查看阻塞、变更与交接。"; action = "查看项目状态"; execute = () => open({ type: "project", id: "project" }); }
  } else if (!local) { title = "连接本机工作环境"; detail = "在自己的 Git 工作区运行 vibe-git open，网页才能连接本机 Codex。"; action = "查看我的连接状态"; execute = () => open({ type: "member", id: data.viewer.id }); }
  else if ((codex?.status ?? data.viewer.codex) !== "available") { title = "连接 Codex"; detail = codex?.reason ?? "安装并登录本机 Codex 后，才能生成提案和开工。"; action = "连接本机 Codex"; execute = () => setConfirmConnect(true); }
  else if (!ownPlan && !data.stages.length) { title = "提出我的方案"; detail = "让 Codex 只读分析工作区，检查和修改个人提案后提交。"; action = "生成并编辑方案"; execute = () => setComposer(true); }
  else if (alignment && ["READY", "PUBLISHED"].includes(alignment.status) && !read) { title = "阅读统一计划"; detail = `队长发布前后的草稿修订会分别记录已读回执；当前是第 ${alignment.draftRevision ?? 0} 版。`; action = showPlan ? "确认已阅读当前版本" : "查看统一计划正文"; execute = showPlan ? receipt : () => setShowPlan(true); }
  else if (nextTask) { title = nextTask.status === "PAUSED" ? "处理暂停任务" : "领取我的任务"; detail = `${nextTask.title} · ${nextTask.status === "PAUSED" ? "等待新需求或契约确认" : "打开任务摘要，检查影响后在本机开工"}`; action = "查看任务与下一步"; execute = () => open({ type: "task", id: nextTask.id }); }
  else if (!ownPlan) { title = "补充我的提案"; detail = "新加入成员可以提交方案，供下一轮需求对齐参考。"; action = "生成个人方案"; execute = () => setComposer(true); }
  else { title = "等待团队分工"; detail = "队长正在对齐方案或发布任务；有新版本时这里会提示你阅读。"; action = "查看统一计划"; execute = () => open({ type: "project", id: "project", tab: "alignment" }); }
  const steps = captain ? ["描述想法", "邀请与收集提案", "处理分歧", "检查分工与契约", "发布并处理变更"] : ["连接 Codex", "提交方案", "阅读统一计划", "领取任务", "提交进度"];
  const highlighted = captain ? !ownPlan ? 0 : !members.length || missing.length ? 1 : alignment?.status === "NEEDS_DECISION" ? 2 : alignment?.status === "READY" ? 3 : 4
    : !local || (codex?.status ?? data.viewer.codex) !== "available" ? 0 : !ownPlan && !data.stages.length ? 1 : !read ? 2 : nextTask ? 3 : 4;
  return <section className={`journey ${compact ? "compact" : "full"}`} aria-label={captain ? "带队向导" : "我的工作向导"}>
    <div className="journey-heading"><small>{compact ? "我的下一步" : captain ? "带队向导" : "我的工作向导"}</small><h1>{title}</h1><p>{detail}</p></div>
    {!compact && <ol className="journey-steps">{steps.map((step, index) => <li key={step} className={index === highlighted ? "current" : index < highlighted ? "complete" : ""}><span>{index + 1}</span>{step}</li>)}</ol>}
    {tip && captain && (action === "开始需求对齐" || action === "查看缺席影响并对齐") && <p className="journey-tip">首次对齐会冻结当前提案版本，并由 AI 提取分歧与任务草稿。<button onClick={() => { markTip("alignment"); setTip(false); }}>知道了</button></p>}
    <button className="journey-primary" disabled={busy} onClick={execute}>{busy ? "处理中…" : action}</button>
    {invite && <div className="journey-invite"><p>请队友在自己的工作区运行：</p><code>{invite.command}</code><button onClick={() => void navigator.clipboard.writeText(invite.command)}>复制加入命令</button>{!data.tunnel?.running && <p>远程链接不可用：Cloudflare Tunnel 未连接。队长可在顶部邀请设置中启动 Tunnel。</p>}</div>}
    {captain && missing.some(node => !node.connected) && !compact && <p className="journey-tip">有队友离线：请他们在自己的电脑运行 <code>vibe-git open</code> 并提交提案。确实缺席时可查看影响后显式跳过。</p>}
    {alignment && showPlan && !captain && ["READY", "PUBLISHED"].includes(alignment.status) && <div className="journey-plan"><strong>统一计划 · 草稿第 {alignment.draftRevision ?? 0} 版</strong><Markdown>{alignment.alignmentMarkdown ?? ""}</Markdown></div>}
    {error && <RecoveryHint error={error} />}
    {readiness && <div className="impact-backdrop" role="dialog" aria-modal="true" aria-label="跳过缺席成员的影响"><section className="impact-dialog"><h2>跳过缺席成员？</h2><p>本轮将不纳入以下成员的提案，也不会给他们分配任务；之后提交的方案需要下一轮对齐。当前需求 R{readiness.requirementRevision}。</p><ul>{readiness.missing.map(item => <li key={item.nodeId}>{item.label} · {item.connected ? "在线但未提交" : "离线且未提交"}</li>)}</ul><div><button onClick={() => setReadiness(null)}>继续等待</button><button className="danger" disabled={busy} onClick={skipMissing}>确认跳过并对齐</button></div></section></div>}
    {confirmConnect && <div className="impact-backdrop" role="dialog" aria-modal="true" aria-label="确认连接本机 Codex"><section className="impact-dialog"><h2>连接本机 Codex？</h2><p>将启动本机 Codex 的连接或登录流程；若未安装，请先安装并登录。此操作只在当前电脑执行。</p><div><button onClick={() => setConfirmConnect(false)}>取消</button><button className="journey-primary" onClick={() => { setConfirmConnect(false); connect(); }}>确认连接</button></div></section></div>}
    {composer && <ProposalComposer data={data} current={ownPlan} onClose={() => setComposer(false)} onSaved={refresh}/>}
  </section>;
}

export function AdvancedWorkspace({ data, open, refresh }: Omit<Props, "compact" | "local">) {
  const [editing, setEditing] = useState<InterfaceContract | null>(null);
  const [form, setForm] = useState<Pick<InterfaceContract, "name" | "signature" | "behavior" | "examples" | "errors" | "testCommand" | "handoff"> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const alignment = data.alignments.at(-1);
  const tasks = liveTasks(data);
  const change = (contract: InterfaceContract) => { setEditing(contract); setForm({ name: contract.name, signature: contract.signature, behavior: contract.behavior, examples: contract.examples, errors: contract.errors, testCommand: contract.testCommand, handoff: contract.handoff }); };
  const save = async () => { if (!editing || !form) return; setBusy(true); setError(""); try { await api.reviseDraftContract(editing, form); setEditing(null); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } };
  return <section className="advanced-workspace"><header><small>高级模式</small><h1>完整任务看板与依赖</h1><p>查看所有任务、真实交接和接口契约草稿。契约修订会清除旧确认并重新细化相关工作。</p></header>
    <div className="advanced-grid"><section><h2>任务看板</h2>{tasks.length ? tasks.map(task => <button className="advanced-task" key={task.id} onClick={() => open({ type: "task", id: task.id })}><strong>{task.title}</strong><span>{data.nodes.find(node => node.id === task.assigneeNodeId)?.label} · {task.status}</span><small>{(task.dependencyEdges ?? []).map(edge => `${edge.mode === "HARD" ? "硬等待" : "契约交接"} ${tasks.find(t => t.id === edge.upstreamTaskId)?.title ?? edge.upstreamTaskId}`).join("；") || "无上游依赖"}</small></button>) : alignment?.tasks.length ? alignment.tasks.map(task => <button className="advanced-task" key={task.id} onClick={() => open({ type: "project", id: "project", tab: "publish" })}><strong>{task.title}</strong><span>{data.nodes.find(node => node.id === task.assigneeNodeId)?.label} · 待发布草稿</span><small>{(task.dependencyEdges ?? []).map(edge => `${edge.mode === "HARD" ? "硬等待" : "契约交接"} ${alignment.tasks.find(item => item.id === edge.upstreamTaskId)?.title ?? edge.upstreamTaskId}`).join("；") || "无上游依赖"}</small></button>) : <p>尚无任务。队长完成需求对齐后可从向导检查并发布。</p>}</section><section><h2>协作契约</h2>{data.contracts.filter(item => item.alignmentId === alignment?.id).map(contract => <article className="advanced-contract" key={contract.id}><strong>{contract.name} · r{contract.revision}</strong><p>{contract.signature}</p><small>{contract.status} · {contract.acknowledgedNodeIds.length} 人已确认</small>{data.viewer.role === "captain" && !contract.stageId && alignment?.status === "READY" && <button onClick={() => change(contract)}>编辑草稿</button>}</article>)}{!data.contracts.length && <p>对齐后会生成接口契约草稿。</p>}</section></div>
    {alignment && <details className="advanced-versions"><summary>对齐草稿版本与已读记录 · 第 {alignment.draftRevision ?? 0} 版</summary>{data.alignmentDraftVersions.filter(item => item.alignmentId === alignment.id).map(version => <article key={version.revision}><strong>草稿 r{version.revision}</strong><span>{new Date(version.createdAt).toLocaleString("zh-CN")} · {data.nodes.find(node => node.id === version.editorNodeId)?.label ?? "Agent"}</span><small>{version.tasks.map(task => task.title).join("、")}</small></article>)}<p>本版已阅读：{data.alignmentReads.filter(item => item.alignmentId === alignment.id && item.revision === (alignment.draftRevision ?? 0)).map(item => data.nodes.find(node => node.id === item.nodeId)?.label ?? item.nodeId).join("、") || "暂无"}</p></details>}
    {editing && form && <div className="impact-backdrop" role="dialog" aria-modal="true" aria-label="编辑契约草稿"><section className="impact-dialog contract-editor"><h2>编辑 {editing.name}</h2><p>保存后版本升级，旧确认失效，相关工作主线重新细化。</p>{(["name", "signature", "testCommand", "handoff"] as const).map(key => <label key={key}>{key}<input value={form[key]} onChange={event => setForm({ ...form, [key]: event.target.value })}/></label>)}{(["behavior", "examples", "errors"] as const).map(key => <label key={key}>{key}<textarea value={form[key].join("\n")} onChange={event => setForm({ ...form, [key]: event.target.value.split("\n").filter(Boolean) })}/></label>)}{error && <RecoveryHint error={error}/>}<div><button onClick={() => setEditing(null)}>取消</button><button className="journey-primary" disabled={busy} onClick={() => void save()}>保存新版本</button></div></section></div>}
  </section>;
}
