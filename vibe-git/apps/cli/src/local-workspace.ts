import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  readJson,
  saveConfig,
  vibeHome,
  writeJson,
  type ClientConfig,
} from "./config.js";
import { gitExecutable } from "./git-command.js";

const exec = promisify(execFile);
const PACKAGE_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const DEFAULT_ROOT = resolve(homedir(), "Vibe-Git Projects");

export const projectsRoot = () => resolve(process.env.VIBE_GIT_PROJECTS_DIR?.trim() || DEFAULT_ROOT);
export const defaultProjectWorkspace = (name = "my-project") => resolve(projectsRoot(), name);

function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return !rel || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export function assertProjectWorkspacePath(path: string): string {
  if (!path.trim() || !isAbsolute(path)) throw new Error("请提供工作区的绝对路径");
  const target = resolve(path);
  const home = resolve(homedir());
  if (target === parse(target).root || inside(target, home)) throw new Error("请选择独立的项目目录，不能使用磁盘根目录或用户主目录");
  if (inside(PACKAGE_ROOT, target) || inside(target, PACKAGE_ROOT)) {
    throw new Error("Vibe-Git 安装目录及其父子目录不能作为项目工作区，请在其他位置新建项目目录");
  }
  return target;
}

async function canonicalTarget(path: string): Promise<string> {
  let existing = path;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) throw new Error(`找不到工作区的上级目录：${path}`);
    existing = parent;
  }
  const canonicalParent = await realpath(existing);
  return resolve(canonicalParent, relative(existing, path));
}

async function git(path: string, args: string[]) {
  const bin = gitExecutable();
  try {
    return (
      await exec(bin, ["-C", path, ...args], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 10000,
      })
    ).stdout.trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`无法启动 Git：${bin}。请安装 Git for Windows，或把 git.exe 的绝对路径设置为 GIT_BIN。`);
    }
    throw error;
  }
}

const projectMarkerPath = (path: string) => join(path, ".vibe-git", "project.json");

function projectName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80 || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error("项目名称应为 1–80 个字符，不能包含控制字符");
  }
  return trimmed;
}

async function readProjectName(path: string): Promise<string> {
  const marker = await readJson<{ name?: unknown }>(projectMarkerPath(path));
  if (typeof marker?.name === "string") {
    try { return projectName(marker.name); } catch { /* 无效旧数据回退到文件夹名称 */ }
  }
  return basename(path) || path;
}

/** 在独立项目目录初始化 Git。现有源码不会被自动暂存或提交。 */
export async function ensureGitWorkspace(path: string) {
  const target = assertProjectWorkspacePath(path);
  assertProjectWorkspacePath(await canonicalTarget(target));
  gitExecutable();
  let probe = target;
  while (!existsSync(probe)) probe = dirname(probe);
  const existingRoot = await git(probe, ["rev-parse", "--show-toplevel"]).catch(() => "");
  if (existingRoot && resolve(existingRoot) !== target) throw new Error(`所选目录位于现有 Git 仓库内：${existingRoot}。请选择该仓库根目录或在仓库外新建项目。`);
  if (!existsSync(target)) await mkdir(target, { recursive: true });
  if (!(await stat(target)).isDirectory()) throw new Error("所选路径不是目录");
  const ownGit = existsSync(join(target, ".git"));
  if (!ownGit) await git(target, ["init", "--initial-branch=main"]);
  const head = await git(target, ["rev-parse", "HEAD"]).catch(() => "");
  if (!head) {
    const staged = await git(target, ["diff", "--cached", "--name-only"]);
    if (staged) throw new Error("工作区已有暂存文件，请先自行完成首次提交，避免自动提交你的改动");
    await git(target, ["-c", "user.name=Vibe-Git", "-c", "user.email=vibe-git@local", "commit", "--allow-empty", "-m", "chore: initialize project workspace"]);
  }
  const exclude = await git(target, ["rev-parse", "--git-path", "info/exclude"]);
  const excludePath = isAbsolute(exclude) ? exclude : resolve(target, exclude);
  const exclusions = existsSync(excludePath) ? await readFile(excludePath, "utf8") : "";
  if (!exclusions.split(/\r?\n/).some((line) => line.trim() === ".vibe-git/")) {
    await mkdir(dirname(excludePath), { recursive: true });
    await writeFile(excludePath, `${exclusions}${exclusions && !exclusions.endsWith("\n") ? "\n" : ""}.vibe-git/\n`, "utf8");
  }
  const info = await inspectWorkspace(target);
  if (!info.valid) throw new Error(info.error ?? "Git 工作区初始化失败");
  return info;
}

export async function startupWorkspace(explicitPath?: string, rememberedPath?: string, defaultName = "my-project") {
  if (explicitPath) return ensureGitWorkspace(explicitPath);
  if (rememberedPath) {
    const remembered = await inspectWorkspace(rememberedPath);
    if (remembered.valid) return remembered;
  }
  const current = await inspectWorkspace(process.cwd());
  if (current.valid) return current;
  return ensureGitWorkspace(defaultProjectWorkspace(defaultName));
}

/** 只验证并绑定已存在的目录；这里不调用 Git，也不改动目录内容。 */
async function bindableDirectory(path: string): Promise<string> {
  const target = assertProjectWorkspacePath(path);
  const canonical = assertProjectWorkspacePath(await realpath(target).catch(() => target));
  if (!existsSync(canonical)) throw new Error(`目录不存在：${canonical}`);
  if (!(await stat(canonical)).isDirectory()) throw new Error("所选路径不是目录");
  return canonical;
}

