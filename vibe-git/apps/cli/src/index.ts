#!/usr/bin/env node
import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AlignmentRun, JoinResponse, MarkdownDocument, V20BootstrapPayload, WorkTransport } from "@vibe-git/protocol";
import { api, post } from "./api.js";
import { codexInvocation } from "./codex-command.js";
import {
  defaultCodexHome, configPath, daemonLogPath, hostLogPath, hostProcessPath, loadConfig, readJson,
  saveConfig, vibeHome, writeJson, type ClientConfig
} from "./config.js";
import { probeCodex } from "./codex.js";
import { runDaemon } from "./daemon.js";
import { localPanelPath } from "./local-panel.js";

const args = process.argv.slice(2);
const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const HOST_ENTRY = resolve(fileURLToPath(new URL("../../host/dist/index.js", import.meta.url)));
const CLI_ENTRY = fileURLToPath(import.meta.url);
const LOCAL_HOST = "http://127.0.0.1:8787";

interface HostProcess { pid: number; hostUrl: string; startedAt: string; root: string }
interface CaptainFile { roomId: string; nodeId: string; nodeToken: string }

const out = (value: unknown) => console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
const command = (...parts: string[]) => parts.filter(Boolean).join(" ");

function usage(): string {
  return `Vibe-Git v0.20 — CLI 驱动的多人协作

队长
  vibe-git host start | status | stop
  vibe-git invite show | rotate
  vibe-git align start | status | show <alignment-id> | resolve <alignment-id> <issue-id> <option-id> | export <alignment-id>
  vibe-git task assign <task-id> <node-id>
  vibe-git align downgrade <alignment-id> <task-id> <upstream-task-id>
  vibe-git stage replan <stage-id> | stage activate <alignment-id>
  vibe-git contract list | show <contract-id> | ack <contract-id> | publish <contract-id>
  vibe-git tasks publish <alignment-id>
  vibe-git review start --force | status | apply <review-id> | reject <review-id> | cancel <review-id>

每位成员
  vibe-git connect <join-url> | status | logs | disconnect | open
  vibe-git codex bind | status | unbind
  vibe-git config set work.transport auto|app-server|cli
  vibe-git plan submit <任意文件.md>
  vibe-git task list | pull <task-id> [output] | push <task-id> <任意文件.md>
  vibe-git work list | pull <workstream-id> [output]
  vibe-git task start <task-id> | integrate <task-id> | sync [task-id] | done <task-id>
  vibe-git pr submit <任意文件.md> | list`;
}

