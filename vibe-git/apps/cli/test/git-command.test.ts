import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gitExecutable } from "../src/git-command.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Windows Git 定位", () => {
  it.skipIf(process.platform !== "win32")("PATH 缺失时找到 Codex 运行时中的 Git", async () => {
    const profile = await mkdtemp(resolve(tmpdir(), "vibe-git-bin-")); roots.push(profile);
    const bundled = resolve(profile, ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "native", "git", "cmd", "git.exe");
    await mkdir(resolve(bundled, ".."), { recursive: true });
    await writeFile(bundled, "", "utf8");
    expect(gitExecutable({ PATH: "", Path: "", USERPROFILE: profile, ProgramFiles: profile, "ProgramFiles(x86)": profile, LOCALAPPDATA: profile })).toBe(bundled);
  });

  it("GIT_BIN 路径错误时给出明确提示", () => {
    expect(() => gitExecutable({ GIT_BIN: resolve(tmpdir(), "git-does-not-exist.exe") })).toThrow(/GIT_BIN.*不存在/);
  });
});
