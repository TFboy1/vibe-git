import { execFileSync } from "node:child_process";
import type { CapabilityState, ExecutionTransport } from "@vibe-git/protocol";

export interface CodexProbe {
  state: CapabilityState;
  detail: string;
  version: string | null;
  transports: { appServer: CapabilityState; cli: CapabilityState; preferred: ExecutionTransport };
}

export function probeCodex(executable = process.env.CODEX_BIN?.trim() || "codex", preferred = (process.env.CODEX_TRANSPORT?.trim() || "auto") as ExecutionTransport): CodexProbe {
  try {
    const version = execFileSync(executable, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
    let authenticated = false;
    try {
      execFileSync(executable, ["login", "status"], { encoding: "utf8", windowsHide: true, timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] });
      authenticated = true;
    } catch { /* installed but not authenticated */ }
    let appServer: CapabilityState = "unsupported";
    try {
      execFileSync(executable, ["app-server", "--help"], { encoding: "utf8", windowsHide: true, timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] });
      appServer = authenticated ? "available" : "unverified";
    } catch { /* CLI can still execute */ }
    const cli: CapabilityState = authenticated ? "available" : "unverified";
    const validPreferred: ExecutionTransport = ["auto", "app-server", "cli"].includes(preferred) ? preferred : "auto";
    return {
      state: authenticated ? "available" : "unverified",
      version: version || "Codex CLI",
      detail: authenticated
        ? `${version || "Codex CLI"} 已登录；App Server ${appServer === "available" ? "可用" : "不可用"}，CLI 可用`
        : `${version || "Codex CLI"} 已安装，但登录状态未验证`,
      transports: { appServer, cli, preferred: validPreferred }
    };
  } catch {
    return {
      state: "unsupported", version: null, detail: "未发现可调用的 Codex",
      transports: { appServer: "unsupported", cli: "unsupported", preferred: "auto" }
    };
  }
}
