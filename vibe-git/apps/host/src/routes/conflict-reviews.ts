import type { FastifyInstance, FastifyRequest } from "fastify";
import type { MemberId } from "@vibe-git/protocol";
import { ConflictReviewService } from "../domain/conflict-review-service.js";

const actor = (request: FastifyRequest) => request.headers["x-member-id"] as MemberId | undefined;

export async function registerConflictReviewRoutes(app: FastifyInstance, service: ConflictReviewService) {
  app.get("/api/conflict-reviews", async () => service.repo.listConflictReviews());
  app.get("/api/connect/status", async () => service.reviewer.status());
  app.post<{ Params: { id: string }; Body: Parameters<ConflictReviewService["requestConsensusReview"]>[2] }>("/api/consensus/:id/connect-review", async (request) => service.requestConsensusReview(actor(request), request.params.id, request.body));
  app.post<{ Params: { id: string }; Body: Parameters<ConflictReviewService["requestChangeReview"]>[2] }>("/api/change-requests/:id/connect-review", async (request) => service.requestChangeReview(actor(request), request.params.id, request.body));
  app.post<{ Params: { id: string }; Body: Parameters<ConflictReviewService["requestConflictReview"]>[2] }>("/api/conflicts/:id/connect-review", async (request) => service.requestConflictReview(actor(request), request.params.id, request.body));
}
