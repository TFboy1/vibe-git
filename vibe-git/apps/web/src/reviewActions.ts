import type { AlignmentRun, StageTask } from "@vibe-git/protocol";
import type { ReviewState } from "./reviewFixture";

const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const fail = (error: string, status = 409) => reply({ error }, status);
const now = () => new Date().toISOString();
let serial = 10;
const next = (prefix: string) => `${prefix}-${++serial}`;
const conversations = new Map<string, string[]>();
const pending = new Map<string, { at: number; status: StageTask["status"] }>();

export function initializeReviewTasks(state: ReviewState) {
  for (const task of state.tasks) if (task.status === "IN_PROGRESS") { task.activeJobId = next("job"); }
}
export function advanceReviewTasks(state: ReviewState) {
  let changed = false;
  for (const [id, step] of pending) {
    if (step.at > Date.now()) continue;
    const task = state.tasks.find(item => item.id === id);
    pending.delete(id);
    if (!task || !task.activeJobId) continue;
    changed = true; task.status = step.status;
    task.updatedAt = now();
    if (step.status === "IN_PROGRESS") pending.set(id, { at: Date.now() + 2200, status: task.dependencyEdges?.some(edge => edge.mode === "CONTRACT") ? "WAITING_INTEGRATION" : "WAITING_CONFIRMATION" });
    else { task.activeJobId = null; task.finishedAt = now(); }
  }
  return changed;
}

