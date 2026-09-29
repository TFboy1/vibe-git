import { codexController } from "./local-codex.js";
import { workspaceController } from "./local-workspace.js";
import { pickWindowsFolder } from "./native-folder-picker.js";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { probeCodex } from "./codex.js";
import { chatWithCodex, draftProposalWithCodex, listCodexModels } from "./local-chat.js";
import { clarifyIntentWithCodex, endIntentSession } from "./intent-clarifier.js";
import { clarifyIntentWithOpenAI, openAIStatus, saveOpenAIConfig } from "./openai-intent.js";
import { saveConfig, vibeHome, writeJson, type ClientConfig } from "./config.js";

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
export async function startLocalPanel(config: ClientConfig, controls: { busy(): string | null; changed(): Promise<void>; beforeSwitch?(): Promise<void> } = { busy: () => null, changed: async () => undefined }): Promise<{ port: number; switching(): boolean; close(): Promise<void> }> {
  const codex = codexController(controls.changed);
  const workspace = workspaceController(config, controls.busy, controls.changed);
  const tickets = new Map<string, number>();
  const sessions = new Map<string, number>();
  let choosingFolder = false;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      if (req.method === "POST" && url.pathname === "/_local/ticket") {
        if (!equal(String(req.headers["x-vibe-git-control"] ?? ""), config.nodeToken)) return json(res, 403, { error: "本机控制凭据无效" });
        const ticket = randomBytes(32).toString("base64url"); tickets.set(ticket, Date.now() + 120_000);
        return json(res, 200, { url: `${origin}/_local/open/${ticket}` });
      }
      if (req.method === "POST" && url.pathname === "/_local/restart") {
        if (!equal(String(req.headers["x-vibe-git-control"] ?? ""), config.nodeToken)) return json(res, 403, { error: "本机控制凭据无效" });
        json(res, 200, { ok: true });
        setTimeout(() => process.exit(0), 100);
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/_local/open/")) {
        const ticket = url.pathname.slice("/_local/open/".length);
        const expires = tickets.get(ticket); tickets.delete(ticket);
        if (!expires || expires < Date.now()) return json(res, 403, { error: "本机面板票据已失效" });
        const session = randomBytes(32).toString("base64url"); sessions.set(session, Date.now() + 60 * 60_000);
        res.writeHead(302, { location: "/", "set-cookie": `vg_local=${session}; HttpOnly; SameSite=Strict; Path=/`, "cache-control": "no-store" }); res.end(); return;
      }
      const session = req.headers.cookie?.split(";").map((value) => value.trim()).find((value) => value.startsWith("vg_local="))?.slice(9) ?? "";
      if ((sessions.get(session) ?? 0) <= Date.now()) return json(res, 403, { error: "请先在本机运行 vibe-git open" });
      if (!["GET", "HEAD"].includes(req.method ?? "") && req.headers.origin !== origin) return json(res, 403, { error: "跨站请求被拒绝" });
      if (url.pathname === "/api/local/capabilities") return json(res, 200, { local: true, chat: probeCodex().appServer });
      if (url.pathname === "/api/local/workspace" && req.method === "GET") return json(res, 200, await workspace.get());
      if (["/api/local/workspace/pick", "/api/local/workspace/select", "/api/local/workspace/init"].includes(url.pathname) && req.method === "POST") {
        try { await controls.beforeSwitch?.(); } catch (error) { return json(res, 409, { error: error instanceof Error ? error.message : String(error) }); }
      }
      if (url.pathname === "/api/local/workspace/pick" && req.method === "POST") {
        if (controls.busy()) return json(res, 409, { error: `任务正在执行：${controls.busy()}` });
        if (choosingFolder) return json(res, 409, { error: "Windows 文件夹选择窗口已经打开" });
        choosingFolder = true;
        const pickerAbort = new AbortController();
        res.once("close", () => pickerAbort.abort());
        try {
          const path = await pickWindowsFolder(pickerAbort.signal);
          if (!res.destroyed) return json(res, 200, { path });
          return;
        } finally { choosingFolder = false; }
      }
      if (url.pathname === "/api/local/workspace/select" && req.method === "POST") {
        const value = await body(req);
        if (typeof value.path !== "string" || !value.path.trim()) return json(res, 400, { error: "请选择有效工作区路径" });
        try { return json(res, 200, await workspace.select(value.path, {
          ...(typeof value.name === "string" ? { name: value.name } : {}),
        })); }
        catch (error) { return json(res, 409, { error: error instanceof Error ? error.message : String(error) }); }
      }
      if (url.pathname === "/api/local/workspace/init" && req.method === "POST") {
        const value = await body(req);
        const path = typeof value.path === "string" && value.path.trim() ? value.path.trim() : undefined;
        try { return json(res, 200, await workspace.init(path)); }
        catch (error) { return json(res, 409, { error: error instanceof Error ? error.message : String(error) }); }
      }
      if (url.pathname === "/api/local/codex" && req.method === "GET") return json(res, 200, await codex.status());
      if (url.pathname === "/api/local/codex/connect" && req.method === "POST") return json(res, 200, codex.connect());
      if (url.pathname === "/api/local/codex/models" && req.method === "GET") return json(res, 200, await listCodexModels(config));
      if (url.pathname === "/api/local/openai" && req.method === "GET") return json(res, 200, openAIStatus(config));
      if (url.pathname === "/api/local/openai" && req.method === "POST") {
        const input = await body(req);
        return json(res, 200, await saveOpenAIConfig(config, typeof input.apiKey === "string" ? input.apiKey : undefined, typeof input.model === "string" ? input.model : undefined, input.clear === true));
      }
      if (url.pathname === "/api/local/intent-clarify/end" && req.method === "POST") {
        const input = await body(req);
        if (typeof input.sessionId === "string") endIntentSession(config, input.sessionId);
        return json(res, 200, { ok: true });
      }
      if (url.pathname === "/api/local/intent-clarify" && req.method === "POST") {
        const input = await body(req); const provider = input.provider === "openai" ? "openai" : "codex";
        const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 150_000);
        res.once("close", () => { if (!res.writableEnded) controller.abort(); });
        res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
        res.flushHeaders();
        const send = (type: string, value: unknown) => { if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify({ type, value })}\n\n`); };
        send("status", "请求已接收");
        const heartbeat = setInterval(() => { if (!res.destroyed && !res.writableEnded) res.write(": heartbeat\n\n"); }, 10_000);
        try {
          const result = provider === "openai"
            ? await clarifyIntentWithOpenAI(config, typeof input.sessionId === "string" ? input.sessionId : "default", String(input.message ?? ""), input.start === true, typeof input.model === "string" ? input.model : undefined, controller.signal, send)
            : !probeCodex().appServer ? (() => { throw new Error("本机 Codex 不可用。请选择 OpenAI API，或先连接算力网。"); })()
              : await clarifyIntentWithCodex(config, typeof input.sessionId === "string" ? input.sessionId : "default", String(input.message ?? ""), input.start === true, typeof input.model === "string" ? input.model : undefined, controller.signal, send);
          send("done", result);
        } catch (error) { send("error", error instanceof Error ? error.message : String(error)); }
        finally { clearTimeout(timeout); clearInterval(heartbeat); res.end(); }
        return;
      }
      if (url.pathname === "/api/local/proposal-draft" && req.method === "POST") {
        if (!probeCodex().appServer) return json(res, 409, { error: "本机 Codex 不可用。请安装并登录 Codex，然后重新生成草稿。" });
        const input = await body(req);
        return json(res, 200, await draftProposalWithCodex(
          config,
          typeof input.prompt === "string" ? input.prompt : undefined,
          typeof input.model === "string" ? input.model : undefined
        ));
      }
      if (url.pathname.startsWith("/api/local/") && !url.pathname.startsWith("/api/local/chat/")) return json(res, 404, { error: "本机接口不存在" });
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
        const controller = new AbortController();
        res.once("close", () => controller.abort());
        const upstream = await fetch(`${config.hostUrl.replace(/\/$/, "")}${url.pathname}${url.search}`, {
          signal: controller.signal, method: req.method ?? "GET", headers: { authorization: `Bearer ${config.nodeToken}`, ...(input ? { "content-type": "application/json" } : {}) },
          ...(input ? { body: input } : {})
        });
        res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
          "cache-control": "no-store" });
        // An idle SSE stream must open immediately, before its first event.
        if (upstream.headers.get("content-type")?.startsWith("text/event-stream")) res.flushHeaders();
        if (upstream.body) for await (const chunk of upstream.body) res.write(chunk);
        res.end(); return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "不支持的方法" });
      const decoded = decodeURIComponent(url.pathname);
      const candidate = resolve(WEB_DIST, `.${decoded}`);
      if (candidate !== WEB_DIST && !candidate.startsWith(`${WEB_DIST}${sep}`)) return json(res, 404, { error: "不存在" });
      const path = existsSync(candidate) && (await stat(candidate)).isFile() ? candidate : resolve(WEB_DIST, "index.html");
      if (!existsSync(resolve(WEB_DIST, "../package.json")) || !existsSync(path)) return json(res, 503, { error: "当前分支的前端正在重建，本机 API 保持可用" });
      res.writeHead(200, { "content-type": mime[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : await readFile(path));
    } catch (error) { if (!res.headersSent) json(res, 500, { error: error instanceof Error ? error.message : String(error) }); else res.end(); }
  });
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise); server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const port = (server.address() as { port: number }).port;
  await writeJson(localPanelPath(), { port, pid: process.pid });
  return { port, switching: workspace.isSwitching, close: () => { codex.close(); server.closeAllConnections(); return new Promise<void>((resolvePromise) => server.close(() => resolvePromise())); } };
}
