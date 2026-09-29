import type { FastifyInstance, FastifyRequest } from "fastify";
import type { CollaborationNode } from "@vibe-git/protocol";
import type { AgileService } from "./agile-service.js";

export function registerAgileRoutes(app: FastifyInstance, service: AgileService, auth: (request: FastifyRequest) => CollaborationNode): void {
  app.get("/api/v1/agile", async request => { auth(request); return service.snapshot(); });
  app.put<{ Body: unknown }>("/api/v1/agile/profile", async request => service.rename(auth(request), request.body));
  app.put<{ Body: unknown }>("/api/v1/agile/compute", async request => service.setCompute(auth(request), request.body));
  app.put<{ Body: unknown }>("/api/v1/agile/plan", async request => service.savePlan(auth(request), request.body));
  app.post<{ Body: unknown }>("/api/v1/agile/initial", async request => service.startInitial(auth(request), request.body));
  app.post<{ Body: unknown }>("/api/v1/agile/pull-requests", async request => service.submitPR(auth(request), request.body));
  app.post<{ Body: unknown }>("/api/v1/agile/reviews", async request => service.startReview(auth(request), request.body));
  app.get("/api/v1/agile/inbox", async request => service.inbox(auth(request)));
  app.get<{ Params: { id: string } }>("/api/v1/agile/tasks/:id/package", async request => service.package(auth(request), request.params.id));
  app.post<{ Params: { id: string }; Body: unknown }>("/api/v1/agile/tasks/:id/report", async request => service.report(auth(request), request.params.id, request.body));
  const methods = ["answer", "decisions", "requirement", "saveDraft", "allocate", "saveAllocation", "retry", "publish", "close"] as const;
  const paths = ["answer", "decisions", "requirement", "draft", "allocate", "allocation", "retry", "publish", "cancel"];
  for (let i = 0; i < methods.length; i++) {
    const method = methods[i]!;
    app.post<{ Params: { id: string }; Body: unknown }>("/api/v1/agile/flows/:id/" + paths[i], async request => service[method](auth(request), request.params.id, request.body));
  }
  app.post<{ Params: { id: string }; Body: unknown }>("/api/v1/agile/flows/:id/reject", async request => service.close(auth(request), request.params.id, request.body, true));
}