export async function inspectWorkspace(path: string) {
  const absolute = await realpath(resolve(path)).catch(() => resolve(path));
  const name = await readProjectName(absolute);
  try { assertProjectWorkspacePath(absolute); }
  catch (error) {
    return { path: absolute, name, branch: "—", headSha: "", dirty: false, valid: false,
      error: error instanceof Error ? error.message : String(error) };
  }
  if (!existsSync(absolute)) {
    return {
      path: absolute,
      name,
      branch: "—",
      headSha: "",
      dirty: false,
      valid: false,
      error: `目录不存在：${absolute}`,
    };
  }

  const s = await stat(absolute);
  if (!s.isDirectory()) {
    return {
      path: absolute,
      name,
      branch: "—",
      headSha: "",
      dirty: false,
      valid: false,
      error: "所选路径不是有效目录",
    };
  }

  try { gitExecutable(); }
  catch (error) {
    return { path: absolute, name, branch: "—", headSha: "", dirty: false, valid: false,
      error: error instanceof Error ? error.message : String(error) };
  }

  const isWorkTree =
    (await git(absolute, ["rev-parse", "--is-inside-work-tree"]).catch(() => "")) === "true";

  if (!isWorkTree) {
    return {
      path: absolute,
      name,
      branch: "未初始化",
      headSha: "",
      dirty: false,
      valid: false,
      error: "当前目录未初始化 Git 仓库",
    };
  }

  const root = resolve((await git(absolute, ["rev-parse", "--show-toplevel"]).catch(() => absolute)) || absolute);
  if (root !== absolute) {
    return { path: absolute, name, branch: "—", headSha: "", dirty: false, valid: false,
      error: `所选目录属于 ${root}，请选择该 Git 仓库根目录` };
  }

  const headSha = await git(root, ["rev-parse", "HEAD"]).catch(() => "");
  const branch =
    (await git(root, ["branch", "--show-current"]).catch(() => "")) || (headSha ? "DETACHED" : "main");

  if (!headSha) {
    return {
      path: root,
      name,
      branch: branch || "main",
      headSha: "",
      dirty: false,
      valid: false,
      error: "Git 仓库尚未建立初始提交 (无 HEAD)",
    };
  }

  return {
    path: root,
    name,
    branch: branch || "main",
    headSha,
    dirty: !!(await git(root, ["status", "--porcelain"]).catch(() => "")),
    valid: true,
  };
}

export function workspaceController(
  config: ClientConfig,
  busy: () => string | null,
  onChanged: () => Promise<void>,
) {
  let switching = false;
  const historyPath = resolve(vibeHome(), "recent-workspaces.json");
  const visibleRecent = async () => {
    const entries = ((await readJson<Array<{ path: string; name: string }>>(historyPath)) ?? []).slice(0, 10);
    const checked = await Promise.all(entries.map(async (entry) => {
      if (typeof entry?.path !== "string" || typeof entry?.name !== "string") return null;
      try { await bindableDirectory(entry.path); return entry; }
      catch { return null; }
    }));
    return checked.filter((entry): entry is { path: string; name: string } => entry !== null);
  };

  return {
    isSwitching: () => switching,

    async get() {
      const recent = await visibleRecent();

      const current = await inspectWorkspace(config.workspace);
      const remembered = recent.find((item) => item.path === current.path);

      return {
        ...current,
        name: remembered?.name ?? current.name,
        selected: current.valid || !!remembered,
        recent,
        suggestedPath: defaultProjectWorkspace(),
        runningTask: busy(),
      };
    },

    async select(path: string, options: { name?: string; initialize?: boolean } = {}) {
      if (switching) throw new Error("工作区正在切换");
      if (busy()) throw new Error(`任务正在执行：${busy()}`);
      const requestedName = options.name === undefined ? undefined : projectName(options.name);
      switching = true;
      try {
        const initialized = options.initialize === true;
        const checked = initialized ? await ensureGitWorkspace(path) : null;
        const target = checked?.path ?? await bindableDirectory(path);
        if (busy()) throw new Error(`任务正在执行：${busy()}`);
        const previous = (await readJson<Array<{ path: string; name: string }>>(historyPath)) ?? [];
        const name = requestedName ?? previous.find((item) => item.path === target)?.name ?? await readProjectName(target);
        if (initialized) await writeJson(projectMarkerPath(target), { name });
        const next = checked
          ? { ...checked, name, selected: true }
          : { path: target, name, branch: "—", headSha: "", dirty: false, valid: false,
              error: "Git 尚未检查", selected: true };
        const prior = config.workspace;
        config.workspace = next.path;
        try {
          await saveConfig(config);
        } catch (e) {
          config.workspace = prior;
          throw e;
        }

        const recent = previous;
        await writeJson(
          historyPath,
          [
            { path: next.path, name: next.name },
            ...recent.filter((w) => w.path !== next.path),
          ].slice(0, 10),
        );

        if (initialized) await onChanged().catch(() => undefined);
        else setImmediate(() => void onChanged().catch(() => undefined));

        return {
          ...next,
          recent: await visibleRecent(),
          runningTask: busy(),
        };
      } finally {
        switching = false;
      }
    },

    async init(path?: string) {
      if (path && resolve(path) !== resolve(config.workspace)) throw new Error("工作区已变化，请重新选择项目后再初始化 Git");
      return this.select(config.workspace, { initialize: true });
    },
  };
}
