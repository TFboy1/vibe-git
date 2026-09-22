import type { FastifyInstance, FastifyRequest } from "fastify";
import type { MemberId } from "@vibe-git/protocol";
import { ConsensusService } from "../domain/consensus-service.js";

const actor = (request: FastifyRequest) => request.headers["x-member-id"] as MemberId | undefined;

export async function registerConsensusRoutes(app: FastifyInstance, service: ConsensusService) {
  app.get("/api/proposals", async () => service.repo.listProposals());
  app.get("/api/consensus", async () => service.repo.listConsensusRevisions());
  app.get("/api/delegation-policies", async () => service.repo.listDelegationPolicies());
  app.get("/api/decision-records", async () => service.repo.listDecisionRecords());
  app.post<{ Body: Parameters<ConsensusService["submitProposal"]>[1] }>("/api/proposals", async (request) => service.submitProposal(actor(request), request.body));
  app.post<{ Body: Parameters<ConsensusService["createConsensus"]>[1] }>("/api/consensus", async (request) => service.createConsensus(actor(request), request.body));
  app.post<{ Params: { id: string }; Body: Parameters<ConsensusService["reviseConsensus"]>[2] }>("/api/consensus/:id/revisions", async (request) => service.reviseConsensus(actor(request), request.params.id, request.body));
  app.post<{ Params: { id: string }; Body: Parameters<ConsensusService["confirm"]>[2] }>("/api/consensus/:id/confirmations", async (request) => service.confirm(actor(request), request.params.id, request.body));
  app.post<{ Params: { id: string }; Body: Parameters<ConsensusService["publishConsensus"]>[2] }>("/api/consensus/:id/publish", async (request) => service.publishConsensus(actor(request), request.params.id, request.body));
}
