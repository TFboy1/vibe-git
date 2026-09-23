import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, resolve } from "node:path";
import { realpath, stat } from "node:fs/promises";
import {
  readJson,
  saveConfig,
  vibeHome,
  writeJson,
  type ClientConfig,
} from "./config.js";
const exec = promisify(execFile);
async function git(path: string, args: string[]) {
  return (
    await exec("git", ["-C", path, ...args], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 8000,
    })
  ).stdout.trim();
}
export async function inspectWorkspace(path: string) {
  const absolute = await realpath(resolve(path));
  if (!(await stat(absolute)).isDirectory()) throw new Error("请选择目录");
  if ((await git(absolute, ["rev-parse", "--is-inside-work-tree"])) !== "true")
    throw new Error("所选目录不是 Git 工作区");
  const root = await git(absolute, ["rev-parse", "--show-toplevel"]);
  const headSha = await git(root, ["rev-parse", "HEAD"]).catch(() => "");
  return {
    path: root,
    name: basename(root),
    branch: (await git(root, ["branch", "--show-current"])) || "DETACHED",
    headSha,
    dirty: !!(await git(root, ["status", "--porcelain"])),
  };
}
export function workspaceController(
  config: ClientConfig,
  busy: () => string | null,
  onChanged: () => Promise<void>,
) {
  let switching = false;
  const historyPath = resolve(vibeHome(), "recent-workspaces.json");
  return {
    isSwitching: () => switching,
    async get() {
      const current = await inspectWorkspace(config.workspace);
      const recent = (
        (await readJson<Array<{ path: string; name: string }>>(historyPath)) ??
        []
      ).slice(0, 10);
      return { ...current, recent, runningTask: busy() };
    },
    async select(path: string) {
      if (switching) throw new Error("工作区正在切换");
      if (busy()) throw new Error(`任务正在执行：${busy()}`);
      switching = true;
      try {
        const next = await inspectWorkspace(path);
        if (busy()) throw new Error(`任务正在执行：${busy()}`);
        const prior = config.workspace;
        config.workspace = next.path;
        try {
          await saveConfig(config);
        } catch (e) {
          config.workspace = prior;
          throw e;
        }
        const recent =
          (await readJson<Array<{ path: string; name: string }>>(
            historyPath,
          )) ?? [];
        await writeJson(
          historyPath,
          [
            { path: next.path, name: next.name },
            ...recent.filter((w) => w.path !== next.path),
          ].slice(0, 10),
        );
        await onChanged();
        return {
          ...next,
          recent:
            (await readJson<Array<{ path: string; name: string }>>(
              historyPath,
            )) ?? [],
          runningTask: busy(),
        };
      } finally {
        switching = false;
      }
    },
    async pick() {
      if (process.platform !== "win32")
        throw new Error("当前系统请通过本机 CLI 连接所需工作区");
      const script =
        "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; Add-Type -AssemblyName System.Windows.Forms; $picker = New-Object System.Windows.Forms.FolderBrowserDialog; $picker.Description = '选择 Git 工作区'; if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($picker.SelectedPath) }";
      const result = await exec(
        "powershell.exe",
        [
          "-NoProfile",
          "-STA",
          "-EncodedCommand",
          Buffer.from(script, "utf16le").toString("base64"),
        ],
        { encoding: "utf8", windowsHide: true, timeout: 120000 },
      );
      return { path: result.stdout.trim() || null };
    },
  };
}
