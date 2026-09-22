import type { FastifyInstance, FastifyRequest } from "fastify";
import type { MemberId } from "@vibe-git/protocol";
import { GovernanceService } from "../domain/governance-service.js";

const actor = (request: FastifyRequest) => request.headers["x-member-id"] as MemberId | undefined;

export async function registerEvidenceRoutes(app: FastifyInstance, service: GovernanceService) {
  app.get("/api/evidence", async () => service.repo.listEvidenceBundles());
  app.get("/api/acceptance-records", async () => service.repo.listAcceptanceRecords());
  app.post<{ Params: { id: string }; Body: Parameters<GovernanceService["submitEvidence"]>[2] }>("/api/work-units/:id/evidence", async (request) => service.submitEvidence(actor(request), request.params.id, request.body));
  app.post<{ Params: { id: string }; Body: Parameters<GovernanceService["reviewEvidence"]>[2] }>("/api/evidence/:id/reviews", async (request) => service.reviewEvidence(actor(request), request.params.id, request.body));
}
