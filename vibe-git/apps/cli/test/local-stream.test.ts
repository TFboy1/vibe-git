import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { expect, it, vi } from "vitest";
import type { ClientConfig } from "../src/config.js";
import { startLocalPanel } from "../src/local-panel.js";

it("事件代理保留续传游标、完整转发大响应并在客户端断开时取消上游", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "vibe-stream-"));
  vi.stubEnv("VIBE_GIT_HOME", root);
  const frames = Array.from({ length: 20 }, (_, i) => `id: ${151 + i}\ndata: ${JSON.stringify({ detail: "中".repeat(6000) })}\n\n`).join("");
  const cursors: unknown[] = []; let disconnected!: () => void;
  const closed = new Promise<void>(resolvePromise => { disconnected = resolvePromise; });
  const upstream = createServer((req, res) => {
    cursors.push(req.headers["last-event-id"]);
    res.writeHead(200, { "content-type": "text/event-stream" }); res.flushHeaders();
    if (req.headers["last-event-id"] === "150") res.end(frames);
    else res.once("close", disconnected);
  });
  let panel: Awaited<ReturnType<typeof startLocalPanel>> | undefined;
  try {
    upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
    const config: ClientConfig = { hostUrl: `http://127.0.0.1:${(upstream.address() as { port: number }).port}`, nodeId: "fixture", nodeToken: "fixture-only-token",
      workspace: root, workTransport: "auto", daemonPid: null, connectedAt: new Date().toISOString() };
    panel = await startLocalPanel(config);
    const base = `http://127.0.0.1:${panel.port}`;
    const ticket = await (await fetch(`${base}/_local/ticket`, { method: "POST", headers: { "x-vibe-git-control": config.nodeToken } })).json() as { url: string };
    const opened = await fetch(ticket.url, { redirect: "manual" });
    const cookie = opened.headers.get("set-cookie")!.split(";")[0]!;
    const replay = await fetch(`${base}/api/v1/events`, { headers: { cookie, "last-event-id": "150" } });
    expect(await replay.text()).toBe(frames);
    const live = await fetch(`${base}/api/v1/events`, { headers: { cookie } });
    expect(live.headers.get("content-type")).toContain("text/event-stream");
    await live.body!.cancel(); await closed;
    expect(cursors).toEqual(["150", undefined]);
  } finally {
    await panel?.close(); upstream.closeAllConnections(); await new Promise<void>(ok => upstream.close(() => ok()));
    vi.unstubAllEnvs();
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith("vibe-stream-")) throw new Error("Invalid stream test cleanup target");
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}, 15_000);
