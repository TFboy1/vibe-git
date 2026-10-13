import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCodexHome, type ClientConfig } from "../src/config.js";
import { codexModelSettings, LocalAppServer, resolveCodexModel, saveCodexModel } from "../src/local-chat.js";
import { runAudit, startDevelopment } from "../src/codex.js";
vi.mock("../src/codex-command.js", () => ({ codexInvocation: () => ({ file: process.execPath, prefixArgs: [process.env.VIBE_TEST_CODEX!] }) }));
let root: string, config: ClientConfig;
beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), "vibe-models-"));
  vi.stubEnv("VIBE_GIT_HOME", resolve(root, "settings")); vi.stubEnv("CODEX_HOME", resolve(root, "codex"));
  vi.stubEnv("VIBE_TEST_LOG", resolve(root, "calls.jsonl")); vi.stubEnv("VIBE_TEST_CODEX", resolve(root, "fake-codex.mjs"));
  config = { hostUrl: "http://host.test", nodeId: "captain", nodeToken: "fake-token", workspace: root, daemonPid: null, workTransport: "auto", connectedAt: "now" };
  await writeFile(process.env.VIBE_TEST_CODEX!, `
import { appendFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const args = process.argv.slice(2), send = value => process.stdout.write(JSON.stringify(value) + '\\n');
appendFileSync(process.env.VIBE_TEST_LOG, JSON.stringify({ args }) + '\\n', 'utf8');
if (args.includes('exec')) {
  process.stdin.resume();
  send({ type:'thread.started', thread_id:'test-cli-thread' });
  send({ type:'turn.started' });
  send({ type:'item.completed', item:{ type:'reasoning', text:'已核对需求输入' } });
  setTimeout(() => { if(args.includes('--output-last-message')) writeFileSync(args[args.indexOf('--output-last-message')+1], JSON.stringify({ok:true}), 'utf8'); send({type:'item.completed',item:{type:'agent_message',text:'{"ok":true}'}}); process.exit(0); }, 200);
} else createInterface({input:process.stdin}).on('line', line => {
  const request = JSON.parse(line); if (request.id === undefined) return;
  appendFileSync(process.env.VIBE_TEST_LOG, JSON.stringify(request) + '\\n', 'utf8');
  const result = request.method === 'model/list' ? {data:[{id:'model-a',model:'model-a',displayName:'Model A',isDefault:true},{id:'model-b',model:'model-b',displayName:'Model B'}]} : request.method === 'config/read' ? {config:{model:'codex-inherited'}} : request.method === 'thread/start' ? {thread:{id:'test-thread'}} : request.method === 'turn/start' ? {turn:{id:'test-turn'}} : {};
  send({id:request.id,result});
  if(request.method === 'turn/start') setTimeout(() => { send({method:'item/agentMessage/delta',params:{delta:'ok'}}); send({method:'turn/completed',params:{turn:{id:'test-turn',status:'completed'}}}); }, 20);
});`, "utf8");
});
afterEach(async () => { vi.unstubAllEnvs(); if (!resolve(root).startsWith(resolve(tmpdir(), "vibe-models-"))) throw new Error("Invalid cleanup target"); await rm(root, { recursive: true, force: true, maxRetries: 12, retryDelay: 50 }); });
const calls = async () => (await readFile(process.env.VIBE_TEST_LOG!, "utf8")).trim().split("\n").map(line => JSON.parse(line));
describe("Vibe-Git 本机默认模型", () => {
  it("独立保存并跨项目读取，继承默认时显示具体模型，拒绝未知模型", async () => {
    await mkdir(defaultCodexHome()); const original = 'model = "原有默认"\n'; await writeFile(resolve(defaultCodexHome(), "config.toml"), original, "utf8");
    expect(await codexModelSettings(root)).toMatchObject({ selectedModel: null, effectiveModel: "codex-inherited", source: "codex" });
    expect(await saveCodexModel(config, "model-a")).toMatchObject({ selectedModel: "model-a", effectiveModel: "model-a", source: "vibe-git" });
    expect(await resolveCodexModel(resolve(root, "another-project"))).toBe("model-a");
    expect(await resolveCodexModel(root, "model-b")).toBe("model-b");
    await expect(saveCodexModel(config, "unknown")).rejects.toThrow("模型列表");
    expect(await readFile(resolve(defaultCodexHome(), "config.toml"), "utf8")).toBe(original);
    expect(await saveCodexModel(config, null)).toMatchObject({ selectedModel: null, effectiveModel: "codex-inherited" });
  });
  it("审核显式传递模型并输出真实事件，运行中的作业不跟随后续设置变化", async () => {
    await saveCodexModel(config, "model-a");
    let started!: () => void; const active = new Promise<void>(done => { started = done; });
    const activity: string[] = [];
    const running = runAudit("test", {}, root, defaultCodexHome(), undefined, { onActivity: value => { activity.push(value.message); if (value.model === "model-a") started(); } });
    await active; await saveCodexModel(config, "model-b");
    expect(await running).toEqual({ ok: true });
    expect(await runAudit("test", {}, root, defaultCodexHome())).toEqual({ ok: true });
    const executions = (await calls()).filter(value => value.args?.includes("exec"));
    expect(executions.map(value => value.args[value.args.indexOf("--model") + 1])).toEqual(["model-a", "model-b"]);
    expect(executions.every(value => value.args.includes("--json"))).toBe(true); expect(activity).toContain("已核对需求输入");
  });
  it("App Server 对话共用本机默认，同时保留明确的本次覆盖", async () => {
    await saveCodexModel(config, "model-a"); const app = new LocalAppServer(root);
    try {
      await app.initialize();
      expect(await app.turn("thread", "test", root, () => undefined)).toBe("ok");
      expect(await app.turn("thread", "test", root, () => undefined, undefined, "model-b")).toBe("ok");
      expect((await calls()).filter(value => value.method === "turn/start").map(value => value.params.model)).toEqual(["model-a", "model-b"]);
    } finally { app.close(); }
  });
  it("受管开发的 CLI 和 App Server 都传递本机默认模型", async () => {
    await saveCodexModel(config, "model-b");
    const cli = await startDevelopment("test", root, "cli"); expect((await cli.done).status).toBe("completed");
    const server = await startDevelopment("test", root, "app-server"); expect((await server.done).status).toBe("completed");
    const captured = await calls(), execution = captured.find(value => value.args?.includes("exec"));
    expect(execution.args[execution.args.indexOf("--model") + 1]).toBe("model-b");
    expect(captured.filter(value => value.method === "thread/start").at(-1).params.model).toBe("model-b");
  });
});
