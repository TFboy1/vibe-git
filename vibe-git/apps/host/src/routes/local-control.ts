import type { FastifyInstance, FastifyRequest } from "fastify";
import type { CloudflareManager } from "../integrations/cloudflare/manager.js";
import { badRequest, forbidden, unavailable } from "../domain/errors.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function hostnameFromHostHeader(host: string | undefined): string | null {
  if (!host) return null;
  try { return new URL(`http://${host}`).hostname.toLowerCase(); }
  catch { return null; }
}

function isLocalWebOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname.toLowerCase()) && url.port === "4173";
  } catch {
    return false;
  }
}

export function assertLocalCaptain(request: FastifyRequest): void {
  if (request.headers["x-member-id"] !== "A") throw forbidden("只有队长 A 可以控制本机 Cloudflare Tunnel");
  const host = hostnameFromHostHeader(request.headers.host);
  if (!host || !LOCAL_HOSTS.has(host)) throw forbidden("Cloudflare Tunnel 控制只允许直接访问本机 Host");
  const origin = Array.isArray(request.headers.origin) ? request.headers.origin[0] : request.headers.origin;
  if (!isLocalWebOrigin(origin)) throw forbidden("请从队长电脑的 http://localhost:4173 控制 Tunnel");
}

function assertEmptyBody(request: FastifyRequest): void {
  const body = request.body;
  if (body !== undefined && body !== null && (typeof body !== "object" || Object.keys(body as object).length > 0)) {
    throw badRequest("该操作不接受命令、参数或自定义 Tunnel 目标");
  }
}

async function operational<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    throw unavailable(error instanceof Error ? error.message : String(error));
  }
}

export async function registerLocalControlRoutes(app: FastifyInstance, manager: CloudflareManager) {
  const localCaptainGuard = async (request: FastifyRequest) => { assertLocalCaptain(request); };
  app.get("/api/local-control/cloudflare", { preHandler: localCaptainGuard }, async () => manager.status());
  app.post("/api/local-control/cloudflare/install", { preHandler: localCaptainGuard }, async (request) => {
    assertEmptyBody(request);
    return operational(() => manager.install());
  });
  app.post("/api/local-control/cloudflare/start", { preHandler: localCaptainGuard }, async (request) => {
    assertEmptyBody(request);
    return operational(() => manager.start());
  });
  app.post("/api/local-control/cloudflare/stop", { preHandler: localCaptainGuard }, async (request) => {
    assertEmptyBody(request);
    return operational(() => manager.stop());
  });
}
