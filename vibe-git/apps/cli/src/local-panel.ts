import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { probeCodex } from "./codex.js";
import { chatWithCodex } from "./local-chat.js";
import { vibeHome, writeJson, type ClientConfig } from "./config.js";

const WEB_DIST = resolve(fileURLToPath(new URL("../../web/dist", import.meta.url)));
export const localPanelPath = () => resolve(vibeHome(), "local-panel.json");
const mime: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

const equal = (a: string, b: string): boolean => {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const parts: Buffer[] = []; let bytes = 0;
  for await (const part of req) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
    bytes += chunk.length; if (bytes > 600 * 1024) throw new Error("请求过大"); parts.push(chunk);
  }
  return bytes ? JSON.parse(Buffer.concat(parts).toString("utf8")) as Record<string, unknown> : {};
}
function json(res: ServerResponse, code: number, value: unknown): void {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}
export async function startLocalPanel(config: ClientConfig): Promise<{ port: number; close(): Promise<void> }> {
  const tickets = new Map<string, number>();
  const sessions = new Set<string>();
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      if (req.method === "POST" && url.pathname === "/_local/ticket") {
        if (!equal(String(req.headers["x-vibe-git-control"] ?? ""), config.nodeToken)) return json(res, 403, { error: "本机控制凭据无效" });
        const ticket = randomBytes(32).toString("base64url"); tickets.set(ticket, Date.now() + 120_000);
        return json(res, 200, { url: `${origin}/_local/open/${ticket}` });
      }
      if (req.method === "GET" && url.pathname.startsWith("/_local/open/")) {
        const ticket = url.pathname.slice("/_local/open/".length);
        const expires = tickets.get(ticket); tickets.delete(ticket);
        if (!expires || expires < Date.now()) return json(res, 403, { error: "本机面板票据已失效" });
        const session = randomBytes(32).toString("base64url"); sessions.add(session);
        res.writeHead(302, { location: "/", "set-cookie": `vg_local=${session}; HttpOnly; SameSite=Strict; Path=/`, "cache-control": "no-store" }); res.end(); return;
      }
      const session = req.headers.cookie?.split(";").map((value) => value.trim()).find((value) => value.startsWith("vg_local="))?.slice(9) ?? "";
      if (!sessions.has(session)) return json(res, 403, { error: "请先在本机运行 vibe-git open" });
      if (!["GET", "HEAD"].includes(req.method ?? "") && req.headers.origin !== origin) return json(res, 403, { error: "跨站请求被拒绝" });
      if (url.pathname === "/api/local/capabilities") return json(res, 200, { local: true, chat: probeCodex().appServer });
      const match = url.pathname.match(/^\/api\/local\/chat\/([^/]+)(\/finalize)?$/);
      if (match && req.method === "POST") {
        const taskId = decodeURIComponent(match[1]!);
        if (match[2]) return json(res, 200, await chatWithCodex(config, taskId, "", () => undefined, true));
        const input = await body(req);
        res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive" });
        const send = (type: string, value: unknown) => res.write(`data: ${JSON.stringify({ type, value })}\n\n`);
        try { const answer = await chatWithCodex(config, taskId, String(input.message ?? ""), (delta) => send("delta", delta)); send("done", answer); }
        catch (error) { send("error", error instanceof Error ? error.message : String(error)); }
        res.end(); return;
      }
      if (url.pathname.startsWith("/api/v1/") || url.pathname === "/health") {
        const input = ["GET", "HEAD"].includes(req.method ?? "") ? undefined : Buffer.from(JSON.stringify(await body(req)), "utf8");
        const upstream = await fetch(`${config.hostUrl.replace(/\/$/, "")}${url.pathname}${url.search}`, {
          method: req.method ?? "GET", headers: { authorization: `Bearer ${config.nodeToken}`, ...(input ? { "content-type": "application/json" } : {}) },
          ...(input ? { body: input } : {})
        });
        res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
          "cache-control": "no-store" });
        if (upstream.body) for await (const chunk of upstream.body) res.write(chunk);
        res.end(); return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "不支持的方法" });
      const decoded = decodeURIComponent(url.pathname);
      const candidate = resolve(WEB_DIST, `.${decoded}`);
      if (candidate !== WEB_DIST && !candidate.startsWith(`${WEB_DIST}${sep}`)) return json(res, 404, { error: "不存在" });
      const path = existsSync(candidate) && (await stat(candidate)).isFile() ? candidate : resolve(WEB_DIST, "index.html");
      if (!existsSync(path)) return json(res, 503, { error: "前端未构建，请运行 npm run build" });
      res.writeHead(200, { "content-type": mime[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : await readFile(path));
    } catch (error) { if (!res.headersSent) json(res, 500, { error: error instanceof Error ? error.message : String(error) }); else res.end(); }
  });
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise); server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const port = (server.address() as { port: number }).port;
  await writeJson(localPanelPath(), { port, pid: process.pid });
  return { port, close: () => new Promise<void>((resolvePromise) => server.close(() => resolvePromise())) };
}
