import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { lstat, readlink } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { ImpactIndex, RepositoryContext } from "@vibe-git/protocol";

const SHA = /^[0-9a-f]{40}$/i;
const MAX_PATHS = 80;
const safePath = (path: string) => path.replace(/\\/g, "/").slice(0, 240);
const displayPath = (path: string) => path.length > 80 ? `${safePath(path).slice(0, 80)}…` : safePath(path);
const safeKey = (value: string) => value.replace(/[^A-Za-z0-9@/._-]/g, "").slice(0, 48);

function manifestOutline(path: string, content: string, complete: boolean): string {
  if (!complete) return "文件过大，仅记录存在；内容未上传";
  if (path.endsWith(".json")) {
    try {
      const data = JSON.parse(content) as Record<string, unknown>;
      const keys = (value: unknown) => value && typeof value === "object" && !Array.isArray(value)
        ? Object.keys(value).slice(0, 24).map(safeKey).filter(Boolean).join(", ") : "";
      return `顶层键：${keys(data)}；scripts：${keys(data.scripts)}；dependencies：${keys(data.dependencies)}；devDependencies：${keys(data.devDependencies)}`;
    } catch { return "配置无法安全解析；内容未上传"; }
  }
  if (path.endsWith(".toml")) {
    const sections = content.split(/\r?\n/).map((line) => /^\s*\[\[?([\w.-]+)\]\]?\s*$/.exec(line)?.[1]).filter((item): item is string => Boolean(item));
    return `章节：${sections.slice(0, 30).map(safeKey).join(", ")}${sections.length > 30 ? "；其余省略" : ""}`;
  }
  if (path.endsWith(".yaml")) {
    const keys = content.split(/\r?\n/).map((line) => /^([\w.-]+):/.exec(line)?.[1]).filter((item): item is string => Boolean(item));
    return `顶层键：${keys.slice(0, 20).map(safeKey).join(", ")}`;
  }
  return "已记录配置文件存在；内容未上传";
}

async function git(workspace: string, args: string[], outputLimit = 64_000): Promise<{ output: string; count: number; digest: string }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn("git", args, { cwd: workspace, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const hash = createHash("sha256");
    const chunks: Buffer[] = [];
    let retained = 0;
    let count = 0;
    let error = "";
    const timeout = setTimeout(() => child.kill(), 30_000);
    child.stdout.on("data", (chunk: Buffer) => {
      hash.update(chunk);
      count += chunk.length;
      if (retained < outputLimit) {
        const part = chunk.subarray(0, outputLimit - retained);
        chunks.push(part); retained += part.length;
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { error = (error + chunk).slice(-2_000); });
    child.once("error", (cause) => { clearTimeout(timeout); reject(cause); });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) { reject(new Error(error.trim() || `git ${args[0]} 失败`)); return; }
      resolveResult({ output: Buffer.concat(chunks).toString("utf8"), count, digest: hash.digest("hex") });
    });
  });
}

export async function worktreeFingerprint(workspace: string): Promise<{ headSha: string; fingerprint: string; dirty: boolean }> {
  const headSha = (await git(workspace, ["rev-parse", "HEAD"], 100)).output.trim().toLowerCase();
  if (!SHA.test(headSha)) throw new Error("工作区没有有效 Git HEAD");
  const status = await git(workspace, ["status", "--porcelain=v1", "--untracked-files=normal"], 4 * 1024 * 1024);
  if (status.count > 4 * 1024 * 1024) throw new Error("工作区状态过大，无法安全生成完整指纹");
  const diff = await git(workspace, ["diff", "--no-ext-diff", "--binary", "HEAD"], 0);
  const hash = createHash("sha256").update(headSha).update(status.digest).update(diff.digest);
  const untracked = await git(workspace, ["ls-files", "--others", "--exclude-standard", "-z"], 4 * 1024 * 1024);
  if (untracked.count > 4 * 1024 * 1024) throw new Error("未跟踪文件列表过大，无法安全生成完整指纹");
  for (const name of untracked.output.split("\0").filter(Boolean)) {
    const path = resolve(workspace, name);
    const rel = relative(workspace, path);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("未跟踪文件路径越出工作区");
    hash.update(name);
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink()) { hash.update(await readlink(path)); continue; }
      if (!info.isFile()) continue;
      for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
    } catch { hash.update("unreadable"); }
  }
  return { headSha, fingerprint: hash.digest("hex"), dirty: status.count > 0 };
}

