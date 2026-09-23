import { existsSync, readdirSync, statSync } from "node:fs";
import { delimiter, dirname, extname, join, resolve } from "node:path";

export interface CodexInvocation {
  file: string;
  prefixArgs: string[];
}

function npmScript(directory: string): string | null {
  const candidate = join(directory, "node_modules", "@openai", "codex", "bin", "codex.js");
  return existsSync(candidate) ? candidate : null;
}

function desktopExecutable(localAppData: string | undefined): string | null {
  if (!localAppData) return null;
  const directory = join(localAppData, "OpenAI", "Codex", "bin");
  try {
    const candidates = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(directory, entry.name, "codex.exe"))
      .filter(existsSync)
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    return candidates[0] ?? null;
  } catch { return null; }
}

/** 只返回可直接执行的 exe / JS，避免 Windows 下通过 shell 运行不安全的 .cmd shim。 */
export function codexInvocation(env: NodeJS.ProcessEnv = process.env): CodexInvocation {
  const configured = env.CODEX_BIN?.trim();
  if (configured && configured !== "codex") {
    const extension = extname(configured).toLowerCase();
    if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
      if (!existsSync(configured)) throw new Error(`CODEX_BIN 指向的文件不存在：${configured}`);
      return { file: process.execPath, prefixArgs: [resolve(configured)] };
    }
    if (extension === ".cmd" || extension === ".bat" || extension === ".ps1") {
      const script = npmScript(dirname(resolve(configured)));
      if (script) return { file: process.execPath, prefixArgs: [script] };
      throw new Error("CODEX_BIN 请指向 codex.exe 或 codex.js，不能直接使用 Windows 命令脚本");
    }
    if (!existsSync(configured) && (configured.includes("/") || configured.includes("\\"))) throw new Error(`CODEX_BIN 指向的文件不存在：${configured}`);
    return { file: configured, prefixArgs: [] };
  }

  if (process.platform !== "win32") return { file: "codex", prefixArgs: [] };

  const pathEntries = (env.Path ?? env.PATH ?? "").split(delimiter).map((entry) => entry.replace(/^"|"$/g, "")).filter(Boolean);
  for (const directory of pathEntries) {
    const candidate = join(directory, "codex.exe");
    if (existsSync(candidate)) return { file: candidate, prefixArgs: [] };
  }

  const desktop = desktopExecutable(env.LOCALAPPDATA);
  if (desktop) return { file: desktop, prefixArgs: [] };

  for (const directory of [env.APPDATA ? join(env.APPDATA, "npm") : "", ...pathEntries]) {
    if (!directory) continue;
    const script = npmScript(directory);
    if (script) return { file: process.execPath, prefixArgs: [script] };
  }

  throw new Error("找不到可执行的 Codex CLI。请安装 Codex CLI，或将 CODEX_BIN 指向 codex.exe / codex.js 的绝对路径。");
}
