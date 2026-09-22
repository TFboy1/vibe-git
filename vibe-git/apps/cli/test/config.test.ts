import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, saveConfig } from "../src/config.js";

const paths: string[] = [];
afterEach(async () => { delete process.env.VIBE_GIT_HOME; await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("CLI 本机配置", () => {
  it("以 UTF-8 原子保存节点凭据和工作区", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "vibe-git-cli-")); paths.push(root); process.env.VIBE_GIT_HOME = root;
    const value = { hostUrl: "https://example.test", nodeId: "node-一", nodeToken: "secret", workspace: "D:\\项目", workTransport: "auto" as const, daemonPid: null, connectedAt: new Date().toISOString() };
    await saveConfig(value);
    expect(await loadConfig()).toEqual(value);
  });
});

