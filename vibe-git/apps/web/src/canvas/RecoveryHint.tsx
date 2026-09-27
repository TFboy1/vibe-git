export function RecoveryHint({ error }: { error: string }) {
  const steps = /Codex|算力|app.server|登录/i.test(error)
    ? ["确认本机已安装 Codex 并完成登录。", "在自己的 Git 工作区运行 vibe-git open。", "回到页面重新连接或重试操作。"]
    : /Tunnel|Cloudflare|fetch|网络|连接|重连/i.test(error)
      ? ["队长检查 Host 与 Cloudflare Tunnel 是否运行。", "成员在本机重新运行 vibe-git open，并确认可访问邀请地址。", "连接恢复后刷新房间状态。"]
      : /契约|接口|revision|版本|冲突/i.test(error)
        ? ["刷新房间，查看任务与契约的最新版本。", "参与双方重新确认同一契约哈希。", "队长发布新契约后，再重试开工或应用。"]
        : /离线|节点|队友|成员/i.test(error)
          ? ["请相关成员在自己的电脑运行 vibe-git open。", "等待状态变为在线，再重新取证或对齐。"]
          : ["刷新当前对象，确认状态与版本。", "按最新内容重试；仍失败时查看房间活动记录。"];
  return <div className="recovery-hint" role="alert"><strong>操作暂时无法完成</strong><p>原因：{error}</p><ol>{steps.map(step => <li key={step}>{step}</li>)}</ol></div>;
}
