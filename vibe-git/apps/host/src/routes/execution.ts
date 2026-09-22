import type { FastifyInstance, FastifyRequest } from "fastify";
import type { MemberId } from "@vibe-git/protocol";
import { ExecutionService } from "../domain/execution-service.js";

const actor = (request: FastifyRequest) => request.headers["x-member-id"] as MemberId | undefined;

export async function registerExecutionRoutes(app: FastifyInstance, service: ExecutionService) {
  app.post<{ Body: Parameters<ExecutionService["nextCommand"]>[1] }>("/api/relay/commands/next", async (request, reply) => {
    const command = await service.nextCommand(actor(request), request.body);
    if (!command) return reply.status(204).send();
    return command;
  });
  app.post<{ Params: { id: string }; Body: Parameters<ExecutionService["acknowledge"]>[2] }>("/api/relay/commands/:id/status", async (request) => service.acknowledge(actor(request), request.params.id, request.body));
}
