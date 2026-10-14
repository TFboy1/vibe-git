// 先 npm run build，再 node --expose-gc scripts/memory-audit.mjs [--live-codex]
// 使用隔离的后端与假数据；--live-codex 仅查询本机额度，不执行 AI 任务。
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, request, ServerResponse } from "node:http";
import { syncBuiltinESMExports } from "node:module";
import { connect } from "node:net";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { setImmediate as immediate } from "node:timers/promises";
import { buildApp } from "../apps/host/dist/app.js";
import { activityReporter } from "../apps/cli/dist/job-activity.js";
import { startLocalPanel } from "../apps/cli/dist/local-panel.js";
import { defaultCodexHome } from "../apps/cli/dist/config.js";
import { readRateLimits } from "../apps/cli/dist/codex.js";

assert.equal(typeof global.gc, "function", "请使用 node --expose-gc 运行");
const mib = 1024 * 1024;
const root = fileURLToPath(new URL("../", import.meta.url));
const temp = await mkdtemp(resolve(root, ".memory-audit-"));
const previousHome = process.env.VIBE_GIT_HOME;
process.env.VIBE_GIT_HOME = resolve(temp, "local");
const config = { hostUrl: "http://127.0.0.1:1", nodeId: "fixture", nodeToken: "fixture-only-token",
  workspace: temp, workTransport: "auto", daemonPid: null, connectedAt: new Date().toISOString() };
const deferred = () => { let resolvePromise; const promise = new Promise(ok => { resolvePromise = ok; }); return { promise, resolve: resolvePromise }; };
const memory = () => { global.gc(); const usage = process.memoryUsage(); return Object.fromEntries(["heapUsed", "external", "rss"].map(key => [key, +(usage[key] / mib).toFixed(2)])); };
const report = (check, value) => console.log(JSON.stringify({ check, ...value }));
async function bounded(promise, ms = 10000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("检查超时")), ms); })]); }
  finally { clearTimeout(timer); }
}
async function closeServer(server) { server.closeAllConnections(); await new Promise(ok => server.close(ok)); }

async function activityQueue() {
  const originalFetch = global.fetch, gate = deferred();
  let posted = 0;
  global.fetch = async () => { posted++; await gate.promise; return new Response("{}"); };
  const reporter = activityReporter(config, { id: "fixture-job", leaseToken: "fixture-lease", payload: { activityEnabled: true } });
  const samples = [{ batches: 0, ...memory() }];
  try {
    for (let batch = 1; batch <= 24; batch++) {
      for (let i = 0; i < 100; i++) reporter.emit({ kind: "tool", message: "隔离测试活动", detail: randomBytes(1950).toString("hex") });
      // flush 与每秒定时器使用相同的 send；立即调用以加速受控复现。
      void reporter.flush();
      await immediate();
      if ([6, 12, 24].includes(batch)) samples.push({ batches: batch, ...memory() });
    }
    const blockedRequests = posted;
    gate.resolve(); await bounded(reporter.flush(), 20000); await immediate();
    assert.equal(blockedRequests, 1); assert.equal(posted, 101);
    assert(samples.at(-1).heapUsed - samples[0].heapUsed < 3, "活动队列仍随批次增长");
    report("activity-queue", { samples, blockedRequests, queuedActivities: posted - blockedRequests, afterDrain: memory() });
  } finally { gate.resolve(); await reporter.flush(); global.fetch = originalFetch; }
}

