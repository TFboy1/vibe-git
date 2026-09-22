import { access } from "node:fs/promises";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { CloudflareTunnelPhase, CloudflareTunnelStatus } from "@vibe-git/protocol";
import { CloudflaredInstaller } from "./installer.js";
import { startCloudflaredProcess } from "./process.js";

export interface CloudflareManager {
  status(): Promise<CloudflareTunnelStatus>;
  install(): Promise<CloudflareTunnelStatus>;
  start(): Promise<CloudflareTunnelStatus>;
  stop(): Promise<CloudflareTunnelStatus>;
  close(): Promise<void>;
}

export class CloudflareTunnelManager implements CloudflareManager {
  private readonly installer: CloudflaredInstaller;
  private phase: CloudflareTunnelPhase = "not_installed";
  private version: string | null = null;
  private url: string | null = null;
  private lastError: string | null = null;
  private updatedAt = new Date().toISOString();
  private readonly logs: string[] = [];
  private child: ChildProcessWithoutNullStreams | null = null;
  private operation: Promise<CloudflareTunnelStatus> | null = null;

  constructor(readonly binaryPath: string, readonly targetUrl = process.env.VIBE_GIT_TUNNEL_TARGET ?? `http://127.0.0.1:${process.env.PORT ?? "8787"}`) {
    this.installer = new CloudflaredInstaller(binaryPath);
  }

  async status(): Promise<CloudflareTunnelStatus> {
    if (!this.version) this.version = await this.installer.installedVersion();
    if (!this.child && this.phase !== "installing" && this.phase !== "starting" && this.phase !== "error") {
      this.phase = this.version ? "ready" : "not_installed";
    }
    return this.snapshot();
  }

  install(): Promise<CloudflareTunnelStatus> {
    if (this.operation) return this.operation;
    this.operation = this.performInstall().finally(() => { this.operation = null; });
    return this.operation;
  }

  start(): Promise<CloudflareTunnelStatus> {
    if (this.child && this.url) return Promise.resolve(this.snapshot());
    if (this.operation) return this.operation;
    this.operation = this.performStart().finally(() => { this.operation = null; });
    return this.operation;
  }

  async stop(): Promise<CloudflareTunnelStatus> {
    const child = this.child;
    if (!child) {
      this.phase = this.version ? "ready" : "not_installed";
      this.url = null;
      this.touch();
      return this.snapshot();
    }
    this.phase = "stopping";
    this.touch();
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5_000);
      child.once("exit", () => { clearTimeout(timeout); resolve(); });
      child.kill("SIGTERM");
    });
    if (this.child === child) this.child = null;
    this.url = null;
    this.phase = this.version ? "ready" : "not_installed";
    this.log("Quick Tunnel 已停止");
    return this.snapshot();
  }

  async close(): Promise<void> { await this.stop(); }

  private async performInstall(): Promise<CloudflareTunnelStatus> {
    if (this.child) throw new Error("请先停止正在运行的 Quick Tunnel");
    this.phase = "installing";
    this.lastError = null;
    this.touch();
    try {
      this.version = await this.installer.install((line) => this.log(line));
      this.phase = "ready";
      this.touch();
      return this.snapshot();
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  private async performStart(): Promise<CloudflareTunnelStatus> {
    this.version = this.version ?? await this.installer.installedVersion();
    if (!this.version) throw new Error("请先安装 cloudflared");
    await access(this.binaryPath);
    this.phase = "starting";
    this.lastError = null;
    this.url = null;
    this.touch();
    return new Promise<CloudflareTunnelStatus>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        const error = new Error("cloudflared 启动超时，未返回 Quick Tunnel URL");
        this.child?.kill("SIGTERM");
        this.fail(error);
        reject(error);
      }, 25_000);
      try {
        const child = startCloudflaredProcess(this.binaryPath, this.targetUrl, {
          onLine: (line) => this.log(line),
          onUrl: (url) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            this.url = url;
            this.phase = "running";
            this.touch();
            resolve(this.snapshot());
          },
          onError: (error) => {
            if (this.child === child) this.child = null;
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            this.fail(error);
            reject(error);
          },
          onExit: (code, signal) => {
            if (this.child === child) this.child = null;
            this.url = null;
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              const error = new Error(`cloudflared 启动失败：exit=${code ?? "null"}, signal=${signal ?? "none"}`);
              this.fail(error);
              reject(error);
            } else if (this.phase !== "stopping" && this.phase !== "error") {
              this.phase = this.version ? "ready" : "not_installed";
              this.log(`Quick Tunnel 已退出：exit=${code ?? "null"}`);
            }
          }
        });
        this.child = child;
      } catch (error) {
        settled = true;
        clearTimeout(timeout);
        this.fail(error);
        reject(error);
      }
    });
  }

  private log(line: string) {
    const safe = line.replace(/[\r\n]+/g, " ").slice(0, 800);
    this.logs.push(safe);
    if (this.logs.length > 40) this.logs.splice(0, this.logs.length - 40);
    this.touch();
  }

  private fail(error: unknown) {
    this.lastError = error instanceof Error ? error.message : String(error);
    this.phase = "error";
    this.log(this.lastError);
  }

  private touch() { this.updatedAt = new Date().toISOString(); }

  private snapshot(): CloudflareTunnelStatus {
    return {
      phase: this.phase,
      installed: Boolean(this.version),
      running: Boolean(this.child && this.url),
      version: this.version,
      url: this.url,
      logs: [...this.logs],
      lastError: this.lastError,
      updatedAt: this.updatedAt
    };
  }
}
