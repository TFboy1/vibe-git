import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { probeGit } from "../src/git-probe.js";

const temporaryRoot = realpathSync(tmpdir());
const directories: string[] = [];
function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function repository() {
  const cwd = mkdtempSync(join(temporaryRoot, "vibe-git-relay-test-")); directories.push(cwd);
  git(cwd, "init", "--initial-branch=main");
  writeFileSync(join(cwd, "sample.txt"), "工作单元 Git 测试\n", "utf8");
  git(cwd, "add", "sample.txt");
  git(cwd, "-c", "user.name=Relay Test", "-c", "user.email=relay-test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "fixture");
  return cwd;
}
afterEach(() => {
  for (const cwd of directories.splice(0)) {
    const target = resolve(cwd);
    // Delete only the exact temporary repository created by this suite.
    if (dirname(target) !== temporaryRoot || !basename(target).startsWith("vibe-git-relay-test-")) throw new Error("Unsafe cleanup path");
    rmSync(target, { recursive: true, force: true });
  }
});

describe("Relay Git 探测", () => {
  it("从真实本机 Git 读取 SHA，并绑定配置的 WorkUnit", () => {
    const cwd = repository();
    const result = probeGit(cwd, "B", "TASK-B", "WU-B-AUTH");
    expect(result).toMatchObject({ memberId: "B", taskId: "TASK-B", workUnitId: "WU-B-AUTH", branch: "main", dirty: false });
    expect(result?.headSha).toBe(git(cwd, "rev-parse", "HEAD"));
    expect(result?.baseSha).toBe(result?.headSha);
    writeFileSync(join(cwd, "sample.txt"), "未提交修改\n", "utf8");
    expect(probeGit(cwd, "B", "TASK-B", "WU-B-AUTH")?.dirty).toBe(true);
  });
  it("未配置 WorkUnit 时保持旧协议，但不推断或伪造单元 ID", () => {
    const cwd = repository();
    const result = probeGit(cwd, "A", "TASK-A");
    expect(result).toBeDefined();
    expect(result).not.toHaveProperty("workUnitId");
    git(cwd, "checkout", "--detach");
    expect(probeGit(cwd, "A", "TASK-A")?.branch).toBe("DETACHED");
  });
  it("非 Git 工作区不产生虚假的 Git 引用", () => {
    const cwd = mkdtempSync(join(temporaryRoot, "vibe-git-relay-test-")); directories.push(cwd);
    expect(probeGit(cwd, "B", "TASK-B", "WU-B-AUTH")).toBeUndefined();
  });
});