export async function repositoryContext(workspace: string, focus = "", focusPaths: string[] = []): Promise<RepositoryContext> {
  const state = await worktreeFingerprint(workspace);
  const tree = await git(workspace, ["ls-tree", "-r", "--name-only", state.headSha], 4 * 1024 * 1024);
  const paths = tree.output.split(/\r?\n/).filter(Boolean);
  if (tree.count > 4 * 1024 * 1024) paths.pop(); // 最后一条可能被读取上限切断
  const groups = new Map<string, number>();
  for (const path of paths) {
    const group = path.split("/")[0] ?? path;
    groups.set(group, (groups.get(group) ?? 0) + 1);
  }
  const selected = paths.filter((path) => /(^|\/)(package\.json|pyproject\.toml|Cargo\.toml|go\.mod|pnpm-workspace\.yaml|tsconfig\.json)$/.test(path)).slice(0, 3);
  const manifests: string[] = [];
  for (const path of selected) {
    try {
      const content = await git(workspace, ["show", `${state.headSha}:${path}`], 16_000);
      manifests.push(`### ${displayPath(path)}\n${manifestOutline(path, content.output, content.count <= 16_000)}`);
    } catch { /* ignore missing files */ }
  }
  const sources = paths.filter(path => /\.(?:vue|[cm]?[jt]sx?|py)$/.test(path) && !/(^|\/)(?:test[s]?|__tests__|node_modules|dist|\.venv)(\/|\.)|(?:config|secret|credential|lock)/i.test(path));
  const terms = keywords(focus);
  const rank = (path: string) => focusPaths.some(p => path === p || path.startsWith(p.replace(/\/\*\*?$/, "") + "/")) || terms.some(term => path.toLowerCase().includes(term)) ? -1 :
    /(^|\/)(?:App\.vue|main\.[^/]+|index\.[^/]+)$/.test(path) ? 0 : /(?:model|schema|router|route|component|view)/i.test(path) ? 1 : 2;
  sources.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const outlines = await Promise.all(sources.slice(0, 16).map(async path => {
    try {
      const source = await git(workspace, ["show", `${state.headSha}:${path}`], 32_000);
      // Upload declarations and references, never executable bodies or assignment values.
      const lines = source.output.split(/\r?\n/).flatMap(line => {
        const imported = /^\s*(?:import\s+[^=;]+|from\s+[\w.]+\s+import\s+[^#]+|export\s+\{[^}]*\}\s+from\s+['"][^'"]+['"])/.exec(line)?.[0];
        const declaration = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:class|interface|type|function|def|const|let)\s+([\w$]+)/.exec(line);
        const field = /^\s+(\w+\??)\s*:\s*([\w.\[\]|<>?, :\-]+?)(?:\s*=|;|$)/.exec(line);
        const route = /^\s*@(\w+\.\w+)\(\s*['"]([^'"]+)['"]/.exec(line);
        const components = [...line.matchAll(/<([A-Z][\w]*)\b/g)].map(match => "组件引用 " + match[1]);
        return imported ? [imported.slice(0, 240)] : declaration ? ["声明 " + declaration[0].trim()] : route ? ["路由 " + route[1] + " " + route[2]] : field ? ["字段 " + field[1] + ": " + field[2]] : components;
      }).slice(0, 30).join("\n").slice(0, 1_200);
      return lines ? `### ${safePath(path)}\n${lines}` : "";
    } catch { return ""; }
  }));
  const pathIndex = [...paths].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).slice(0, 200).map(safePath).join("\n").slice(0, 12_000);
  const fullSummary = [
    `HEAD ${state.headSha} · dirty=${state.dirty}`,
    `跟踪文件目录（已读取 ${paths.length} 条${tree.count > 4 * 1024 * 1024 ? "，列表过大，以下为部分索引" : ""}）：`,
    [...groups].slice(0, 20).map(([path, count]) => `${displayPath(path)}: ${count}`).join("\n"),
    groups.size > 20 ? `[另有 ${groups.size - 20} 个顶层目录未展示]` : "",
    `路径索引（最多 200 条 / 12000 字符，可能截断）：\n${pathIndex}`,
    paths.length > 200 ? `[另有至少 ${paths.length - 200} 条路径未展示；未展示不代表不存在]` : "",
    `关键配置结构（冻结提交；最多 3 份；不上传配置值）：\n${manifests.join("\n")}`,
    `入口、模型和组件结构（冻结提交；最多 16 份，可能截断；仅声明及引用）：\n${outlines.filter(Boolean).join("\n\n")}`
  ].join("\n\n");
  const summary = Buffer.byteLength(fullSummary, "utf8") <= 39_000 ? fullSummary : Buffer.from(fullSummary, "utf8").subarray(0, 39_000).toString("utf8").replace(/\uFFFD$/, "") + "\n[仓库摘要已截断]";
  return { headSha: state.headSha, dirty: state.dirty, summary, sha256: createHash("sha256").update(summary).digest("hex"), createdAt: new Date().toISOString() };
}

function keywords(content: string): string[] {
  const values = content.match(/[A-Za-z_][A-Za-z0-9_-]{3,}|[\u3400-\u9fff]{2,8}/g) ?? [];
  return [...new Set(values.map((value) => value.toLowerCase()))].filter((value) => !/^(需求|功能|任务|应该|需要|修改|支持)$/.test(value)).slice(0, 8);
}

export async function impactIndex(workspace: string, baselineSha: string | null, taskIds: string[], changeBrief: string): Promise<ImpactIndex> {
  const state = await worktreeFingerprint(workspace);
  let changed: string[] = [];
  let diffSummary = "";
  let truncatedOutputs = 0;
  try {
    if (baselineSha && SHA.test(baselineSha)) {
      const base = await git(workspace, ["merge-base", baselineSha, state.headSha], 100);
      const sha = base.output.trim();
      const changedResult = await git(workspace, ["diff", "--name-only", sha, "HEAD"], 100_000);
      changed = changedResult.output.split(/\r?\n/).filter(Boolean);
      if (changedResult.count > 100_000) { changed.pop(); truncatedOutputs++; }
      const stats = await git(workspace, ["diff", "--stat", sha, "HEAD"], 4_000);
      diffSummary = stats.output + (stats.count > 4_000 ? "\n[diff 统计未完整展示]" : "");
    }
  } catch { diffSummary = "阶段基准提交在本机不可用，需深查"; }
  const statusResult = await git(workspace, ["status", "--porcelain=v1"], 100_000);
  const workingLines = statusResult.output.split(/\r?\n/).filter(Boolean);
  if (statusResult.count > 100_000) { workingLines.pop(); truncatedOutputs++; }
  const working = workingLines.map((line) => line.slice(3));
  changed = [...new Set([...changed, ...working])];
  const terms = keywords(changeBrief);
  let candidates: string[] = [];
  if (terms.length) {
    try {
      const match = await git(workspace, ["grep", "-l", "-i", ...terms.flatMap((term) => ["-e", term]), "--"], 100_000);
      candidates = match.output.split(/\r?\n/).filter(Boolean);
      if (match.count > 100_000) { candidates.pop(); truncatedOutputs++; }
    } catch { /* no match is inconclusive, not proof of no impact */ }
  }
  return {
    nodeId: "", headSha: state.headSha, fingerprint: state.fingerprint, taskIds,
    changedPaths: changed.slice(0, MAX_PATHS).map(safePath), candidatePaths: candidates.slice(0, MAX_PATHS).map(safePath),
    omittedPaths: Math.max(0, changed.length - MAX_PATHS) + Math.max(0, candidates.length - MAX_PATHS) + truncatedOutputs,
    diffSummary: diffSummary.slice(0, 4_000), createdAt: new Date().toISOString()
  };
}
