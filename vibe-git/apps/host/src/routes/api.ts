import type { FastifyInstance, FastifyRequest } from "fastify";
import type { MemberId } from "@vibe-git/protocol";
import { VibeService } from "../domain/service.js";

const actor = (request: FastifyRequest) => request.headers["x-member-id"] as MemberId | undefined;

export async function registerApi(app: FastifyInstance, service: VibeService) {
  app.get("/health", async () => ({ ok: true, service: "vibe-git-host", time: new Date().toISOString() }));
  app.post<{ Body: Parameters<VibeService["initializeProject"]>[1] }>("/api/project", async request => service.initializeProject(actor(request), request.body));
  app.get("/api/bootstrap", async () => service.bootstrap());
  app.get("/api/requirements/current", async () => ({ revision: service.repo.requirementRevision(), items: service.repo.listRequirements(), history: service.repo.listRevisions() }));
  app.get("/api/tasks", async () => service.repo.listTasks());
  app.get("/api/tasks/mine", async (request) => service.repo.listTasks().filter((task) => task.ownerId === actor(request)));
  app.get("/api/change-requests", async () => service.repo.listChanges());
  app.get("/api/conflicts", async () => service.repo.listConflicts());

  app.post<{ Params: { id: string }; Body: Parameters<VibeService["acceptTask"]>[2] }>("/api/tasks/:id/accept", async (request) => service.acceptTask(actor(request), request.params.id, request.body));
  app.post<{ Params: { id: string }; Body: Parameters<VibeService["updateTaskStatus"]>[2] }>("/api/tasks/:id/status", async (request) => service.updateTaskStatus(actor(request), request.params.id, request.body));
  app.post<{ Params: { id: string }; Body: Parameters<VibeService["readyTask"]>[2] }>("/api/tasks/:id/ready", async (request) => service.readyTask(actor(request), request.params.id, request.body));
  app.post<{ Params: { id: string }; Body: Parameters<VibeService["startTask"]>[2] }>("/api/tasks/:id/start", async (request) => service.startTask(actor(request), request.params.id, request.body));
  app.post<{ Params: { id: string }; Body: Parameters<VibeService["decideChange"]>[2] }>("/api/change-requests/:id/decision", async (request) => service.decideChange(actor(request), request.params.id, request.body));
  app.post<{ Body: Parameters<VibeService["heartbeat"]>[1] }>("/api/relays/heartbeat", async (request) => service.heartbeat(actor(request), request.body));

  app.get<{ Querystring: { since?: string } }>("/api/events", async (request, reply) => {
    const since = Number(request.query.since ?? 0);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive", "Access-Control-Allow-Origin": "*"
    });
    for (const event of service.repo.eventsSince(Number.isFinite(since) ? since : 0)) reply.raw.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
    const unsubscribe = service.hub.subscribe((event) => reply.raw.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`));
    const heartbeat = setInterval(() => reply.raw.write(": heartbeat\n\n"), 15_000);
    request.raw.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
  });
}
