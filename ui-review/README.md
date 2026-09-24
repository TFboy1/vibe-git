# Agents 协作房间演示页

`agents-product-plan-mock.html` 是当前版本的单文件演示页，内嵌脚本、样式与品牌图片，可切换 Ivan、小芋头、汤神三个身份。页面复用正式前端，通过独立的演示数据层运行，不需要启动 Host 或登录 Codex。

## 打开页面

在仓库根目录执行：

```powershell
cd ui-review
py -m http.server 8765 --bind 127.0.0.1
```

浏览器打开 [协作房间](http://127.0.0.1:8765/agents-product-plan-mock.html)，或直接打开 [项目甘特](http://127.0.0.1:8765/agents-product-plan-mock.html?view=gantt)。使用 HTTP 地址；不要使用 `file://`。

没有 Python 时，可在 `ui-review` 目录使用：

```powershell
npx.cmd http-server . -p 8765 -a 127.0.0.1
```

## 重新生成

需要 Node.js 24 或更高版本。在仓库根目录执行：

```powershell
cd vibe-git
npm.cmd ci
npm.cmd run build -w @vibe-git/protocol
cd apps/web
..\..\node_modules\.bin\tsc.cmd -p tsconfig.review.json --noEmit
..\..\node_modules\.bin\vite.cmd build --config review.vite.config.ts
node ..\..\..\ui-review\build-agents-room.mjs
```

演示入口为 `vibe-git/apps/web/src/review-main.tsx`，数据与操作由 `reviewFixture.ts`、`reviewActions.ts` 提供。生成脚本把 `review-dist` 的资源内嵌到单文件 HTML；该中间目录不需要提交。更新后刷新 localhost 页面检查效果。
