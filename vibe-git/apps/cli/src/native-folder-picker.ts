import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { createRequire } from "node:module";

const WORKER = createRequire(import.meta.url).resolve("@deepseek-ai/dsh-host-directory-picker-native/worker");
const START_TIMEOUT_MS = 12_000;
const PICK_TIMEOUT_MS = 10 * 60_000;

function isDirectory(path: string): boolean {
  try { return statSync(path).isDirectory(); }
  catch { return false; }
}

type PickerMessage =
  | { kind: "showing"; threadId: number }
  | { kind: "done"; path: string | null }
  | { kind: "error"; message: string };

/** 使用 DSH 的 Win32 IFileOpenDialog 子进程；目录选择本身不执行 Git 操作。 */
export function pickWindowsFolder(signal?: AbortSignal): Promise<string | null> {
  if (process.platform !== "win32") return Promise.reject(new Error("系统文件夹选择窗口目前仅支持 Windows"));
  if (signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER], {
      env: { ...process.env, DSH_DIALOG_TITLE: "选择项目工作区" },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      windowsHide: true,
    });
    let settled = false;
    const settle = (result: { path: string | null } | { error: Error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(startTimer);
      clearTimeout(pickTimer);
      signal?.removeEventListener("abort", onAbort);
      child.unref();
      if ("error" in result) reject(result.error);
      else resolve(result.path);
    };
    const onAbort = () => {
      child.kill();
      settle({ path: null });
    };
    const startTimer = setTimeout(() => {
      child.kill();
      settle({ error: new Error("Windows 文件夹窗口启动超时。请重新打开 Vibe-Git 后重试。") });
    }, START_TIMEOUT_MS);
    const pickTimer = setTimeout(() => {
      child.kill();
      settle({ error: new Error("文件夹选择等待超时，请重试。") });
    }, PICK_TIMEOUT_MS);
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("message", (raw: unknown) => {
      if (!raw || typeof raw !== "object" || !("kind" in raw)) return;
      const message = raw as PickerMessage;
      if (message.kind === "showing") {
        clearTimeout(startTimer);
        return;
      }
      if (message.kind === "error") {
        settle({ error: new Error(`Windows 文件夹窗口打开失败：${message.message}`) });
        return;
      }
      if (message.kind === "done") {
        if (message.path === null) settle({ path: null });
        else if (typeof message.path === "string" && isDirectory(message.path)) settle({ path: message.path });
        else settle({ error: new Error("选择的文件夹已不存在，请重新选择。") });
      }
    });
    child.on("error", (error) => settle({ error: new Error(`无法启动 Windows 文件夹窗口：${error.message}`) }));
    child.on("exit", () => settle({ error: new Error("Windows 文件夹窗口在返回结果前退出，请重试。") }));
    if (signal?.aborted) onAbort();
  });
}
