import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CollaborationNode, JobResultInput, NodeHeartbeatInput, ProjectModule } from "@vibe-git/protocol";
import { badRequest, forbidden, notFound, unavailable } from "../domain/errors.js";
import type { CloudflareManager } from "../integrations/cloudflare/manager.js";
import type { V20Service } from "./service.js";
import { taskMarkdown, workstreamMarkdown } from "./contract-format.js";

type MarkdownBody = { filename?: string; content?: string };
type PlanUpdateBody = MarkdownBody & { expectedRevision?: number };

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function publicBase(request: FastifyRequest): string {
  const forwardedProto = firstHeader(request.headers["x-forwarded-proto"]);
  const forwardedHost = firstHeader(request.headers["x-forwarded-host"]);
  const protocol = forwardedProto?.split(",")[0]?.trim() || (request.protocol === "https" ? "https" : "http");
  const host = forwardedHost?.split(",")[0]?.trim() || request.headers.host;
  if (!host || !/^[a-z0-9.\-:[\]]+(?::\d+)?$/i.test(host)) throw badRequest("无法确定 Host 地址");
  return `${protocol}://${host}`;
}

function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.replace(/^::ffff:/, "");
  return normalized === "127.0.0.1" || normalized === "::1";
}

function authenticate(request: FastifyRequest, service: V20Service): CollaborationNode {
  const authorization = firstHeader(request.headers.authorization);
  if (authorization) return service.authenticateBearer(authorization);
  if (request.method !== "GET" && request.method !== "HEAD")
    throw forbidden("远端面板仅可查看状态；请在成员自己的电脑运行 vibe-git open 操作");
  return service.authenticateSession(firstHeader(request.headers.cookie));
}

function requireCaptain(node: CollaborationNode): void {
  if (node.role !== "captain") throw forbidden("该操作仅限队长");
}

function markdownBody(body: MarkdownBody | undefined, purpose: string): { filename: string; content: string } {
  if (!body || typeof body.filename !== "string" || typeof body.content !== "string") {
    throw badRequest(`请上传 UTF-8 Markdown 作为${purpose}`);
  }
  return { filename: body.filename, content: body.content };
}

async function tunnelOperation(work: () => Promise<unknown>): Promise<unknown> {
  try { return await work(); }
  catch (error) { throw unavailable(error instanceof Error ? error.message : String(error)); }
}

