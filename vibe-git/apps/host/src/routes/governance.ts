import type { FastifyInstance, FastifyRequest } from "fastify";
import type { MemberId } from "@vibe-git/protocol";
import { GovernanceService } from "../domain/governance-service.js";

const actor = (request: FastifyRequest) => request.headers["x-member-id"] as MemberId | undefined;

export async function registerGovernanceRoutes(app: FastifyInstance, service: GovernanceService) {
  app.get("/api/idea-reviews", async () => service.repo.listIdeaReviews());
  app.get("/api/issues", async () => service.repo.listIssues());
  app.get("/api/milestones", async () => service.repo.listMilestones());
  app.get("/api/freeze-policies", async () => service.repo.listFreezePolicies());
  app.get("/api/execution-decisions", async () => service.repo.listExecutionDecisions());
  app.get("/api/freeze-exceptions", async () => service.repo.listFreezeExceptions());
  app.post<{ Body: Parameters<GovernanceService["recordIdeaReview"]>[1] }>("/api/idea-reviews", async (request) => service.recordIdeaReview(actor(request), request.body));
  app.post<{ Body: Parameters<GovernanceService["createGovernedChange"]>[1] }>("/api/governed-change-requests", async (request) => service.createGovernedChange(actor(request), request.body));
  app.post<{ Body: Parameters<GovernanceService["reportIssue"]>[1] }>("/api/issues", async (request) => service.reportIssue(actor(request), request.body));
  app.post<{ Body: Parameters<GovernanceService["createFreezeException"]>[1] }>("/api/freeze-exceptions", async (request) => service.createFreezeException(actor(request), request.body));
  app.post<{ Params: { id: string }; Body: Parameters<GovernanceService["decideFreezeException"]>[2] }>("/api/freeze-exceptions/:id/decision", async (request) => service.decideFreezeException(actor(request), request.params.id, request.body));
  app.post<{ Params: { id: string }; Body: Parameters<GovernanceService["completeModule"]>[2] }>("/api/modules/:id/integration-review", async (request) => service.completeModule(actor(request), request.params.id, request.body));
  app.post<{ Params: { id: string }; Body: Parameters<GovernanceService["createExecutionDecision"]>[2] }>("/api/work-units/:id/pause", async (request) => service.createExecutionDecision(actor(request), request.params.id, request.body));
  app.post<{ Params: { id: string }; Body: Parameters<GovernanceService["acknowledgeExecution"]>[2] }>("/api/execution-decisions/:id/acknowledge", async (request) => service.acknowledgeExecution(actor(request), request.params.id, request.body));
}
