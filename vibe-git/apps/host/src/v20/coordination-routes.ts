import type { FastifyInstance, FastifyRequest } from "fastify";
import type { CollaborationNode } from "@vibe-git/protocol";
import type { CoordinationService } from "./coordination-service.js";
import type { AgileService } from "./agile-service.js";

type Id = { id: string };
type Version = { expectedRevision: number };
export function registerCoordinationRoutes(app: FastifyInstance, service: CoordinationService, auth: (request: FastifyRequest) => CollaborationNode, agile: AgileService) {
  app.post<{ Body: unknown }>("/api/v1/intents", async request => service.saveIntent(auth(request), request.body));
  app.put<{ Params: Id; Body: unknown }>("/api/v1/intents/:id", async request => service.saveIntent(auth(request), request.body, request.params.id));
  app.post<{ Params: Id; Body: unknown }>("/api/v1/intents/:id/plan", async request => service.importPlan(auth(request), request.params.id, request.body));
  app.post<{ Params: Id; Body: Version }>("/api/v1/intents/:id/generate", async request => service.generate(auth(request), request.params.id, request.body?.expectedRevision));
  app.get<{ Params: Id }>("/api/v1/tasks/:id/package", async request => {
    const viewer = auth(request);
    return agile.repo.getTask(request.params.id)?.flow === "agile" ? agile.package(viewer, request.params.id) : service.executionPackage(request.params.id);
  });
  app.post<{ Params: Id; Body: Version }>("/api/v1/tasks/:id/external-start", async request => service.startExternal(auth(request), request.params.id, request.body?.expectedRevision));
  app.post<{ Params: Id; Body: unknown }>("/api/v1/tasks/:id/external-report", async request => service.reportExternal(auth(request), request.params.id, request.body));
  app.post<{ Params: Id; Body: Version }>("/api/v1/tasks/:id/external-done", async request => service.finishExternal(auth(request), request.params.id, request.body?.expectedRevision));
  app.post<{ Params: Id; Body: unknown }>("/api/v1/tasks/:id/ack-change", async request => service.acknowledgeChange(auth(request), request.params.id, request.body));
  app.post<{ Params: Id; Body: Version }>("/api/v1/coordination/contracts/:id/ack", async request => service.acknowledgeContract(auth(request), request.params.id, request.body?.expectedRevision));
  app.post<{ Body: unknown }>("/api/v1/changes", async request => service.submitChange(auth(request), request.body));
  app.post<{ Params: Id; Body: Version }>("/api/v1/changes/:id/suggest", async request => service.suggestImpact(auth(request), request.params.id, request.body?.expectedRevision));
  app.get<{ Params: Id }>("/api/v1/changes/:id/impact", async request => { auth(request); return service.impact(request.params.id); });
  app.post<{ Params: Id; Body: unknown }>("/api/v1/changes/:id/apply", async request => service.applyChange(auth(request), request.params.id, request.body));
  app.post<{ Params: Id; Body: Version }>("/api/v1/changes/:id/reject", async request => service.rejectChange(auth(request), request.params.id, request.body?.expectedRevision));
}
