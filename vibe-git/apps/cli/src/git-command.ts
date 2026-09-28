import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

function githubDesktopGit(localAppData: string | undefined): string | null {
  if (!localAppData) return null;
  const directory = join(localAppData, "GitHubDesktop");
  try {
    const candidates = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("app-"))
      .map((entry) => join(directory, entry.name, "resources", "app", "git", "cmd", "git.exe"))
      .filter(existsSync)
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    return candidates[0] ?? null;
  } catch {
    return null;
  }
}

export function gitExecutable(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.GIT_BIN?.trim();
  if (configured) {
    if (existsSync(configured)) return resolve(configured);
    throw new Error(`GIT_BIN 指向的 Git 不存在：${configured}。请改为 git.exe 的绝对路径。`);
  }

  if (process.platform !== "win32") return "git";

  const pathEntries = [env.Path, env.PATH].filter(Boolean).join(delimiter)
    .split(delimiter)
    .map((entry) => entry.replace(/^"|"$/g, ""))
    .filter(Boolean);

  for (const directory of pathEntries) {
    const candidate = join(directory, "git.exe");
    if (existsSync(candidate)) return candidate;
  }

  const githubGit = githubDesktopGit(env.LOCALAPPDATA);
  if (githubGit) return githubGit;

  const programFiles = env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const localAppData = env.LOCALAPPDATA || "";

  const standardPaths = [
    join(programFiles, "Git", "cmd", "git.exe"),
    join(programFiles, "Git", "bin", "git.exe"),
    join(programFilesX86, "Git", "cmd", "git.exe"),
    join(localAppData, "Programs", "Git", "cmd", "git.exe"),
  ];

  const profiles = [
    env.USERPROFILE,
    env.HOME,
    env.CODEX_HOME ? dirname(env.CODEX_HOME) : undefined,
    env.VIBE_GIT_HOME ? dirname(env.VIBE_GIT_HOME) : undefined,
    homedir(),
  ].filter((value): value is string => Boolean(value));
  for (const profile of profiles) {
    standardPaths.push(join(profile, ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "native", "git", "cmd", "git.exe"));
  }

  for (const p of standardPaths) {
    if (existsSync(p)) return p;
  }

  throw new Error("未找到 Git。请安装 Git for Windows 并重新打开 Vibe-Git，或把 git.exe 的绝对路径设置为 GIT_BIN。已创建的项目文件不会丢失。");
}

export function ghExecutable(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.GH_BIN?.trim();
  if (configured && existsSync(configured)) return resolve(configured);

  const pathEntries = (env.Path ?? env.PATH ?? "")
    .split(delimiter)
    .map((entry) => entry.replace(/^"|"$/g, ""))
    .filter(Boolean);

  for (const directory of pathEntries) {
    const candidate = join(directory, process.platform === "win32" ? "gh.exe" : "gh");
    if (existsSync(candidate)) return candidate;
  }

  if (process.platform === "win32") {
    const programFiles = env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const localAppData = env.LOCALAPPDATA || "";

    const standardPaths = [
      join(programFiles, "GitHub CLI", "gh.exe"),
      join(programFilesX86, "GitHub CLI", "gh.exe"),
      join(localAppData, "Programs", "GitHub CLI", "bin", "gh.exe"),
      join(localAppData, "GitHub CLI", "bin", "gh.exe"),
    ];

    for (const p of standardPaths) {
      if (existsSync(p)) return p;
    }
  }

  return null;
}
