# 安装 Vibe-Git CLI

此仓库的 Git 根目录包含 `vibe-git/` 应用子目录。CLI、Host、网页都从该子目录构建。需要 Node.js 24+、Git，以及用于实际任务的 Codex CLI。首次 `host start` 还会尝试安装并启动 Cloudflare Quick Tunnel。

## 已有源码目录（PowerShell）

```powershell
Set-Location .\vibe-git  # 从已克隆仓库的 Git 根目录进入应用目录
node --version
npm.cmd --version
git --version
codex --version
npm.cmd ci
npm.cmd run build
npm.cmd link
vibe-git --help
```

执行安装步骤前确认 `package.json` 中的 `bin.vibe-git` 指向 `apps/cli/dist/index.js`。在其他 shell 中把 `npm.cmd` 换成 `npm`。

## 从 GitHub 获取（PowerShell）

```powershell
git clone https://github.com/TFboy1/vibe-git.git
Set-Location .\vibe-git\vibe-git
npm.cmd ci
npm.cmd run build
npm.cmd link
vibe-git --help
```

安装后在**自己的项目工作区**运行队长或成员命令。全局链接依赖这个源码目录；不要在使用期间移动或删除它。若不想建立全局链接，在任意工作区用 `node <应用目录的绝对路径>/apps/cli/dist/index.js <参数>` 调用，不能把相对路径误解为当前项目下的文件。

若 `vibe-git --help` 不可用，检查 `npm link` 是否成功、npm 全局 bin 是否在 PATH，再试绝对路径形式。不要用 `--version` 验证；当前 CLI 支持 `--help`，未实现 `--version`。

更新已安装源码时，先确认源码工作区没有需要保留的未提交修改，再按用户请求更新 Git 状态，重新执行 `npm.cmd ci`、`npm.cmd run build`、`npm.cmd link`。不要在更新 CLI 时随手停止已有 Host 或轮换邀请。
