import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { openDatabase } from "./db/database.js";
import { DomainError } from "./domain/errors.js";
import { EventHub } from "./events/hub.js";
import { CloudflareTunnelManager, type CloudflareManager } from "./integrations/cloudflare/manager.js";
import { V20Repository } from "./v20/repository.js";
import { ensureV20Runtime } from "./v20/runtime-secrets.js";
import { registerV20Routes } from "./v20/routes.js";
import { V20Service } from "./v20/service.js";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

export interface BuildAppOptions {
  dbPath?: string;
  dataDir?: string;
  staticDir?: string | false;
  logger?: boolean;
  cloudflareManager?: CloudflareManager;
  /** 仅为兼容旧测试调用；v0.20 永远不会写入演示数据。 */
  seedDemo?: boolean;
  /** v0.20 的审核由节点池处理，旧内嵌 reviewer 不再使用。 */
  conflictReviewer?: unknown;
  backupDatabase?: boolean;
}

function backupBeforeV20(dbPath: string, dataDir: string): void {
  if (dbPath === ":memory:" || !existsSync(dbPath)) return;
  const marker = resolve(dataDir, ".v020-database-backed-up");
  if (existsSync(marker)) return;
  const backupDir = resolve(dataDir, "backups");
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = resolve(backupDir, `workspace-pre-v020-${stamp}.db`);
  copyFileSync(dbPath, destination);
  writeFileSync(marker, `${destination}\n`, "utf8");
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".map": "application/json; charset=utf-8"
};

async function registerStatic(app: FastifyInstance, staticDir: string): Promise<void> {
  const root = resolve(staticDir);
  if (!existsSync(resolve(root, "index.html"))) return;
  app.get<{ Params: { "*": string } }>("/*", async (request, reply) => {
    if (request.url.startsWith("/api/") || request.url === "/health" || request.url.startsWith("/session/")) {
      return reply.status(404).send({ error: "接口不存在", code: "NOT_FOUND" });
    }
    const raw = request.params["*"] || "index.html";
    let candidate = resolve(root, decodeURIComponent(raw).replace(/^[/\\]+/, ""));
    if (!candidate.startsWith(`${root}${sep}`) && candidate !== root) return reply.status(404).send("Not found");
    if (!existsSync(candidate) || !statSync(candidate).isFile()) candidate = resolve(root, "index.html");
    const extension = extname(candidate).toLowerCase();
    reply.type(MIME[extension] ?? "application/octet-stream");
    reply.header("Cache-Control", extension === ".html" ? "no-cache" : "public, max-age=31536000, immutable");
    return reply.send(readFileSync(candidate));
  });
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false, trustProxy: true, bodyLimit: 600 * 1024 });
  const dbPath = options.dbPath ?? resolve(ROOT, "data/workspace.db");
  const dataDir = options.dataDir ?? resolve(ROOT, "data/v20");
  if (options.backupDatabase !== false) backupBeforeV20(dbPath, dataDir);
  const db = openDatabase(dbPath);
  const repo = new V20Repository(db);
  repo.setMeta("schema_version", "20");
  const runtime = await ensureV20Runtime(repo, dataDir);
  const hub = new EventHub();
  const cloudflareManager = options.cloudflareManager ?? new CloudflareTunnelManager(resolve(ROOT, "data/tools/cloudflared.exe"));
  const service = new V20Service(repo, hub, dataDir, cloudflareManager, runtime.inviteToken);

  app.decorate("v20Service", service);
  app.addHook("onClose", async () => {
    await cloudflareManager.close().catch((error: unknown) => app.log.error(error));
    db.close();
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) return reply.status(error.statusCode).send({ error: error.message, code: error.code, details: error.details });
    if ((error as { code?: string }).code === "FST_ERR_CTP_BODY_TOO_LARGE") return reply.status(413).send({ error: "上传内容超过 256 KiB", code: "BAD_REQUEST" });
    app.log.error(error);
    return reply.status(500).send({ error: "Host 内部错误", code: "INTERNAL_ERROR" });
  });

  await registerV20Routes(app, service, cloudflareManager);
  if (options.staticDir !== false) await registerStatic(app, options.staticDir ?? resolve(ROOT, "apps/web/dist"));
  return app;
}
