import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const QUICK_TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

export interface TunnelProcessCallbacks {
  onLine: (line: string) => void;
  onUrl: (url: string) => void;
  onError: (error: Error) => void;
  onExit: (code: number | null, signal: NodeJS.Signals | null) => void;
}

export function startCloudflaredProcess(binaryPath: string, targetUrl: string, callbacks: TunnelProcessCallbacks): ChildProcessWithoutNullStreams {
  const child = spawn(binaryPath, ["tunnel", "--url", targetUrl, "--no-autoupdate"], {
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"]
  });
  const consume = (chunk: Buffer) => {
    for (const raw of chunk.toString("utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      callbacks.onLine(line);
      const url = line.match(QUICK_TUNNEL_URL)?.[0];
      if (url) callbacks.onUrl(url);
    }
  };
  child.stdout.on("data", consume);
  child.stderr.on("data", consume);
  child.once("error", callbacks.onError);
  child.once("exit", callbacks.onExit);
  return child;
}
