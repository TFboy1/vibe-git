import { spawn, type ChildProcess } from "node:child_process";
import { probeCodex, readRateLimits } from "./codex.js";
import { codexInvocation } from "./codex-command.js";
import { defaultCodexHome } from "./config.js";
import type { RateLimitWindow } from "@vibe-git/protocol";
interface CodexState {
  status: "available" | "connecting" | "login_required" | "unavailable";
  reason?: string;
  verificationUrl?: string;
  userCode?: string;
  rateLimits: RateLimitWindow[];
}
export function codexController(changed: () => Promise<void>) {
  let child: ChildProcess | null = null;
  let state: CodexState = { status: "unavailable", rateLimits: [] };
  let checkedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const status = async () => {
    if (child || Date.now() - checkedAt < 30000) return state;
    checkedAt = Date.now();
    const probe = probeCodex();
    state = {
      status:
        probe.state === "available"
          ? "available"
          : probe.state === "unverified"
            ? "login_required"
            : "unavailable",
      rateLimits:
        probe.state === "available"
          ? await readRateLimits(defaultCodexHome()).catch(() => [])
          : [],
      ...(probe.state === "unsupported"
        ? { reason: "未找到可用的 Codex CLI，请检查本机安装。" }
        : {}),
    };
    return state;
  };
  return {
    status,
    connect() {
      if (child) return state;
      state = { status: "connecting", rateLimits: [] };
      const command = codexInvocation();
      const process = spawn(
        command.file,
        [...command.prefixArgs, "login", "--device-auth"],
        {
          windowsHide: true,
          env: { ...globalThis.process.env, CODEX_HOME: defaultCodexHome() },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child = process;
      let spawnFailed = false;
      let output = "";
      const parse = (chunk: Buffer) => {
        output = (output + chunk.toString("utf8"))
          .replace(/\u001b\[[0-9;]*m/g, "")
          .slice(-16000);
        const url = output.match(
          /https:\/\/auth\.openai\.com\/[a-zA-Z0-9_/?=&.-]+/,
        );
        const code = output.match(/\b[A-Z0-9]{4,6}-[A-Z0-9]{4,6}\b/);
        if (url) state.verificationUrl = url[0];
        if (code) state.userCode = code[0];
      };
      process.stdout?.on("data", parse);
      process.stderr?.on("data", parse);
      process.once("error", () => {
        spawnFailed = true;
        child = null;
        clearTimeout(timer);
        state = {
          status: "unavailable",
          reason: "无法启动 Codex CLI，请检查本机安装。",
          rateLimits: [],
        };
        checkedAt = Date.now();
      });
      process.once("close", (code) => {
        child = null;
        clearTimeout(timer);
        output = "";
        if (spawnFailed) return;
        checkedAt = 0;
        if (code === 0) {
          state = { status: "available", rateLimits: [] };
          void changed().catch(() => {});
        } else {
          state = {
            status: "login_required",
            reason: "设备授权未完成或已过期，请重新接入。",
            rateLimits: [],
          };
          checkedAt = Date.now();
        }
      });
      timer = setTimeout(
        () => {
          process.kill();
        },
        10 * 60 * 1000,
      );
      timer.unref();
      return state;
    },
    close() {
      child?.kill();
      clearTimeout(timer);
    },
  };
}
