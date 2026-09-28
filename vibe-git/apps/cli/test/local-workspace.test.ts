import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, readJson, writeJson, type ClientConfig } from "../src/config.js";
import { localPanelPath, startLocalPanel } from "../src/local-panel.js";
import { assertProjectWorkspacePath, ensureGitWorkspace, workspaceController } from "../src/local-workspace.js";

const roots: string[] = [];
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
afterEach(async () => {
  delete process.env.VIBE_GIT_HOME;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("独立项目工作区", () => {
  it("在新目录自动建立 main 与初始提交，保留已有源码为未跟踪文件", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "vibe-git-workspace-")); roots.push(root);
    const fresh = resolve(root, "fresh");
    const info = await ensureGitWorkspace(fresh);
    expect(info.valid).toBe(true);
    expect(info.path).toBe(fresh);
    expect(git(fresh, "branch", "--show-current")).toBe("main");
    expect(git(fresh, "ls-files")).toBe("");

    const existing = resolve(root, "existing");
    await mkdir(existing);
    await writeFile(resolve(existing, "idea.md"), "项目想法\n", "utf8");
    await writeFile(resolve(existing, ".gitignore"), "node_modules/\n", "utf8");
    await ensureGitWorkspace(existing);
    expect(git(existing, "ls-files")).toBe("");
    expect(git(existing, "status", "--porcelain")).toContain("idea.md");
    expect(git(existing, "status", "--porcelain")).toContain(".gitignore");
    expect(await readFile(resolve(existing, ".gitignore"), "utf8")).toBe("node_modules/\n");
    expect(git(existing, "check-ignore", ".vibe-git/host/workspace.db")).toBe(".vibe-git/host/workspace.db");
  });

  it("选择目录不会初始化 Git，初始化时拒绝嵌套仓库与安装目录", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "vibe-git-workspace-")); roots.push(root);
    process.env.VIBE_GIT_HOME = resolve(root, "config");
    const packageRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
    expect(() => assertProjectWorkspacePath(packageRoot)).toThrow(/安装目录/);

    const outer = resolve(root, "outer");
    await ensureGitWorkspace(outer);
    const nested = resolve(outer, "nested");
    const config: ClientConfig = { hostUrl: "http://localhost:8787", nodeId: "node", nodeToken: "token", workspace: outer,
      workTransport: "auto", daemonPid: null, connectedAt: new Date().toISOString() };
    const controller = workspaceController(config, () => null, async () => undefined);
    await mkdir(nested);
    expect((await controller.select(nested)).selected).toBe(true);
    await expect(controller.init()).rejects.toThrow(/现有 Git 仓库/);
    expect(existsSync(resolve(nested, ".git"))).toBe(false);
    await expect(controller.select(packageRoot)).rejects.toThrow(/安装目录/);
    expect(config.workspace).toBe(nested);

    const replacement = resolve(root, "replacement");
    await mkdir(replacement);
    const bound = await controller.select(replacement, { name: "我的项目" });
    expect(bound.selected).toBe(true);
    expect(bound.valid).toBe(false);
    expect(existsSync(resolve(replacement, ".git"))).toBe(false);
    expect(existsSync(resolve(replacement, ".vibe-git"))).toBe(false);
    expect(config.workspace).toBe(replacement);
    expect((await loadConfig())?.workspace).toBe(replacement);
    expect((await controller.get()).name).toBe("我的项目");
    expect((await controller.get()).selected).toBe(true);
    const initialized = await controller.init();
    expect(initialized.valid).toBe(true);
    expect((await readJson<{ name: string }>(resolve(replacement, ".vibe-git", "project.json")))?.name).toBe("我的项目");
    const other = resolve(root, "not-created");
    await expect(controller.select(other, { initialize: false })).rejects.toThrow(/目录不存在/);
    expect(existsSync(other)).toBe(false);
  });

  it("本机票据页面先绑定目录，再通过独立接口初始化 Git", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "vibe-git-workspace-")); roots.push(root);
    process.env.VIBE_GIT_HOME = resolve(root, "config");
    const packageRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
    const config: ClientConfig = { hostUrl: "http://localhost:8787", nodeId: "node", nodeToken: "test-token", workspace: packageRoot,
      workTransport: "auto", daemonPid: null, connectedAt: new Date().toISOString() };
    await writeJson(resolve(root, "config", "recent-workspaces.json"), [
      { path: packageRoot, name: "安装目录" },
      { path: resolve(root, "missing-project"), name: "已删除项目" },
    ]);
    const panel = await startLocalPanel(config);
    try {
      const base = `http://127.0.0.1:${panel.port}`;
      expect((await fetch(`${base}/api/local/workspace`)).status).toBe(403);
      expect((await fetch(`${base}/api/local/workspace/pick`, { method: "POST" })).status).toBe(403);
      expect((await fetch(`${base}/_local/restart`, { method: "POST" })).status).toBe(403);
      const ticketResponse = await fetch(`${base}/_local/ticket`, { method: "POST", headers: { "x-vibe-git-control": config.nodeToken } });
      const ticket = await ticketResponse.json() as { url: string };
      const opened = await fetch(ticket.url, { redirect: "manual" });
      const cookie = opened.headers.get("set-cookie")!.split(";")[0]!;
      expect((await fetch(`${base}/api/local/workspace/pick`, { method: "POST", headers: { cookie, origin: "http://example.invalid" } })).status).toBe(403);
      const before = await (await fetch(`${base}/api/local/workspace`, { headers: { cookie } })).json() as { valid: boolean; selected: boolean; recent: unknown[]; error: string };
      expect(before.valid).toBe(false);
      expect(before.selected).toBe(false);
      expect(before.recent).toEqual([]);
      expect(before.error).toMatch(/安装目录/);
      const target = resolve(root, "project");
      await mkdir(target);
      const selectedResponse = await fetch(`${base}/api/local/workspace/select`, {
        method: "POST", headers: { cookie, origin: base, "content-type": "application/json" }, body: JSON.stringify({ path: target, name: "新的项目", initialize: true })
      });
      expect(selectedResponse.status).toBe(200);
      const selected = await selectedResponse.json() as { path: string; name: string; valid: boolean; selected: boolean };
      expect(selected.valid).toBe(false);
      expect(selected.selected).toBe(true);
      expect(selected.name).toBe("新的项目");
      expect(existsSync(resolve(target, ".git"))).toBe(false);
      expect(config.workspace).toBe(target);
      expect((await loadConfig())?.workspace).toBe(target);
      const initializedResponse = await fetch(`${base}/api/local/workspace/init`, {
        method: "POST", headers: { cookie, origin: base, "content-type": "application/json" }, body: JSON.stringify({ path: target })
      });
      expect(initializedResponse.status).toBe(200);
      expect((await initializedResponse.json() as { valid: boolean }).valid).toBe(true);
      expect(existsSync(resolve(target, ".git"))).toBe(true);
      expect((await readJson<{ port: number }>(localPanelPath()))?.port).toBe(panel.port);
    } finally { await panel.close(); }
  });
});