async function slowProxy() {
  const gate = deferred(), sent = deferred(), forwarded = deferred(), pressured = deferred();
  const total = 16 * mib, chunk = Buffer.from(`:${"x".repeat(65533)}\n\n`, "utf8");
  let panel, socket, bytes = 0, maxBufferedBytes = 0, refusedWrites = 0, blocked = false, writesBeforeDrain = 0;
  const abort = new AbortController();
  const upstream = createServer(async (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" }); res.flushHeaders();
    try {
      await gate.promise;
      for (let i = 0; i < total / chunk.length; i++) if (!res.write(chunk)) await once(res, "drain", { signal: abort.signal });
      res.end(); sent.resolve();
    } catch { res.destroy(); sent.resolve(); }
  });
  const originalWrite = ServerResponse.prototype.write;
  try {
    upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
    panel = await startLocalPanel({ ...config, hostUrl: `http://127.0.0.1:${upstream.address().port}` });
    ServerResponse.prototype.write = function (value, ...args) {
      const proxy = this.socket?.localPort === panel.port;
      if (proxy && blocked) writesBeforeDrain++;
      const accepted = originalWrite.call(this, value, ...args);
      if (proxy) {
        bytes += Buffer.byteLength(value); maxBufferedBytes = Math.max(maxBufferedBytes, this.writableLength);
        if (!accepted) { refusedWrites++; blocked = true; this.once("drain", () => { blocked = false; }); pressured.resolve(); }
        if (bytes >= total) forwarded.resolve();
      }
      return accepted;
    };
    const ticket = await (await fetch(`http://127.0.0.1:${panel.port}/_local/ticket`, { method: "POST", headers: { "x-vibe-git-control": config.nodeToken } })).json();
    const opened = await fetch(ticket.url, { redirect: "manual" });
    const cookie = opened.headers.get("set-cookie").split(";")[0];
    socket = connect(panel.port, "127.0.0.1"); await once(socket, "connect"); socket.pause();
    const before = memory();
    socket.write(`GET /api/v1/events HTTP/1.1\r\nHost: 127.0.0.1:${panel.port}\r\nCookie: ${cookie}\r\n\r\n`);
    gate.resolve(); await bounded(pressured.promise); await immediate(); socket.resume();
    await bounded(Promise.all([sent.promise, forwarded.promise])); await immediate();
    assert.equal(writesBeforeDrain, 0, "代理在缓冲已满时仍继续写入");
    assert(maxBufferedBytes < mib, "代理发送缓冲未受控");
    report("slow-sse-proxy", { bytes, maxBufferedMiB: +(maxBufferedBytes / mib).toFixed(2), refusedWrites, writesBeforeDrain, before, after: memory() });
  } finally {
    ServerResponse.prototype.write = originalWrite; gate.resolve(); abort.abort(); socket?.destroy();
    await panel?.close(); await closeServer(upstream);
  }
  await immediate(); report("slow-sse-proxy-released", memory());
}

async function idleHost() {
  const dataDir = resolve(temp, "host");
  const app = await buildApp({ dbPath: resolve(temp, "host.db"), dataDir, backupDatabase: false, staticDir: false });
  // 仅读取本次生成的测试凭据，不访问用户的 client/captain/auth 文件。
  const captain = JSON.parse(await readFile(resolve(dataDir, "captain.json"), "utf8"));
  const service = app.v20Service, emitter = service.hub.emitter;
  const headers = { authorization: `Bearer ${captain.nodeToken}` };
  let received, stalled;
  app.server.on("request", (_req, res) => received?.resolve(res));
  try {
    await app.listen({ port: 0, host: "127.0.0.1" });
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const before = memory();
    for (let round = 0; round < 30; round++) {
      for (const path of ["/api/v1/events?since=9007199254740991", "/api/v1/nodes/jobs/next"]) {
        received = deferred();
        const req = request(base + path, { method: path.includes("jobs") ? "POST" : "GET", headers: { ...headers, "content-type": "application/json" }, agent: false });
        req.on("error", () => undefined); req.on("response", res => res.resume()); req.end(path.includes("jobs") ? "{}" : undefined);
        const res = await bounded(received.promise); await immediate();
        assert.equal(emitter.listenerCount("event"), 1);
        const closed = once(res, "close"); req.destroy(); await bounded(closed); await immediate();
        assert.equal(emitter.listenerCount("event"), 0);
      }
    }
    const node = service.authenticateBearer(headers.authorization);
    const input = { apiReady: false, workspaceReady: false, codex: "unsupported", workTransport: "auto", rateLimits: [], git: null, currentTaskId: null };
    const samples = [];
    for (let i = 1; i <= 3000; i++) {
      service.heartbeat(node, input);
      if (i % 1000 === 0) { await immediate(); samples.push({ heartbeats: i, ...memory() }); }
    }
    report("idle-host", { disconnectedConnections: 60, remainingSubscribers: emitter.listenerCount("event"), before, samples });

    // 检查绕过本机代理、直接连接 Host 时的同一发送路径。
    stalled = connect(app.server.address().port, "127.0.0.1"); await once(stalled, "connect"); stalled.pause();
    received = deferred();
    stalled.write(`GET /api/v1/events?since=${service.repo.lastSeq()} HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: ${headers.authorization}\r\n\r\n`);
    const res = await bounded(received.promise); await immediate();
    assert.equal(emitter.listenerCount("event"), 1);
    const slowBefore = memory(); let maxBufferedBytes = 0;
    for (let i = 1; i <= 2048; i++) {
      const event = service.repo.appendEvent("job.progress", "fixture", "agent_job", "fixture", { detail: "x".repeat(8000) });
      service.hub.publish(event);
      maxBufferedBytes = Math.max(maxBufferedBytes, res.writableLength);
      await immediate();
    }
    assert(maxBufferedBytes < mib, "Host 发送缓冲未受控");
    report("slow-host-sse", { events: 2048, maxBufferedMiB: +(maxBufferedBytes / mib).toFixed(2), before: slowBefore, after: memory() });
    const ended = once(res, "close"); stalled.destroy(); await bounded(ended); await immediate();
    assert.equal(emitter.listenerCount("event"), 0);
  } finally { stalled?.destroy(); app.server.closeAllConnections(); await app.close(); }
}