export function reviewAction(state: ReviewState, viewerId: string, captain: boolean, path: string, method: string, body: Record<string, unknown>): Response | null {
  const task = /^\/api\/(?:v1\/tasks|local\/chat)\/([^/]+)\/(detail|start|sync|done|integrate|finalize)$/.exec(path);
  const chat = /^\/api\/local\/chat\/([^/]+)$/.exec(path);
  if (path === "/api/local/capabilities") return reply({ local: true, chat: true });
  if (chat && method === "POST") {
    const target = state.tasks.find(item => item.id === chat[1]);
    if (!target || target.assigneeNodeId !== viewerId) return fail("只能细化自己的切片", 403);
    const question = String(body.message ?? "").trim();
    if (!question) return fail("请输入要讨论的内容", 400);
    conversations.set(target.id, [...(conversations.get(target.id) ?? []), question]);
    const answer = `## ${target.title}\n\n先核对交付物：${target.brief?.deliverables.join("、") ?? target.goal}。\n\n1. 在负责目录 ${target.brief?.ownedPaths.join("、")} 内实现。\n2. 对照冻结契约检查成功与错误分支。\n3. ${target.brief?.integrationSteps.join("；")}。\n\n验证：${target.brief?.verificationCommands.join("；")}。\n\n本次关注：${question}`;
    return new Response(`data: ${JSON.stringify({ type: "delta", value: answer })}\n\ndata: ${JSON.stringify({ type: "done", value: answer })}\n\n`, { headers: { "content-type": "text/event-stream" } });
  }
  if (task && method === "POST") {
    const target = state.tasks.find(item => item.id === task[1]);
    if (!target) return fail("切片不存在", 404);
    if (target.assigneeNodeId !== viewerId) return fail("只有负责人可以操作", 403);
    const action = task[2];
    if (action === "finalize") return reply({ steps: ["核对正式任务和接口版本", "完成负责目录内的实现", "执行测试并保存交接记录"], files: target.brief?.ownedPaths ?? [], mockUsage: target.brief?.mockStrategy ?? "不需要接口替身", validation: target.brief?.verificationCommands ?? [], notes: conversations.get(target.id)?.at(-1) ?? "正式目标与验收保持不变。" });
    if (action === "detail") {
      if (!["PUBLISHED", "REFINING", "READY", "FAILED", "PAUSED"].includes(target.status)) return fail("切片开工后不能修改执行细化");
      const content = String(body.content ?? ""); const filename = String(body.filename ?? "");
      if (!content.trim() || !/\.md$/i.test(filename)) return fail("请选择 Markdown 文件", 400);
      const previous = state.documents.filter(item => item.kind === "task_detail" && item.entityId === target.id);
      const document = { id: next("detail"), kind: "task_detail" as const, ownerNodeId: viewerId, entityId: target.id, filename, content, revision: previous.length + 1, bytes: new TextEncoder().encode(content).length, sha256: "a".repeat(64), createdAt: now() };
      state.documents.push(document); target.detailDocumentId = document.id; target.status = "READY"; target.revision++;
      return reply(document);
    }
    if (action === "sync") {
      target.lastGit = state.nodes.find(node => node.id === viewerId)!.git;
      if (target.status === "IN_PROGRESS") { target.status = target.dependencyEdges?.some(e => e.mode === "CONTRACT") ? "WAITING_INTEGRATION" : "WAITING_CONFIRMATION"; target.activeJobId = null; target.finishedAt=now(); pending.delete(target.id); }
      return reply(target);
    }
    if (action === "start") {
      if (!["PUBLISHED", "READY", "FAILED"].includes(target.status)) return fail("当前状态不能开工");
      if (state.tasks.some(item => item.assigneeNodeId === viewerId && item.activeJobId)) return fail("本机已有切片正在执行");
      for (const edge of target.dependencyEdges ?? []) {
        const upstream = state.tasks.find(item => item.id === edge.upstreamTaskId);
        if (!upstream || (edge.mode === "HARD" && upstream.status !== "DONE")) return fail("上游切片尚未完成");
        const contract = state.contracts.find(item => item.id === edge.contractId);
        if (edge.mode === "CONTRACT" && (!contract || contract.status !== "PUBLISHED" || contract.revision !== edge.contractRevision)) return fail("接口契约尚未冻结当前版本");
      }
      target.status = target.dependencyEdges?.some(edge => edge.mode === "CONTRACT") ? "PREPARING_MOCK" : "STARTING";
      target.startedAt = now(); target.activeJobId = next("job"); pending.set(target.id, { at: Date.now() + 1200, status: "IN_PROGRESS" });
    }
    if (action === "integrate") {
      if (target.status !== "WAITING_INTEGRATION" || target.activeJobId) return fail("当前状态不能开始集成");
      const edges = target.dependencyEdges?.filter(edge => edge.mode === "CONTRACT") ?? [];
      if (edges.some(edge => { const upstream = state.tasks.find(item => item.id === edge.upstreamTaskId); return upstream?.status !== "DONE" || !upstream.lastGit?.headSha; })) return fail("等待提供方交接代码提交");
      const contracts = edges.map(edge => state.contracts.find(item => item.id === edge.contractId)!);
      if (contracts.some((item, i) => !item || item.status !== "PUBLISHED" || item.revision !== edges[i]!.contractRevision)) return fail("接口版本已变化");
      target.integrationEvidence = { contractHashes: Object.fromEntries(contracts.map(item => [item.id, item.sha256])), headSha: state.nodes.find(node => node.id === viewerId)!.git!.headSha!, verifiedAt: now(), summary: "真实接口与错误分支验证通过" };
      target.activeJobId = next("integration"); pending.set(target.id, { at: Date.now() + 1200, status: "WAITING_CONFIRMATION" });
    }
    if (action === "done") {
      if (target.status !== "WAITING_CONFIRMATION") return fail("执行与集成未完成");
      if (target.dependencyEdges?.some(edge => edge.mode === "CONTRACT") && !target.integrationEvidence) return fail("尚未验证真实集成");
      target.status = "DONE"; target.doneAt = now(); target.lastGit = state.nodes.find(node => node.id === viewerId)!.git;
    }
    target.updatedAt = now(); target.revision++; return reply(target);
  }
  const contractRoute = /^\/api\/v1\/contracts\/([^/]+)\/(ack|publish)$/.exec(path);
  if (contractRoute && method === "POST") {
    const contract = state.contracts.find(item => item.id === contractRoute[1]);
    if (!contract) return fail("接口不存在", 404);
    if (body.expectedRevision !== contract.revision || body.sha256 !== contract.sha256) return fail("契约版本已变化，请刷新");
    if (contract.status !== "DRAFT") return fail("该版本已经冻结");
    const tasks = contract.stageId ? state.tasks : state.alignments.find(item => item.id === contract.alignmentId)?.tasks ?? [];
    const participants = [...new Set(tasks.filter(item => item.id === contract.providerTaskId || contract.consumerTaskIds.includes(item.id)).map(item => item.assigneeNodeId))];
    if (contractRoute[2] === "ack") {
      if (!participants.includes(viewerId)) return fail("只有契约双方可以确认", 403);
      if (!contract.acknowledgedNodeIds.includes(viewerId)) contract.acknowledgedNodeIds.push(viewerId);
    } else {
      if (!captain) return fail("只有队长可以发布", 403);
      if (!participants.length || participants.some(id => !contract.acknowledgedNodeIds.includes(id))) return fail("等待契约双方确认");
      contract.status = "PUBLISHED";
    }
    return reply(contract);
  }
  const replan = /^\/api\/v1\/stages\/([^/]+)\/replan$/.exec(path);
  if ((path === "/api/v1/alignments" || replan) && method === "POST") {
    if (!captain) return fail("只有队长可以分配工作", 403);
    if (replan && state.tasks.some(item => item.stageId === replan[1] && !item.archived && (item.startedAt || item.activeJobId || item.doneAt))) return fail("已有切片开工，请通过需求变更处理");
    if (state.alignments.some(item => ["QUEUED", "RUNNING", "READY", "NEEDS_DECISION"].includes(item.status))) return fail("已有一轮对齐待处理");
    const aligned: AlignmentRun = structuredClone(state.alignment);
    aligned.id = next("alignment"); aligned.status = "READY"; aligned.source = replan ? "stage_replan" : "plans";
    aligned.createdAt = now(); aligned.publishedStageId = null; aligned.completedAt = now();
    if (replan) aligned.replanStageId = replan[1]!;
    aligned.planSnapshot = state.documents.filter(item => item.kind === "plan" && !state.withdrawnOwners.has(item.ownerNodeId)).filter((item, _, list) => !list.some(other => other.ownerNodeId === item.ownerNodeId && other.revision > item.revision)).map(item => ({ nodeId: item.ownerNodeId, documentId: item.id, revision: item.revision, sha256: item.sha256 }));
    if (!aligned.planSnapshot.length) return fail("至少需要一份提案");
    aligned.planImpacts = aligned.planSnapshot.map(item => ({ documentId: item.documentId, moduleIds: state.modules.map(module => module.id), rationale: "提案涉及房间协作、任务交接与成员页面。" }));
    aligned.moduleRevisionSnapshot = state.moduleRevision;
    aligned.tasks = state.tasks.filter(item => !item.archived).map(item => ({ id: item.id, title: item.title, goal: item.goal, boundary: item.boundary, acceptance: item.acceptance, dependencies: [...item.dependencies], dependencyEdges: structuredClone(item.dependencyEdges ?? []), ...(item.brief ? { brief: structuredClone(item.brief) } : {}), assigneeNodeId: item.assigneeNodeId, sourcePlanNodeIds: item.sourcePlanNodeIds }));
    for (const contract of state.contracts.filter(item => item.alignmentId === state.alignment.id)) {
      const copied = { ...structuredClone(contract), id: next("contract"), alignmentId: aligned.id, stageId: null, acknowledgedNodeIds: [], status: "DRAFT" as const };
      aligned.tasks.forEach(task => task.dependencyEdges?.forEach(edge => { if (edge.contractId === contract.id) edge.contractId = copied.id; })); state.contracts.push(copied);
    }
    state.alignments.push(aligned); return reply(aligned);
  }
  const alignmentRoute = /^\/api\/v1\/alignments\/([^/]+)\/(assign|downgrade|publish|activate-replan|resolve)$/.exec(path);
  if (alignmentRoute && method === "POST") {
    if (!captain) return fail("只有队长可以操作", 403);
    const alignment = state.alignments.find(item => item.id === alignmentRoute[1]); if (!alignment) return fail("对齐记录不存在", 404);
    const action = alignmentRoute[2];
    if (action === "resolve") {
      if (body.expectedRevision !== (alignment.decisionRevision ?? 0)) return fail("裁决版本已变化");
      const issue = alignment.issues?.find(item => item.id === body.issueId); if (!issue?.options.some(item => item.id === body.optionId)) return fail("裁决选项不存在");
      issue.selectedOptionId = String(body.optionId); alignment.decisionRevision = (alignment.decisionRevision ?? 0) + 1;
      if (alignment.issues?.every(item => item.selectedOptionId)) alignment.status = "READY"; return reply(alignment);
    }
    if (alignment.status !== "READY") return fail("对齐稿尚未就绪");
    if (action === "assign" || action === "downgrade") {
      const task = alignment.tasks.find(item => item.id === body.taskId); if (!task) return fail("草稿切片不存在");
      if (action === "assign") {
        if (!state.nodes.some(item => item.id === body.assigneeNodeId)) return fail("成员不存在");
        task.assigneeNodeId = String(body.assigneeNodeId);
        state.contracts.filter(item => item.alignmentId === alignment.id && (item.providerTaskId === task.id || item.consumerTaskIds.includes(task.id))).forEach(item => { item.acknowledgedNodeIds = []; });
      } else {
        const edge = task.dependencyEdges?.find(item => item.upstreamTaskId === body.upstreamTaskId); if (!edge) return fail("依赖不存在");
        edge.mode = "HARD"; edge.contractId = null; edge.contractRevision = null;
      }
      return reply(alignment);
    }
    for (const task of alignment.tasks) for (const edge of task.dependencyEdges ?? []) {
      if (edge.mode !== "CONTRACT") continue;
      const contract = state.contracts.find(item => item.id === edge.contractId)!;
      const participants = alignment.tasks.filter(item => item.id === contract.providerTaskId || contract.consumerTaskIds.includes(item.id));
      if (participants.some(item => !contract.acknowledgedNodeIds.includes(item.assigneeNodeId))) return fail("请双方先确认接口契约，或降为硬依赖");
    }
    if (action === "activate-replan" && state.tasks.some(item => item.stageId === alignment.replanStageId && (item.startedAt || item.activeJobId))) return fail("旧任务已开工，不能重编排");
    const stageId = alignment.replanStageId ?? next("stage");
    const stage = { ...structuredClone(state.stage), id: stageId, sequence: alignment.replanStageId ? state.stage.sequence : state.stages.length + 1, sourceAlignmentId: alignment.id, requirementRevision: state.stage.requirementRevision + (alignment.replanStageId ? 0 : 1), createdAt: now(), completedAt: null, reviewId: null, status: "ACTIVE" as const };
    if (alignment.replanStageId) state.tasks.filter(item => item.stageId === stageId).forEach(item => { item.archived = true; });
    const taskIds = new Map(alignment.tasks.map(item => [item.id, next("task")]));
    alignment.tasks.forEach(item => state.tasks.push({ ...structuredClone(item), id: taskIds.get(item.id)!, stageId, dependencies: item.dependencies.map(id => taskIds.get(id) ?? id), dependencyEdges: (item.dependencyEdges ?? []).map(edge => ({ ...edge, upstreamTaskId: taskIds.get(edge.upstreamTaskId) ?? edge.upstreamTaskId })), status: "PUBLISHED", revision: 1, detailDocumentId: null, activeJobId: null, runtimeId: null, lastGit: null, publishedAt: now(), startedAt: null, finishedAt: null, doneAt: null, updatedAt: now() }));
    state.contracts.filter(item => item.alignmentId === alignment.id).forEach(item => { item.stageId = stageId; item.status = "PUBLISHED"; item.providerTaskId = taskIds.get(item.providerTaskId)!; item.consumerTaskIds = item.consumerTaskIds.map(id => taskIds.get(id)!); });
    for (const owner of state.nodes) { const tasks = state.tasks.filter(item => item.stageId === stageId && item.assigneeNodeId === owner.id && !item.archived); if (tasks.length) state.workstreams.push({ id: next("work"), alignmentId: alignment.id, stageId, ownerNodeId: owner.id, mission: `${owner.label}的阶段工作`, boundary: tasks.map(item => item.boundary).join("；"), taskIds: tasks.map(item => item.id), revision: 1, status: "PUBLISHED" }); }
    const index = state.stages.findIndex(item => item.id === stageId); if (index < 0) state.stages.push(stage); else state.stages[index] = stage;
    state.modules.forEach(module => module.packages.forEach(pack => { pack.taskIds = pack.taskIds.map(id => taskIds.get(id) ?? id); }));
    state.moduleRevision++;
    state.stage = stage; state.alignment = alignment; alignment.status = "PUBLISHED"; alignment.publishedStageId = stageId;
    return reply(stage);
  }
  return null;
}