function isAlive(pid: number | null | undefined): boolean {
  if (!pid || !Number.isInteger(pid)) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function waitForHost(base: string, timeoutMs = 25_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${base}/health`);
      const data = await response.json() as { ok?: boolean; version?: string };
      if (response.ok && data.ok && data.version === "0.20") return;
      if (response.ok && data.ok) throw new Error("端口 8787 正被旧版 Vibe-Git 占用，请先执行旧预览的停止命令");
    } catch (error) {
      if (error instanceof Error && error.message.includes("旧版")) throw error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
  }
  throw new Error(`Host 启动超时，请查看 ${hostLogPath()}`);
}

async function stopDaemon(config: ClientConfig | null): Promise<ClientConfig | null> {
  if (config?.daemonPid && isAlive(config.daemonPid)) {
    try { process.kill(config.daemonPid, "SIGTERM"); } catch { /* already gone */ }
    for (let i = 0; i < 20 && isAlive(config.daemonPid); i += 1) await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  if (config) { const updated = { ...config, daemonPid: null }; await saveConfig(updated); return updated; }
  return config;
}

async function spawnDaemon(config: ClientConfig): Promise<ClientConfig> {
  await stopDaemon(config);
  await mkdir(dirname(daemonLogPath()), { recursive: true });
  const fd = openSync(daemonLogPath(), "a");
  const child = spawn(process.execPath, [CLI_ENTRY, "daemon"], {
    detached: true, windowsHide: true, cwd: config.workspace, stdio: ["ignore", fd, fd], env: process.env
  });
  child.unref(); closeSync(fd);
  const updated = { ...config, daemonPid: child.pid ?? null };
  await saveConfig(updated);
  return updated;
}

async function hostStart(): Promise<void> {
  const existing = await readJson<HostProcess>(hostProcessPath());
  let info: HostProcess;
  if (existing && isAlive(existing.pid)) {
    await waitForHost(existing.hostUrl, 3_000);
    info = existing;
  } else {
    if (!existsSync(HOST_ENTRY)) throw new Error("尚未构建 Host。请先在源码目录执行 npm run build。 ");
    await mkdir(vibeHome(), { recursive: true });
    const fd = openSync(hostLogPath(), "a");
    const child = spawn(process.execPath, [HOST_ENTRY], {
      detached: true, windowsHide: true, cwd: ROOT, stdio: ["ignore", fd, fd],
      env: { ...process.env, PORT: "8787", HOST: "0.0.0.0", VIBE_GIT_TUNNEL_TARGET: LOCAL_HOST }
    });
    child.unref(); closeSync(fd);
    info = { pid: child.pid!, hostUrl: LOCAL_HOST, startedAt: new Date().toISOString(), root: ROOT };
    await writeJson(hostProcessPath(), info);
    try { await waitForHost(LOCAL_HOST); }
    catch (error) { try { process.kill(info.pid, "SIGTERM"); } catch { /* no-op */ } throw error; }
  }

  const captainPath = resolve(ROOT, "data/v20/captain.json");
  const captain = await readJson<CaptainFile>(captainPath);
  if (!captain) throw new Error(`无法读取 Captain 凭据：${captainPath}`);
  const previous = await loadConfig(false);
  if (previous) await stopDaemon(previous);
  const config: ClientConfig = {
    hostUrl: LOCAL_HOST, nodeId: captain.nodeId, nodeToken: captain.nodeToken, workspace: process.cwd(),
    workTransport: previous?.nodeId === captain.nodeId ? previous.workTransport : "auto", daemonPid: null, connectedAt: new Date().toISOString()
  };
  await saveConfig(config);
  await spawnDaemon(config);
  await post(config, "/api/v1/nodes/heartbeat", {
    workspaceReady: false, codex: probeCodex().state, workTransport: config.workTransport, rateLimits: [], git: null, currentTaskId: null
  }).catch(() => undefined);

  let tunnelMessage = "";
  try {
    const tunnel = await api<{ installed: boolean; running: boolean; url: string | null }>(config, "/api/v1/local/cloudflare");
    if (!tunnel.installed) await post(config, "/api/v1/local/cloudflare/install");
    if (!tunnel.running) await post(config, "/api/v1/local/cloudflare/start");
  } catch (error) {
    tunnelMessage = `\nQuick Tunnel 未能自动启动：${error instanceof Error ? error.message : String(error)}\n可重试：vibe-git host start`;
  }
  const invite = await api<{ joinUrl: string; command: string }>(config, "/api/v1/invite");
  out(`Vibe-Git Host 已启动\n管理页：运行 vibe-git open\n成员加入：${invite.command}${tunnelMessage}`);
}

async function hostStatus(): Promise<void> {
  const info = await readJson<HostProcess>(hostProcessPath());
  if (!info || !isAlive(info.pid)) { out("Host 未运行"); return; }
  try {
    const health = await (await fetch(`${info.hostUrl}/health`)).json();
    const config = await loadConfig(false);
    const tunnel = config ? await api<unknown>(config, "/api/v1/local/cloudflare").catch(() => null) : null;
    out({ process: info, health, tunnel });
  } catch { out({ process: info, state: "进程存在但 Host 无响应", log: hostLogPath() }); }
}

async function hostStop(): Promise<void> {
  const info = await readJson<HostProcess>(hostProcessPath());
  let config = await loadConfig(false);
  if (config) {
    await post(config, "/api/v1/local/cloudflare/stop").catch(() => undefined);
    config = await stopDaemon(config);
  }
  if (info?.pid && isAlive(info.pid)) {
    try { process.kill(info.pid, "SIGTERM"); } catch { /* no-op */ }
    for (let i = 0; i < 30 && isAlive(info.pid); i += 1) await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  await rm(hostProcessPath(), { force: true });
  out("Host 与 Quick Tunnel 已停止");
}

async function connect(joinUrlRaw: string | undefined): Promise<void> {
  if (!joinUrlRaw) throw new Error("用法：vibe-git connect <join-url>");
  const url = new URL(joinUrlRaw);
  const match = url.pathname.match(/^\/join\/([^/]+)\/?$/);
  if (!match?.[1]) throw new Error("加入链接格式无效");
  const hostUrl = url.origin;
  const old = await loadConfig(false);
  if (old) {
    const reconnect = await fetch(`${hostUrl}/api/v1/bootstrap`, { headers: { authorization: `Bearer ${old.nodeToken}` } }).catch(() => null);
    if (reconnect?.ok) {
      const stable = { ...old, hostUrl, workspace: process.cwd(), connectedAt: new Date().toISOString() };
      await saveConfig(stable); const running = await spawnDaemon(stable);
      out(`已用原节点重连：${stable.nodeId}\n工作区：${stable.workspace}\n后台进程：${running.daemonPid ?? "启动中"}`);
      return;
    }
  }
  const response = await fetch(`${hostUrl}/api/v1/join`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ invite: decodeURIComponent(match[1]) })
  });
  const value = await response.json() as JoinResponse & { error?: string };
  if (!response.ok) throw new Error(value.error || `Host 返回 ${response.status}`);
  if (old) await stopDaemon(old);
  const config: ClientConfig = {
    hostUrl: value.hostUrl || hostUrl, nodeId: value.node.id, nodeToken: value.nodeToken,
    workspace: process.cwd(), workTransport: "auto", daemonPid: null, connectedAt: new Date().toISOString()
  };
  await saveConfig(config);
  const running = await spawnDaemon(config);
  out(`连接成功：${value.node.label} (${value.node.id})\n工作区：${running.workspace}\n后台进程：${running.daemonPid ?? "启动中"}`);
}

async function status(): Promise<void> {
  const config = await loadConfig(); if (!config) return;
  const data = await api<V20BootstrapPayload>(config, "/api/v1/bootstrap");
  const mine = data.tasks.filter((task) => task.assigneeNodeId === config.nodeId);
  out({
    node: data.viewer, daemon: { pid: config.daemonPid, running: isAlive(config.daemonPid) },
    room: data.room, auditPool: data.auditPool, myTasks: mine.map((task) => ({ id: task.id, title: task.title, status: task.status })),
    unreadMessages: data.notifications.filter((item) => !item.readAt).length
  });
}

async function readMarkdown(pathRaw: string | undefined, purpose: string): Promise<{ filename: string; content: string }> {
  if (!pathRaw) throw new Error(`缺少${purpose} Markdown 路径`);
  const path = resolve(pathRaw);
  const filename = basename(path);
  if (!/\.md$/i.test(filename)) throw new Error("请选择任意一个 .md 文件");
  const info = await stat(path);
  if (info.size > 256 * 1024) throw new Error("Markdown 不能超过 256 KiB");
  let content: string;
  try { content = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path)); }
  catch { throw new Error("Markdown 必须是有效 UTF-8"); }
  if (!content.trim() || content.includes("\u0000")) throw new Error("Markdown 必须是非空 UTF-8 文本");
  return { filename, content };
}

async function bootstrap(): Promise<{ config: ClientConfig; data: V20BootstrapPayload }> {
  const config = await loadConfig(); if (!config) throw new Error("尚未连接");
  return { config, data: await api<V20BootstrapPayload>(config, "/api/v1/bootstrap") };
}

function openUrl(url: string): void {
  if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], { windowsHide: true, detached: true, stdio: "ignore" }).unref();
  else if (process.platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

async function main(): Promise<void> {
  const [group, action, third, fourth] = args;
  if (group === "daemon") { await runDaemon(); return; }
  if (!group || group === "help" || group === "--help" || group === "-h") { out(usage()); return; }

  if (group === "host") {
    if (action === "start") return hostStart();
    if (action === "status") return hostStatus();
    if (action === "stop") return hostStop();
  }
  if (group === "connect") return connect(action);
  if (group === "status") return status();
  if (group === "logs") {
    const path = daemonLogPath();
    if (!existsSync(path)) { out("暂无日志"); return; }
    const lines = (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean).slice(-100);
    out(lines.join("\n")); return;
  }
  if (group === "disconnect") {
    const config = await loadConfig(false); await stopDaemon(config); await rm(configPath(), { force: true }); out("已断开并移除本机节点配置"); return;
  }
  if (group === "open") {
    const config = await loadConfig(); if (!config) return;
    let panel = await readJson<{ port: number; pid: number }>(localPanelPath());
    if (!panel || !isAlive(panel.pid)) { await spawnDaemon(config); panel = null; }
    let url: string | null = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      panel = panel ?? await readJson<{ port: number; pid: number }>(localPanelPath());
      if (panel && isAlive(panel.pid)) {
        try {
          const response = await fetch(`http://127.0.0.1:${panel.port}/_local/ticket`,
            { method: "POST", headers: { "x-vibe-git-control": config.nodeToken } });
          if (response.ok) { url = (await response.json() as { url: string }).url; break; }
        } catch { /* daemon has not bound its local panel yet */ }
      }
      panel = null;
      await new Promise((delay) => setTimeout(delay, 250));
    }
    if (!url) throw new Error("本机面板尚未就绪，请检查 vibe-git logs");
    openUrl(url); out("已在本机浏览器中打开 Vibe-Git；Codex 对话只在此电脑可用"); return;
  }
  if (group === "codex") {
    if (action === "bind") {
      const command = codexInvocation();
      await mkdir(defaultCodexHome(), { recursive: true, mode: 0o700 });
      const result = spawn(command.file, [...command.prefixArgs, "login", "--device-auth"], {
        stdio: "inherit", windowsHide: true, env: { ...process.env, CODEX_HOME: defaultCodexHome() }
      });
      const code = await new Promise<number | null>((resolveExit, reject) => {
        result.once("error", (error) => reject(new Error(`无法启动 Codex CLI：${error.message}`)));
        result.once("exit", resolveExit);
      });
      if (code !== 0) throw new Error(`Codex device-auth 失败（退出码 ${code ?? "null"}）`);
      out("Codex 算力网已接入；审核与开发共用本机默认登录"); return;
    }
    if (action === "status") { out({ home: defaultCodexHome(), ...probeCodex({ CODEX_HOME: defaultCodexHome() }) }); return; }
    if (action === "unbind") {
      throw new Error("审核与开发已共用本机 Codex 登录。如需退出，请在本机运行 codex logout；这会同时退出其他使用该登录的 Codex 客户端。");
    }
  }
  if (group === "config" && action === "set" && third === "work.transport") {
    if (!(["auto", "app-server", "cli"] as string[]).includes(fourth ?? "")) throw new Error("work.transport 只能是 auto、app-server 或 cli");
    const config = await loadConfig(); if (!config) return;
    const updated = { ...config, workTransport: fourth as WorkTransport };
    await saveConfig(updated); await spawnDaemon(updated); out(`work.transport = ${fourth}（后台进程已重载）`); return;
  }
  if (group === "invite") {
    const config = await loadConfig(); if (!config) return;
    if (action === "show") { const value = await api<{ command: string }>(config, "/api/v1/invite"); out(value.command); return; }
    if (action === "rotate") { const value = await post<{ command: string }>(config, "/api/v1/invite/rotate"); out(`邀请已轮换：\n${value.command}`); return; }
  }
  if (group === "plan" && action === "submit") {
    const { config, data } = await bootstrap(); const markdown = await readMarkdown(third, "计划");
    const current = data.plans.find((item) => item.ownerNodeId === data.viewer.id);
    const doc = current
      ? await api<MarkdownDocument>(config, `/api/v1/plans/${encodeURIComponent(current.id)}`, {
        method: "PUT", body: JSON.stringify({ ...markdown, expectedRevision: current.revision }) })
      : await post<MarkdownDocument>(config, "/api/v1/plans", markdown);
    out(`${doc.filename} 已作为计划提交：r${doc.revision} ${doc.sha256}`); return;
  }
  if (group === "align") {
    const { config, data } = await bootstrap();
    if (action === "start") { const value = await post<AlignmentRun>(config, "/api/v1/alignments"); out(`对齐已排队：${value.id}（执行节点 ${value.executorNodeId}）`); return; }
    if (action === "status") {
      out(data.alignments.map((item) => ({ id: item.id, source: item.source, status: item.status,
        summaryJobsPending: (item.summaryJobIds ?? []).filter((jobId) => !item.summaryParts?.[jobId]).length,
        issues: item.issues?.filter((issue) => !issue.selectedOptionId).length ?? 0,
        executor: item.executorNodeId, createdAt: item.createdAt, error: item.error }))); return;
    }
    if (action === "show") {
      const alignment = data.alignments.find((item) => item.id === third);
      if (!alignment) throw new Error("对齐记录不存在");
      out({ id: alignment.id, status: alignment.status, decisionRevision: alignment.decisionRevision ?? 0, issues: alignment.issues ?? [], tasks: alignment.tasks }); return;
    }
    if (action === "resolve") {
      const issueId = fourth, optionId = args[4];
      if (!third || !issueId || !optionId) throw new Error("用法：vibe-git align resolve <alignment-id> <issue-id> <option-id>");
      const alignment = data.alignments.find((item) => item.id === third);
      if (!alignment) throw new Error("对齐记录不存在");
      const updated = await post<AlignmentRun>(config, `/api/v1/alignments/${encodeURIComponent(third)}/resolve`, { issueId, optionId, expectedRevision: alignment.decisionRevision ?? 0 });
      out(`已选择 ${optionId}；当前对齐状态 ${updated.status}`); return;
    }
    if (action === "downgrade") {
      const taskId = fourth, upstreamTaskId = args[4];
      if (!third || !taskId || !upstreamTaskId) throw new Error("用法：vibe-git align downgrade <alignment-id> <task-id> <upstream-task-id>");
      await post(config, `/api/v1/alignments/${encodeURIComponent(third)}/downgrade`, { taskId, upstreamTaskId });
      out("依赖已降级为等待上游完成"); return;
    }
    if (action === "export") {
      if (!third) throw new Error("用法：vibe-git align export <alignment-id>");
      const markdown = await api<string>(config, `/api/v1/alignments/${encodeURIComponent(third)}/export`);
      const path = resolve(`alignment-${third}.md`); await writeFile(path, markdown, "utf8"); out(`已导出：${path}`); return;
    }
  }
  if (group === "stage" && action === "replan") {
    if (!third) throw new Error("缺少 stage-id");
    const config = await loadConfig(); if (!config) return;
    const alignment = await post<AlignmentRun>(config, `/api/v1/stages/${encodeURIComponent(third)}/replan`);
    out(`阶段重编排已排队：${alignment.id}`); return;
  }
  if (group === "stage" && action === "activate") {
    if (!third) throw new Error("缺少重编排 alignment-id");
    const config = await loadConfig(); if (!config) return;
    await post(config, `/api/v1/alignments/${encodeURIComponent(third)}/activate-replan`);
    out("工作主线已原子替换，旧任务保留归档"); return;
  }
  if (group === "contract") {
    const { config, data } = await bootstrap();
    if (action === "list") { out(data.contracts.map((item) => ({ id: item.id, name: item.name, revision: item.revision,
      status: item.status, acknowledgedNodeIds: item.acknowledgedNodeIds }))); return; }
    const contract = data.contracts.find((item) => item.id === third);
    if (!contract) throw new Error("接口契约不存在");
    if (action === "show") { out(contract); return; }
    if (action === "ack") { await post(config, `/api/v1/contracts/${encodeURIComponent(contract.id)}/ack`,
      { expectedRevision: contract.revision, sha256: contract.sha256 }); out(`已确认契约 ${contract.id} r${contract.revision}`); return; }
    if (action === "publish") { await post(config, `/api/v1/contracts/${encodeURIComponent(contract.id)}/publish`,
      { expectedRevision: contract.revision, sha256: contract.sha256 }); out(`已发布修订契约 ${contract.id} r${contract.revision}`); return; }
  }
  if (group === "work") {
    const { config, data } = await bootstrap();
    const visible = data.workstreams.filter((item) => data.viewer.role === "captain" || item.ownerNodeId === config.nodeId);
    if (action === "list") { out(visible.map((item) => ({ id: item.id, mission: item.mission, status: item.status, taskIds: item.taskIds }))); return; }
    if (action === "pull") {
      if (!third || !visible.some((item) => item.id === third)) throw new Error("工作主线不存在或无权下载");
      const markdown = await api<string>(config, `/api/v1/workstreams/${encodeURIComponent(third)}/brief`);
      const path = resolve(fourth || "workstream.md"); await writeFile(path, markdown, "utf8"); out(`已导出：${path}`); return;
    }
  }
  if (group === "tasks" && action === "publish") {
    if (!third) throw new Error("用法：vibe-git tasks publish <alignment-id>");
    const config = await loadConfig(); if (!config) return; const stage = await post<{ id: string; sequence: number }>(config, `/api/v1/alignments/${encodeURIComponent(third)}/publish`);
    out(`阶段 ${stage.sequence} 已发布：${stage.id}`); return;
  }
  if (group === "task") {
    const { config, data } = await bootstrap();
    if (action === "list") { out(data.tasks.filter((item) => data.viewer.role === "captain" || item.assigneeNodeId === config.nodeId).map((item) => ({ id: item.id, title: item.title, assignee: item.assigneeNodeId, status: item.status,
      workstreamId: item.workstreamId ?? null, dependencyEdges: item.dependencyEdges ?? [] }))); return; }
    if (action === "assign") {
      if (!third || !fourth) throw new Error("用法：vibe-git task assign <task-id> <node-id>");
      const alignment = [...data.alignments].reverse().find((item) => item.status === "READY" && item.tasks.some((task) => task.id === third));
      if (!alignment) throw new Error("没有包含该草稿任务的待发布对齐稿");
      await post(config, `/api/v1/alignments/${encodeURIComponent(alignment.id)}/assign`, { taskId: third, assigneeNodeId: fourth }); out(`已将 ${third} 改派给 ${fourth}`); return;
    }
    if (action === "pull") {
      if (!third) throw new Error("用法：vibe-git task pull <task-id> [output]");
      const value = await api<{ markdown: string }>(config, `/api/v1/tasks/${encodeURIComponent(third)}/detail`);
      const path = resolve(fourth || "task.md"); await writeFile(path, value.markdown, "utf8"); out(`已导出：${path}`); return;
    }
    if (action === "push") {
      if (!third || !fourth) throw new Error("用法：vibe-git task push <task-id> <任意文件.md>");
      const markdown = await readMarkdown(fourth, "任务细化"); const doc = await post<MarkdownDocument>(config, `/api/v1/tasks/${encodeURIComponent(third)}/detail`, markdown);
      out(`${doc.filename} 已作为任务细化上传：r${doc.revision}`); return;
    }
    if (action === "start") { if (!third) throw new Error("缺少 task-id"); const job = await post<{ id: string }>(config, `/api/v1/tasks/${encodeURIComponent(third)}/start`); out(`开工作业已发布：${job.id}`); return; }
    if (action === "integrate") { if (!third) throw new Error("缺少 task-id"); const job = await post<{ id: string }>(config, `/api/v1/tasks/${encodeURIComponent(third)}/integrate`); out(`真实集成验证已排队：${job.id}`); return; }
    if (action === "sync") { const job = await post<{ id: string }>(config, third ? `/api/v1/tasks/${encodeURIComponent(third)}/sync` : "/api/v1/tasks/sync"); out(`同步作业已发布：${job.id}`); return; }
    if (action === "done") { if (!third) throw new Error("缺少 task-id"); await post(config, `/api/v1/tasks/${encodeURIComponent(third)}/done`); out(`${third} 已确认完成`); return; }
  }
  if (group === "pr") {
    const config = await loadConfig(); if (!config) return;
    if (action === "submit") { const markdown = await readMarkdown(third, "需求变更"); const value = await post<{ id: string }>(config, "/api/v1/pull-requests", markdown); out(`Vibe-Git Pull Request 已提交：${value.id}`); return; }
    if (action === "list") { out(await api(config, "/api/v1/pull-requests")); return; }
  }
  if (group === "review") {
    const config = await loadConfig(); if (!config) return;
    if (action === "start") { if (!args.includes("--force")) throw new Error("开发中提前审核必须显式添加 --force"); const value = await post<{ id: string }>(config, "/api/v1/reviews", { force: true }); out(`强制审核已启动：${value.id}`); return; }
    if (action === "status") { const data = await api<V20BootstrapPayload>(config, "/api/v1/bootstrap"); out(data.reviews.map((item) => ({
      id: item.id, status: item.status, pendingNodeIds: item.pendingNodeIds ?? [],
      indexedNodeIds: Object.keys(item.indexes ?? {}), probedNodeIds: Object.keys(item.probes ?? {}),
      uncertainTaskIds: Object.values(item.probes ?? {}).flatMap((probe) => probe.uncertainTaskIds),
      uncertainReasons: Object.values(item.probes ?? {}).flatMap((probe) => probe.findings
        .filter((finding) => probe.uncertainTaskIds.includes(finding.taskId))
        .map((finding) => ({ taskId: finding.taskId, reason: finding.reason }))),
      summaryJobsPending: (item.summaryJobIds ?? []).filter((jobId) => !item.summaryParts?.[jobId]).length,
      error: item.error
    }))); return; }
    if (action === "apply") { if (!third) throw new Error("缺少 review-id"); await post(config, `/api/v1/reviews/${encodeURIComponent(third)}/apply`); out(`${third} 已应用`); return; }
    if (action === "reject") { if (!third) throw new Error("缺少 review-id"); await post(config, `/api/v1/reviews/${encodeURIComponent(third)}/reject`); out(`${third} 已退回`); return; }
    if (action === "cancel") { if (!third) throw new Error("缺少 review-id"); await post(config, `/api/v1/reviews/${encodeURIComponent(third)}/cancel`); out(`${third} 已取消，变更返回待审队列`); return; }
  }
  throw new Error(`未知命令：${command(...args)}\n\n${usage()}`);
}

main().catch((error) => {
  console.error(`错误：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
