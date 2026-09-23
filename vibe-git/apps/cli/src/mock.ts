import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { InterfaceContract } from "@vibe-git/protocol";
import { startDevelopment } from "./codex.js";
import type { ClientConfig } from "./config.js";

const safeId = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_");
export const mockDirectory = (workspace: string, taskId: string) => resolve(workspace, ".vibe-git", "mocks", safeId(taskId));

async function excludeLocalMocks(workspace: string): Promise<void> {
  const path = join(workspace, ".git", "info", "exclude");
  if (!existsSync(path)) return;
  const before = await readFile(path, "utf8");
  if (!before.split(/\r?\n/).includes("/.vibe-git/mocks/")) await appendFile(path, `${before.endsWith("\n") ? "" : "\n"}/.vibe-git/mocks/\n`, "utf8");
}

function runTest(workspace: string, file: string): string {
  if (!existsSync(file)) throw new Error(`本机契约测试不存在：${file}`);
  const output = execFileSync(process.execPath, ["--test", file], {
    cwd: workspace, encoding: "utf8", timeout: 120_000, maxBuffer: 2 * 1024 * 1024,
    windowsHide: true, env: { PATH: process.env.PATH ?? process.env.Path ?? "", SystemRoot: process.env.SystemRoot ?? "" }
  });
  const match = output.match(/# tests\s+(\d+)/);
  if (!match || Number(match[1]) < 1 || !/# fail\s+0\b/.test(output)) throw new Error("契约测试未报告至少一项通过的测试");
  return `${match[1]} 项契约测试通过`;
}

export async function prepareMock(config: ClientConfig, taskId: string, contracts: InterfaceContract[],
  onStarted: (runtimeId: string) => Promise<void>): Promise<{ contractHashes: Record<string, string>; summary: string }> {
  const directory = mockDirectory(config.workspace, taskId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await excludeLocalMocks(config.workspace);
  const hashes = Object.fromEntries(contracts.map((item) => [item.id, item.sha256]));
  const prompt = [
    "你是成员本机的 Codex，负责为已由双方确认的接口契约生成确定性本地开发 Mock；不是实时用模型扮演接口。",
    `只把 Mock 与测试写到 ${directory}，不要修改其他文件、不要读取凭据、不要提交 Git。必须生成 mock.mjs、contract.test.mjs、integration.test.mjs。`,
    "contract.test.mjs 使用 node:test 测试 mock.mjs 的成功、错误与边界样例；integration.test.mjs 使用同样的断言调用将来真实的提供方实现，不能导入 mock.mjs。真实实现尚未到位时，integration.test.mjs 可以暂时失败。",
    "只有本地契约测试通过才允许开发作业开始；不要伪造测试结果。",
    `<contracts>${JSON.stringify(contracts)}</contracts>`
  ].join("\n\n");
  const run = await startDevelopment(prompt, config.workspace, config.workTransport);
  await onStarted(run.runtimeId);
  const result = await run.done;
  if (result.status !== "completed") throw new Error(`Mock 生成失败：${result.detail}`);
  if (!existsSync(join(directory, "mock.mjs")) || !existsSync(join(directory, "integration.test.mjs"))) throw new Error("Codex 未生成完整的本地 Mock 与真实集成测试");
  const summary = runTest(config.workspace, join(directory, "contract.test.mjs"));
  return { contractHashes: hashes, summary };
}

export function integrateWithReal(config: ClientConfig, taskId: string, upstreamShas: string[], contracts: InterfaceContract[]): {
  contractHashes: Record<string, string>; headSha: string; summary: string
} {
  const headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: config.workspace, encoding: "utf8", windowsHide: true }).trim();
  for (const sha of upstreamShas) {
    if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error("上游交接 SHA 无效");
    execFileSync("git", ["merge-base", "--is-ancestor", sha, headSha], { cwd: config.workspace, windowsHide: true });
  }
  const summary = runTest(config.workspace, join(mockDirectory(config.workspace, taskId), "integration.test.mjs"));
  return { contractHashes: Object.fromEntries(contracts.map((item) => [item.id, item.sha256])), headSha, summary };
}
