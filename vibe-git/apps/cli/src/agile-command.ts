import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { AgileFlow, V20BootstrapPayload } from "@vibe-git/protocol";
import type { ClientConfig } from "./config.js";
import { api, post } from "./api.js";

export const AGILE_USAGE = [
  "  vibe-git profile set <显示名字>",
  "  vibe-git plan submit <计划.md> | pr submit <变更.md>",
  "  vibe-git task inbox | report <task-id> <report.json>",
  "  vibe-git agile start | review [pr-id ...] | list | show <flow-id> | wait <flow-id> [timeout-seconds]",
  "  vibe-git agile answer <flow-id> <answer.json> | draft <flow-id> <需求.md> | allocation <flow-id> <分工.json>",
  "  vibe-git agile requirement|allocate|publish|retry|cancel|reject <flow-id>"
].join("\n") + "\n";
async function utf8(file: string | undefined): Promise<string> {
  if (!file) throw new Error("缺少 UTF-8 文件路径");
  const path = resolve(file), info = await stat(path);
  if (!info.isFile() || info.size > 256 * 1024) throw new Error("文件须不超过 256 KiB");
  return new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path));
}
function json(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON 必须是对象");
  return parsed as Record<string, unknown>;
}
// A single SSE connection blocks until this flow needs attention, without status polling.
export async function waitForAgile(config: ClientConfig, flowId: string, seconds = 600): Promise<AgileFlow> {
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3_600) throw new Error("等待时间应为 1–3600 秒");
  const state = await api<V20BootstrapPayload>(config, "/api/v1/bootstrap");
  const initial = state.agile?.flows.find(flow => flow.id === flowId);
  if (!initial) throw new Error("流程不存在");
  if (!["ANALYZING", "PLANNING"].includes(initial.status)) return initial;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), seconds * 1_000);
  try {
    const response = await fetch(config.hostUrl.replace(/\/$/, "") + "/api/v1/events?since=" + state.room.seq, {
      headers: { authorization: "Bearer " + config.nodeToken }, signal: controller.signal
    });
    if (!response.ok || !response.body) throw new Error("无法建立流程等待连接");
    const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }); let pending = "";
    try {
      while (true) {
        const part = await reader.read(); if (part.done) throw new Error("等待连接已断开，请重新运行 agile wait");
        pending = (pending + decoder.decode(part.value, { stream: true })).replace(/\r\n/g, "\n");
        let end: number;
        while ((end = pending.indexOf("\n\n")) >= 0) {
          const frame = pending.slice(0, end); pending = pending.slice(end + 2);
          const data = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
          if (!data) continue;
          const event = JSON.parse(data) as { entityId: string };
          if (event.entityId !== flowId) continue;
          const snapshot = await api<V20BootstrapPayload>(config, "/api/v1/bootstrap");
          const current = snapshot.agile?.flows.find(flow => flow.id === flowId);
          if (current && !["ANALYZING", "PLANNING"].includes(current.status)) return current;
        }
      }
    } finally { await reader.cancel().catch(() => undefined); }
  } catch (error) {
    if (controller.signal.aborted) throw new Error("等待超时，作业和草稿仍保留，可重新运行 agile wait");
    throw error;
  } finally { clearTimeout(timer); controller.abort(); }
}
export async function handleAgileCommand(
  args: string[], bootstrap: () => Promise<{ config: ClientConfig; data: V20BootstrapPayload }>, out: (value: unknown) => void
): Promise<boolean> {
  const [group, action, id, file] = args;
  const candidate = group === "agile" || group === "profile" || (group === "task" && ["inbox", "report"].includes(action ?? "")) ||
    ((group === "plan" || group === "pr") && action === "submit");
  if (!candidate) return false;
  const { config, data } = await bootstrap();
  if ((group === "plan" || group === "pr") && !data.agile?.enabled) return false;
  if (group === "task" && action === "inbox") { out(await api(config, "/api/v1/agile/inbox")); return true; }
  if (group === "task" && action === "report") {
    if (!id) throw new Error("缺少 task-id");
    const body = json(await utf8(file));
    // Deliberately do not fill versions from bootstrap: the caller must report the consumed package.
    out(await post(config, "/api/v1/agile/tasks/" + encodeURIComponent(id) + "/report", body)); return true;
  }
  if (group === "profile" && action === "set") {
    out(await api(config, "/api/v1/agile/profile", { method: "PUT", body: JSON.stringify({ label: args.slice(2).join(" ") }) })); return true;
  }
  if (group === "plan") {
    const content = await utf8(id), current = data.plans.find(plan => plan.ownerNodeId === data.viewer.id);
    out(await api(config, "/api/v1/agile/plan", { method: "PUT",
      body: JSON.stringify({ expectedRevision: current?.revision ?? 0, filename: basename(id!), content }) })); return true;
  }
  if (group === "pr") {
    const content = await utf8(id), title = content.match(/^#\s+(.+)$/m)?.[1] ?? basename(id!, ".md");
    out(await post(config, "/api/v1/agile/pull-requests", { title, content, filename: basename(id!), expectedRequirementRevision: data.room.requirementRevision })); return true;
  }
  if (group === "agile") {
    if (action === "list") { out(data.agile?.flows ?? []); return true; }
    if (action === "start" || action === "review") {
      out(await post(config, "/api/v1/agile/" + (action === "start" ? "initial" : "reviews"), { expectedRequirementRevision: data.room.requirementRevision,
        ...(action === "review" && args.length > 2 ? { changeIds: args.slice(2) } : {}) })); return true;
    }
    const flow = data.agile?.flows.find(flow => flow.id === id);
    if (!flow) throw new Error("请提供真实 flow-id，可用 agile list 查看");
    if (action === "show") { out(flow); return true; }
    if (action === "wait") { out(await waitForAgile(config, flow.id, file === undefined ? 600 : Number(file))); return true; }
    let body: Record<string, unknown> = { expectedRevision: flow.revision };
    if (action === "answer" || action === "decisions") body = { ...json(await utf8(file)), expectedRevision: flow.revision };
    if (action === "draft") body.markdown = await utf8(file);
    if (action === "allocation") body = { ...json(await utf8(file)), expectedRevision: flow.revision, draftRevision: flow.draftRevision };
    if (!["answer", "decisions", "draft", "allocation", "requirement", "allocate", "publish", "retry", "cancel", "reject"].includes(action ?? "")) throw new Error(AGILE_USAGE);
    out(await post(config, "/api/v1/agile/flows/" + encodeURIComponent(flow.id) + "/" + action, body)); return true;
  }
  throw new Error(AGILE_USAGE);
}