async function liveCodex() {
  const originalSpawn = childProcess.spawn, children = [], closed = [];
  childProcess.spawn = (...args) => {
    const child = originalSpawn(...args);
    if (args[1]?.includes("app-server")) { children.push(child); closed.push(once(child, "close")); }
    return child;
  };
  syncBuiltinESMExports();
  const windows = [], before = memory();
  try {
    for (let i = 0; i < 3; i++) windows.push((await readRateLimits(defaultCodexHome())).length);
    await bounded(Promise.all(closed), 5000); await immediate();
    // 仅读取 PID、父 PID、进程名，不打印其他进程的命令行或凭据。
    let survivingDescendants = null;
    if (process.platform === "win32" && children.length) {
      const ids = children.map(child => child.pid).filter(Number.isInteger);
      const query = `$items = @(Get-CimInstance Win32_Process); $known = [System.Collections.Generic.HashSet[int]]::new(); @(${ids.join(",")}) | ForEach-Object { [void]$known.Add($_) }; do { $added = $false; foreach ($item in $items) { if ($known.Contains([int]$item.ParentProcessId) -and $known.Add([int]$item.ProcessId)) { $added = $true } } } while ($added); @($items | Where-Object { $known.Contains([int]$_.ProcessId) } | Select-Object ProcessId, ParentProcessId, Name) | ConvertTo-Json -Compress`;
      const output = childProcess.execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", query], { encoding: "utf8", windowsHide: true, timeout: 10000 }).trim();
      const found = output ? JSON.parse(output) : [];
      survivingDescendants = Array.isArray(found) ? found : [found];
    }
    report("live-codex-quota", { queries: windows.length, quotaWindows: windows, childrenCreated: children.length, childrenClosed: closed.length, survivingDescendants, before, after: memory() });
  } finally { childProcess.spawn = originalSpawn; syncBuiltinESMExports(); for (const child of children) if (!child.killed) child.kill(); }
}

try {
  await activityQueue(); await slowProxy(); await idleHost();
  if (process.argv.includes("--live-codex")) await liveCodex();
} finally {
  if (previousHome === undefined) delete process.env.VIBE_GIT_HOME; else process.env.VIBE_GIT_HOME = previousHome;
  // 递归清理前验证绝对路径，避免删除工作区或用户现有目录。
  assert(resolve(temp).startsWith(resolve(root) + sep + ".memory-audit-"));
  await rm(temp, { recursive: true, force: true });
}
