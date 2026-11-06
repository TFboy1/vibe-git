import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { codexInvocation } from "../src/codex-command.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("Codex CLI 定位", () => {
  it("Windows PATH 未包含 codex 时使用桌面客户端附带的 codex.exe", async () => {
    if (process.platform !== "win32") return;
    const root = await mkdtemp(join(tmpdir(), "vibe-git-codex-command-")); roots.push(root);
    const directory = join(root, "OpenAI", "Codex", "bin", "build-hash");
    await mkdir(directory, { recursive: true });
    const executable = join(directory, "codex.exe");
    await writeFile(executable, "fixture", "utf8");
    expect(codexInvocation({ PATH: "", LOCALAPPDATA: root })).toEqual({ file: executable, prefixArgs: [] });
  });

  it("显式 codex.js 通过 Node 启动，避免执行 Windows shell shim", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibe-git-codex-command-")); roots.push(root);
    const script = join(root, "codex.js");
    await writeFile(script, "", "utf8");
    expect(codexInvocation({ CODEX_BIN: script })).toEqual({ file: process.execPath, prefixArgs: [script] });
  });

  it("配置路径不存在时给出可理解的错误", () => {
    expect(() => codexInvocation({ CODEX_BIN: join(tmpdir(), "missing-codex.exe") })).toThrow("CODEX_BIN 指向的文件不存在");
  });
});