export async function registerV20Routes(app: FastifyInstance, service: V20Service, cloudflare: CloudflareManager): Promise<void> {
  app.get("/health", async () => ({ ok: true, service: "vibe-git-host", version: "0.20", time: new Date().toISOString() }));

  app.post<{ Body: { invite?: string } }>("/api/v1/join", async (request) => {
    if (!request.body?.invite) throw badRequest("缺少加入密钥");
    return service.join(request.body.invite, publicBase(request));
  });

  app.get<{ Params: { ticket: string } }>("/session/:ticket", async (request, reply) => {
    const exchanged = service.exchangeBrowserTicket(request.params.ticket);
    const secure = publicBase(request).startsWith("https://") ? "; Secure" : "";
    reply.header("Set-Cookie", `vibe_session=${encodeURIComponent(exchanged.session)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`);
    return reply.redirect("/");
  });

  app.get("/api/v1/bootstrap", async (request) => service.bootstrap(authenticate(request, service)));
  app.post<{ Body: NodeHeartbeatInput }>("/api/v1/nodes/heartbeat", async (request) => service.heartbeat(authenticate(request, service), request.body));

  app.get("/api/v1/modules", async (request) => { authenticate(request, service); return service.modules(); });
  app.put<{ Body: { expectedRevision?: number; items?: ProjectModule[] } }>("/api/v1/modules", async (request) => {
    const node = authenticate(request, service);
    if (!Number.isInteger(request.body?.expectedRevision) || !Array.isArray(request.body?.items)) throw badRequest("模块修订或内容无效");
    return service.setModules(node, Number(request.body.expectedRevision), request.body.items);
  });
  app.get<{ Querystring: { limit?: string; offset?: string } }>("/api/v1/plans/history", async (request) => {
    authenticate(request, service);
    return service.planHistory(request.query.limit === undefined ? 100 : Number(request.query.limit), request.query.offset === undefined ? 0 : Number(request.query.offset));
  });
  app.post<{ Body: MarkdownBody }>("/api/v1/plans", async (request) => {
    const body = markdownBody(request.body, "计划");
    return service.submitPlan(authenticate(request, service), body.filename, body.content);
  });
  app.put<{ Params: { id: string }; Body: PlanUpdateBody }>("/api/v1/plans/:id", async (request) => {
    const body = markdownBody(request.body, "计划更新");
    const expectedRevision = request.body?.expectedRevision;
    if (!Number.isInteger(expectedRevision) || Number(expectedRevision) < 1) throw badRequest("缺少有效的 expectedRevision");
    return service.updatePlan(authenticate(request, service), request.params.id, Number(expectedRevision), body.filename, body.content);
  });
  app.post<{ Params: { id: string }; Body: { expectedRevision?: number } }>("/api/v1/plans/:id/restore", async (request) => {
    if (!Number.isInteger(request.body?.expectedRevision) || Number(request.body.expectedRevision) < 0) throw badRequest("缺少有效的 expectedRevision");
    return service.restorePlan(authenticate(request, service), request.params.id, Number(request.body.expectedRevision));
  });
  app.delete<{ Params: { id: string }; Body: { expectedRevision?: number } }>("/api/v1/plans/:id", async (request) => {
    if (!Number.isInteger(request.body?.expectedRevision)) throw badRequest("缺少有效的 expectedRevision");
    return service.withdrawPlan(authenticate(request, service), request.params.id, Number(request.body.expectedRevision));
  });
  app.post<{ Params: { id: string }; Body: MarkdownBody }>("/api/v1/tasks/:id/detail", async (request) => {
    const body = markdownBody(request.body, "任务细化");
    return service.submitTaskDetail(authenticate(request, service), request.params.id, body.filename, body.content);
  });
  app.get<{ Params: { id: string } }>("/api/v1/tasks/:id/detail", async (request) => {
    const node = authenticate(request, service);
    const task = service.repo.getTask(request.params.id);
    if (!task) throw notFound("任务不存在");
    if (node.role !== "captain" && task.assigneeNodeId !== node.id) throw forbidden("不能查看其他成员的任务详情");
    const detail = task.detailDocumentId ? service.repo.getDocument(task.detailDocumentId) ?? null : null;
    return {
      task,
      detail,
      markdown: task.brief ? `${taskMarkdown(task, task.dependencyEdges, service.repo.listContracts())}${detail ? `\n\n---\n\n## 成员执行细节（${detail.filename} r${detail.revision}）\n\n${detail.content}` : ""}` : [
        `# ${task.title}`,
        "",
        "## 正式目标（不可由任务细化 Markdown 修改）",
        task.goal,
        "",
        "## 边界",
        task.boundary,
        "",
        "## 验收",
        ...task.acceptance.map((item) => `- ${item}`),
        "",
        "## 依赖",
        ...(task.dependencies.length ? task.dependencies.map((item) => `- ${item}`) : ["- 无"]),
        detail ? `\n---\n\n## 成员执行细节（${detail.filename} r${detail.revision}）\n\n${detail.content}` : ""
      ].filter(Boolean).join("\n")
    };
  });
  app.post<{ Params: { id: string } }>("/api/v1/notifications/:id/read", async (request) => service.readNotification(authenticate(request, service), request.params.id));

  app.post<{ Body: MarkdownBody }>("/api/v1/pull-requests", async (request) => {
    const body = markdownBody(request.body, "需求变更");
    return service.submitPullRequest(authenticate(request, service), body.filename, body.content);
  });
  app.get("/api/v1/pull-requests", async (request) => {
    const viewer = authenticate(request, service);
    return service.repo.listPullRequests().filter(change => viewer.role === "captain" || change.submitterNodeId === viewer.id);
  });
  app.get<{ Params: { id: string } }>("/api/v1/documents/:id", async (request) => {
    const viewer = authenticate(request, service);
    const document = service.repo.getDocument(request.params.id);
    if (!document) throw notFound("文档不存在");
    if (document.kind !== "plan" && viewer.role !== "captain" && document.ownerNodeId !== viewer.id) throw forbidden("只能查看自己的需求变更和执行细化");
    return document;
  });

  app.post("/api/v1/alignments", async (request) => service.startAlignment(authenticate(request, service)));
  app.post<{ Params: { id: string }; Body: { issueId?: string; optionId?: string; expectedRevision?: number } }>("/api/v1/alignments/:id/resolve", async (request) => {
    const { issueId, optionId, expectedRevision } = request.body ?? {};
    if (!issueId || !optionId || !Number.isInteger(expectedRevision)) throw badRequest("缺少冲突、选项或裁决版本");
    return service.resolveAlignmentIssue(authenticate(request, service), request.params.id, issueId, optionId, expectedRevision!);
  });
  app.post<{ Params: { id: string }; Body: { taskId?: string; assigneeNodeId?: string } }>("/api/v1/alignments/:id/assign", async (request) => {
    if (!request.body?.taskId || !request.body.assigneeNodeId) throw badRequest("缺少 taskId 或 assigneeNodeId");
    return service.assignDraftTask(authenticate(request, service), request.params.id, request.body.taskId, request.body.assigneeNodeId);
  });
  app.post<{ Params: { id: string }; Body: { expectedRevision?: number; sha256?: string } }>("/api/v1/contracts/:id/ack", async (request) => {
    const { expectedRevision, sha256 } = request.body ?? {};
    if (!Number.isInteger(expectedRevision) || typeof sha256 !== "string") throw badRequest("缺少契约版本或哈希");
    return service.acknowledgeContract(authenticate(request, service), request.params.id, expectedRevision!, sha256);
  });
  app.post<{ Params: { id: string }; Body: { expectedRevision?: number; sha256?: string } }>("/api/v1/contracts/:id/publish", async (request) => {
    const { expectedRevision, sha256 } = request.body ?? {};
    if (!Number.isInteger(expectedRevision) || typeof sha256 !== "string") throw badRequest("缺少契约版本或哈希");
    return service.publishRevisedContract(authenticate(request, service), request.params.id, expectedRevision!, sha256);
  });
  app.post<{ Params: { id: string }; Body: { taskId?: string; upstreamTaskId?: string } }>("/api/v1/alignments/:id/downgrade", async (request) => {
    if (!request.body?.taskId || !request.body.upstreamTaskId) throw badRequest("缺少任务或上游 ID");
    return service.downgradeDependency(authenticate(request, service), request.params.id, request.body.taskId, request.body.upstreamTaskId);
  });
  app.get<{ Params: { id: string } }>("/api/v1/workstreams/:id/brief", async (request, reply) => {
    const node = authenticate(request, service);
    const workstream = service.repo.getWorkstream(request.params.id);
    if (!workstream) throw notFound("工作主线不存在");
    if (node.role !== "captain" && node.id !== workstream.ownerNodeId) throw forbidden("只能下载自己的工作主线");
    reply.type("text/markdown; charset=utf-8");
    const tasks = workstream.taskIds.flatMap((id) => { const task = service.repo.getTask(id); return task ? [task] : []; });
    return workstreamMarkdown(workstream, tasks, service.repo.listContracts(workstream.alignmentId));
  });
  app.post<{ Params: { id: string } }>("/api/v1/alignments/:id/publish", async (request) => service.publishAlignment(authenticate(request, service), request.params.id));
  app.post<{ Params: { id: string } }>("/api/v1/stages/:id/replan", async (request) => service.startStageReplan(authenticate(request, service), request.params.id));
  app.post<{ Params: { id: string } }>("/api/v1/alignments/:id/activate-replan", async (request) => service.activateStageReplan(authenticate(request, service), request.params.id));
  app.get<{ Params: { id: string } }>("/api/v1/alignments/:id/export", async (request, reply) => {
    const node = authenticate(request, service); requireCaptain(node);
    const alignment = service.repo.getAlignment(request.params.id);
    if (!alignment) throw notFound("对齐记录不存在");
    const markdown = `${alignment.alignmentMarkdown ?? ""}\n\n---\n\n${alignment.tasksMarkdown ?? ""}`;
    reply.type("text/markdown; charset=utf-8").header("Content-Disposition", `attachment; filename=alignment-${alignment.id}.md`);
    return markdown;
  });

  app.post<{ Params: { id: string } }>("/api/v1/tasks/:id/start", async (request) => service.startTask(authenticate(request, service), request.params.id));
  app.post<{ Params: { id: string } }>("/api/v1/tasks/:id/integrate", async (request) => service.integrateTask(authenticate(request, service), request.params.id));
  app.post<{ Params: { id: string } }>("/api/v1/tasks/:id/sync", async (request) => service.requestSync(authenticate(request, service), request.params.id));
  app.post<{ Params: { id: string } }>("/api/v1/tasks/:id/done", async (request) => service.doneTask(authenticate(request, service), request.params.id));
  app.post("/api/v1/tasks/sync", async (request) => service.requestSync(authenticate(request, service)));

  app.post<{ Body: { force?: boolean } }>("/api/v1/reviews", async (request) => service.startReview(authenticate(request, service), Boolean(request.body?.force)));
  app.post<{ Params: { id: string } }>("/api/v1/reviews/:id/apply", async (request) => service.applyReview(authenticate(request, service), request.params.id));
  app.post<{ Params: { id: string } }>("/api/v1/reviews/:id/reject", async (request) => service.rejectReview(authenticate(request, service), request.params.id));
  app.post<{ Params: { id: string } }>("/api/v1/reviews/:id/cancel", async (request) => service.cancelReview(authenticate(request, service), request.params.id));

  app.post("/api/v1/browser-ticket", async (request) => service.createBrowserTicket(authenticate(request, service), publicBase(request)));
  app.get("/api/v1/invite", async (request) => {
    const node = authenticate(request, service);
    const tunnel = await cloudflare.status().catch(() => null);
    return service.inviteInfo(node, tunnel?.url ?? publicBase(request));
  });
  app.post("/api/v1/invite/rotate", async (request) => {
    const node = authenticate(request, service);
    const tunnel = await cloudflare.status().catch(() => null);
    return service.rotateInvite(node, tunnel?.url ?? publicBase(request));
  });
  app.post<{ Params: { id: string } }>("/api/v1/nodes/:id/revoke", async (request) => service.revokeNode(authenticate(request, service), request.params.id));

  app.post("/api/v1/nodes/jobs/next", async (request, reply) => {
    const node = authenticate(request, service);
    let job = service.claimJob(node);
    if (!job) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => { unsubscribe(); resolve(); }, 25_000);
        const unsubscribe = service.hub.subscribe(() => { clearTimeout(timeout); unsubscribe(); resolve(); });
        request.raw.once("close", () => { clearTimeout(timeout); unsubscribe(); resolve(); });
      });
      job = service.claimJob(node);
    }
    if (!job) return reply.status(204).send();
    return job;
  });
  app.post<{ Params: { id: string }; Body: JobResultInput }>("/api/v1/jobs/:id/status", async (request) => service.reportJob(authenticate(request, service), request.params.id, request.body));

  app.get<{ Querystring: { since?: string } }>("/api/v1/events", async (request, reply) => {
    const node = authenticate(request, service);
    const since = Number(request.query.since ?? 0);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive", "X-Accel-Buffering": "no"
    });
    reply.raw.flushHeaders();
    for (const event of service.repo.eventsSince(Number.isFinite(since) ? since : 0)) reply.raw.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
    const unsubscribe = service.hub.subscribe((event) => reply.raw.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`));
    const heartbeat = setInterval(() => reply.raw.write(`: ${node.id}\n\n`), 15_000);
    reply.raw.once("close", () => { clearInterval(heartbeat); unsubscribe(); });
  });

  const localCaptain = (request: FastifyRequest): CollaborationNode => {
    const node = authenticate(request, service); requireCaptain(node);
    if (!isLoopback(request.raw.socket.remoteAddress)) throw forbidden("Tunnel 控制只允许队长在 Host 本机执行");
    return node;
  };
  app.get("/api/v1/local/cloudflare", async (request) => { localCaptain(request); return cloudflare.status(); });
  app.post("/api/v1/local/cloudflare/install", async (request) => { localCaptain(request); return tunnelOperation(() => cloudflare.install()); });
  app.post("/api/v1/local/cloudflare/start", async (request) => { localCaptain(request); return tunnelOperation(() => cloudflare.start()); });
  app.post("/api/v1/local/cloudflare/stop", async (request) => { localCaptain(request); return tunnelOperation(() => cloudflare.stop()); });
}
