import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const RELEASE_API = "https://api.github.com/repos/cloudflare/cloudflared/releases/latest";
const ASSET_NAME = "cloudflared-windows-amd64.exe";

export class CloudflaredInstaller {
  constructor(readonly binaryPath: string) {}

  async installedVersion(): Promise<string | null> {
    try {
      const { stdout, stderr } = await execFileAsync(this.binaryPath, ["--version"], {
        windowsHide: true,
        timeout: 10_000
      });
      const output = `${stdout}\n${stderr}`.trim();
      return /cloudflared version\s+[^\s]+/i.exec(output)?.[0] ?? null;
    } catch {
      return null;
    }
  }

  async install(onLog: (line: string) => void): Promise<string> {
    if (process.platform !== "win32") throw new Error("当前一键安装仅支持 Windows 主机");
    const existing = await this.installedVersion();
    if (existing) return existing;

    await mkdir(dirname(this.binaryPath), { recursive: true });
    const temporaryPath = `${this.binaryPath}.download`;
    await rm(temporaryPath, { force: true });
    onLog("正在从 Cloudflare 官方 GitHub Release 下载 cloudflared…");

    try {
      const releaseResponse = await fetch(RELEASE_API, {
        headers: { accept: "application/vnd.github+json", "user-agent": "vibe-git/0.20" },
        signal: AbortSignal.timeout(30_000)
      });
      if (!releaseResponse.ok) throw new Error(`Cloudflare Release 元数据获取失败：HTTP ${releaseResponse.status}`);
      const release = await releaseResponse.json() as { tag_name?: string; assets?: Array<{ name?: string; browser_download_url?: string; digest?: string | null; size?: number }> };
      const asset = release.assets?.find((item) => item.name === ASSET_NAME);
      const expectedDigest = asset?.digest?.match(/^sha256:([0-9a-f]{64})$/i)?.[1]?.toLowerCase();
      if (!asset?.browser_download_url || !expectedDigest) throw new Error("Cloudflare 官方 Release 未提供可验证的 Windows amd64 资产摘要");
      onLog(`正在下载 Cloudflare ${release.tag_name ?? "latest"} 官方资产…`);
      const response = await fetch(asset.browser_download_url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`Cloudflare 下载失败：HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength < 1_000_000 || (asset.size && bytes.byteLength !== asset.size) || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
        throw new Error("下载内容不是有效的 Windows cloudflared 可执行文件");
      }
      const actualDigest = createHash("sha256").update(bytes).digest("hex");
      if (actualDigest !== expectedDigest) throw new Error("cloudflared SHA-256 与 Cloudflare 官方 Release 摘要不一致");
      await writeFile(temporaryPath, bytes, { flag: "wx" });
      onLog(`下载完成：${Math.round(bytes.byteLength / 1024 / 1024)} MB，SHA-256 验证通过`);
      const version = await this.verifyVersion(temporaryPath);
      await rm(this.binaryPath, { force: true });
      await rename(temporaryPath, this.binaryPath);
      onLog(`cloudflared 已安装：${version}`);
      return version;
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  private async verifyVersion(path: string): Promise<string> {
    const header = await readFile(path, { encoding: null, flag: "r" });
    if (header[0] !== 0x4d || header[1] !== 0x5a) throw new Error("cloudflared PE 文件头验证失败");
    const { stdout, stderr } = await execFileAsync(path, ["--version"], { windowsHide: true, timeout: 15_000 });
    const output = `${stdout}\n${stderr}`.trim();
    const version = /cloudflared version\s+[^\s]+/i.exec(output)?.[0];
    if (!version) throw new Error("cloudflared 版本验证失败");
    return version;
  }
}
