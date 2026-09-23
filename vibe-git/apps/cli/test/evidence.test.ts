import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { impactIndex, repositoryContext, worktreeFingerprint } from "../src/evidence.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();

describe("本地只读代码证据", () => {
  it("大仓库只上传受限摘要，工作树改变后指纹也改变", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "vibe-git-evidence-")); roots.push(root);
    git(root, "init"); git(root, "config", "user.email", "test@example.test"); git(root, "config", "user.name", "Test");
    await mkdir(resolve(root, "src"));
    await writeFile(resolve(root, "package.json"), '{"name":"fixture","scripts":{"test":"echo SENSITIVE_CONFIG_VALUE"}}\n', "utf8");
    await writeFile(resolve(root, "src", "login.ts"), `export const secret = "${"SENSITIVE_SOURCE".repeat(40_000)}";\n`, "utf8");
    git(root, "add", "."); git(root, "commit", "-m", "base");
    const base = git(root, "rev-parse", "HEAD");
    const context = await repositoryContext(root);
    expect(context.headSha).toBe(base);
    expect(context.summary).toContain("package.json");
    expect(context.summary).not.toContain("SENSITIVE_SOURCE");
    expect(context.summary).not.toContain("SENSITIVE_CONFIG_VALUE");
    expect(Buffer.byteLength(context.summary, "utf8")).toBeLessThan(12_000);
    const before = await worktreeFingerprint(root);
    await writeFile(resolve(root, "src", "login.ts"), 'export const login = "new behavior";\n', "utf8");
    const after = await worktreeFingerprint(root);
    expect(after.fingerprint).not.toBe(before.fingerprint);
    await writeFile(resolve(root, "scratch.txt"), "first", "utf8");
    const untrackedBefore = await worktreeFingerprint(root);
    await writeFile(resolve(root, "scratch.txt"), "other", "utf8");
    const untrackedAfter = await worktreeFingerprint(root);
    expect(untrackedAfter.fingerprint).not.toBe(untrackedBefore.fingerprint);
    const index = await impactIndex(root, base, ["TASK-1"], "登录行为需要调整");
    expect(index.changedPaths).toContain("src/login.ts");
    expect(JSON.stringify(index)).not.toContain("new behavior");
    expect(index.fingerprint).toBe(untrackedAfter.fingerprint);
  });
});
