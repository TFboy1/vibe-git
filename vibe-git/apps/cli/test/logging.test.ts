import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appendLog, createLogStream, MAX_LOG_BYTES, openLogFile } from "@vibe-git/protocol/logging";
import { buildApp } from "../../host/dist/app.js";

const temporaryRoot = realpathSync(tmpdir());
const roots: string[] = [];
async function logPath(): Promise<string> {
  const root = await mkdtemp(join(temporaryRoot, "vibe-log-"));
  roots.push(root);
  return join(root, "host.log");
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== temporaryRoot || !basename(root).startsWith("vibe-log-")) throw new Error("Invalid log test cleanup target");
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe("后台日志轮转", () => {
  it("未超限时连续追加 UTF-8 日志", async () => {
    const path = await logPath();
    appendLog(path, "第一条日志\n");
    appendLog(path, "第二条日志\n");
    expect(readFileSync(path, "utf8")).toBe("第一条日志\n第二条日志\n");
    expect(existsSync(`${path}.1`)).toBe(false);
  });

  it("运行中轮转并仅保留最新两个备份", async () => {
    const path = await logPath();
    for (const text of ["aaaaaaaa", "bbbbbbbb", "cccccccc", "dddddddd"]) appendLog(path, text, 8);
    expect(readFileSync(path, "utf8")).toBe("dddddddd");
    expect(readFileSync(`${path}.1`, "utf8")).toBe("cccccccc");
    expect(readFileSync(`${path}.2`, "utf8")).toBe("bbbbbbbb");
    expect(readdirSync(dirname(path)).sort()).toEqual(["host.log", "host.log.1", "host.log.2"]);
  });

  it("单次大量写入也限制每份文件大小", async () => {
    const path = await logPath();
    appendLog(path, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", 8);
    const files = [`${path}.2`, `${path}.1`, path];
    for (const file of files) expect(statSync(file).size).toBeLessThanOrEqual(8);
    expect(files.map(file => readFileSync(file, "utf8")).join("")).toBe("IJKLMNOPQRSTUVWXYZ");
  });

  it("普通 JSON 日志在轮转时保持整条记录", async () => {
    const path = await logPath();
    appendLog(path, '{"id":1}\n', 12);
    appendLog(path, '{"id":2}\n', 12);
    expect(JSON.parse(readFileSync(`${path}.1`, "utf8")).id).toBe(1);
    expect(JSON.parse(readFileSync(path, "utf8")).id).toBe(2);
  });

  it("跨文件写入不切断中文字符", async () => {
    const path = await logPath();
    appendLog(path, "你好你好你好", 8);
    const files = [`${path}.2`, `${path}.1`, path];
    for (const file of files) {
      expect(statSync(file).size).toBeLessThanOrEqual(8);
      expect(readFileSync(file, "utf8")).not.toContain("\ufffd");
    }
    expect(files.map(file => readFileSync(file, "utf8")).join("")).toBe("你好你好你好");
  });

  it("启动时将遗留的大日志限制为末尾最多 20 MiB", async () => {
    const path = await logPath();
    writeFileSync(path, "旧内容\n", "utf8");
    appendFileSync(path, Buffer.alloc(MAX_LOG_BYTES, 0x61));
    appendFileSync(path, "结尾\n", "utf8");
    const fd = openLogFile(path);
    closeSync(fd);
    expect(statSync(path).size).toBe(0);
    expect(statSync(`${path}.1`).size).toBeLessThanOrEqual(MAX_LOG_BYTES);
    const tail = readFileSync(`${path}.1`, "utf8");
    expect(tail).not.toContain("旧内容");
    expect(tail.endsWith("结尾\n")).toBe(true);
  });

  it("轮转旧中文日志时保留有效的 UTF-8 尾部", async () => {
    const path = await logPath();
    writeFileSync(path, "旧旧旧旧旧旧", "utf8");
    const fd = openLogFile(path, 8);
    closeSync(fd);
    expect(readFileSync(`${path}.1`, "utf8")).toBe("旧旧");
  });

  it("轮转后后台进程继承的文件句柄仍写入当前日志", async () => {
    const path = await logPath();
    writeFileSync(path, "old logs", "utf8");
    const inherited = openSync(path, "a");
    const child = spawn(process.execPath, ["-e", `
      process.send('ready');
      process.on('message', () => { process.stdout.write('raw'); process.stderr.write('!'); process.disconnect(); });
    `], { windowsHide: true, stdio: ["ignore", inherited, inherited, "ipc"] });
    try {
      await new Promise<void>((done, fail) => {
        child.once("message", () => done()); child.once("error", fail);
        child.once("close", () => fail(new Error("日志测试子进程提前退出")));
      });
      appendLog(path, "new", 8);
      child.send("write");
      await new Promise<void>((done, fail) => {
        child.once("error", fail);
        child.once("close", code => code === 0 ? done() : fail(new Error(`日志测试子进程退出码 ${code}`)));
      });
    } finally {
      if (child.exitCode === null) { child.kill(); await new Promise<void>(done => child.once("close", () => done())); }
      closeSync(inherited);
    }
    expect(readFileSync(path, "utf8")).toBe("newraw!");
    expect(readFileSync(`${path}.1`, "utf8")).toBe("old logs");
  });

  it("归档失败时保留当前日志内容", async () => {
    const path = await logPath();
    writeFileSync(path, "old logs", "utf8");
    mkdirSync(`${path}.2`);
    expect(() => appendLog(path, "new", 8)).toThrow();
    expect(readFileSync(path, "utf8")).toBe("old logs");
  });

  it("日志流写入失败不终止业务，路径恢复后继续记录", async () => {
    const path = await logPath();
    const parent = join(dirname(path), "blocked");
    writeFileSync(parent, "占用目录路径", "utf8");
    const warning = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stream = createLogStream(join(parent, "daemon.log"));
    stream.write("失败一\n", "utf8");
    stream.write("失败二\n", "utf8");
    expect(warning).toHaveBeenCalledTimes(1);
    unlinkSync(parent);
    stream.write("已恢复\n", "utf8");
    await new Promise<void>(done => stream.end(done));
    expect(readFileSync(join(parent, "daemon.log"), "utf8")).toBe("已恢复\n");
  });

  it("Host 的结构化日志使用受限日志流", async () => {
    const path = await logPath();
    const stream = createLogStream(path);
    const app = await buildApp({ dbPath: ":memory:", dataDir: join(dirname(path), "room"), backupDatabase: false,
      logger: { level: "warn", stream }, cloudflareManager: { status: async () => null, close: async () => {} } as never });
    try { app.log.warn("后台日志检查"); }
    finally { await app.close(); await new Promise<void>(done => stream.end(done)); }
    expect(JSON.parse(readFileSync(path, "utf8").trim()).msg).toBe("后台日志检查");
  });
});
