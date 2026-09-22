import type { FastifyInstance, FastifyRequest } from "fastify";
import type { MemberId } from "@vibe-git/protocol";
import { WorkService } from "../domain/work-service.js";

const actor = (request: FastifyRequest) => request.headers["x-member-id"] as MemberId | undefined;

export async function registerWorkUnitRoutes(app: FastifyInstance, service: WorkService) {
  app.get("/api/modules", async () => service.repo.listModules());
  app.get("/api/work-units", async () => service.repo.listWorkUnits());
  app.get("/api/work-units/mine", async (request) => service.repo.listWorkUnits().filter((unit) => unit.ownerId === actor(request)));
  app.get("/api/plan-reviews", async () => service.repo.listPlanReviews());
  app.post<{ Params: { id: string }; Body: Parameters<WorkService["claimModule"]>[2] }>("/api/modules/:id/claims", async (request) => service.claimModule(actor(request), request.params.id, request.body));
  app.post<{ Params: { id: string }; Body: Parameters<WorkService["recordPlanReview"]>[2] }>("/api/work-units/:id/plans", async (request) => service.recordPlanReview(actor(request), request.params.id, request.body));
  app.post<{ Params: { id: string }; Body: Parameters<WorkService["ready"]>[2] }>("/api/work-units/:id/ready", async (request) => service.ready(actor(request), request.params.id, request.body));
  app.post<{ Params: { id: string }; Body: Parameters<WorkService["updateStatus"]>[2] }>("/api/work-units/:id/status", async (request) => service.updateStatus(actor(request), request.params.id, request.body));
  app.post<{ Params: { id: string }; Body: Parameters<WorkService["start"]>[2] }>("/api/work-units/:id/start", async (request) => service.start(actor(request), request.params.id, request.body));
}
