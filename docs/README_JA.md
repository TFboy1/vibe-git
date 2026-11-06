# Vibe-Git

<p align="center"><a href="../README.md">简体中文</a> · <a href="README_EN.md">English</a> · <strong>日本語</strong> · <a href="README_FR.md">Français</a> · <a href="README_DE.md">Deutsch</a></p>

<p align="center"><strong>One repo. Many agents. One intent.</strong><br />Codex を使うチームのための、追跡可能な共同開発プロトコル。</p>

<p align="center"><code>CLI-first</code> · <code>Captain-hosted</code> · <code>Git + Codex</code> · <code>v0.20</code></p>

<p align="center"><a href="https://tfboy1.github.io/vibe-git/">ドキュメント</a> · <a href="#クイックスタート">クイックスタート</a> · <a href="../vibe-git/README.md">ユーザーマニュアル</a> · <a href="../vibe-git/CHANGELOG.md">変更履歴</a> · <a href="https://github.com/TFboy1/vibe-git/issues">Issues</a></p>

---

## Git はコードを記録し、Vibe-Git はチームの決定を記録する

複数の Codex エージェントは正しいコードを書けても、同じ要件を異なる解釈で実装することがあります。Git はブランチ、コミット、diff を保存しますが、どの提案が確定したか、誰が衝突を裁定したか、どの版から作業を始めるかまでは自動的に示しません。

Vibe-Git は既存の Git ワークスペース上で **提案 → 調整 → タスク → 変更レビュー** を管理します。キャプテンが共同作業ルームをホストし、メンバーは自分のマシンで Codex と Git を使います。

## クイックスタート

必要なものは **Node.js 24 以上、Git、Codex CLI** です。

```powershell
npx skills add TFboy1/vibe-git-skill --skill vibe-git
npm install -g @vibe-git/vibe-git
vibe-git --help
```

ソースから CLI をビルドする場合：

```powershell
git clone --recurse-submodules https://github.com/TFboy1/vibe-git.git
cd vibe-git/vibe-git
npm ci
npm run build
npm link
```

キャプテンは自分のプロジェクト Git ワークスペースでルームを開始します。

```powershell
vibe-git host start
vibe-git open
```

メンバーは自分のワークスペースで参加し、UTF-8 の Markdown 提案を送信します。

```powershell
vibe-git connect "https://xxxx.trycloudflare.com/join/xxxxx"
vibe-git plan submit .\proposal.md
```

詳細は[ユーザーマニュアル](../vibe-git/README.md)を参照してください。参加リンクには登録キーが含まれるため、対象メンバーにのみ共有してください。

## ワークフロー

| 段階 | 操作 | 残る成果物 |
| --- | --- | --- |
| **PLAN** | `plan submit <file.md>` | 各メンバーの現在の提案と、その更新版 |
| **ALIGN** | `align start`、裁定後に `tasks publish` | 固定された提案、調整稿、衝突の選択、タスク |
| **BUILD** | `task pull`、`task start`、`task sync`、`task done` | 開始操作、Git/Codex 状態、完了確認 |
| **CHANGE** | `pr submit`、`review apply` または `review reject` | 要件変更、影響の証拠、適用判断 |

タスク公開はすべての Codex を自動起動せず、Codex の終了もタスクを自動完了にしません。`pr submit` は GitHub Pull Request ではなく、**Vibe-Git 内部の要件変更**を作成します。

## ドキュメントと現在の状態

- [ユーザーマニュアル](../vibe-git/README.md)
- [Codex Skill](https://github.com/TFboy1/vibe-git-skill)
- [変更履歴](../vibe-git/CHANGELOG.md)
- [Issues](https://github.com/TFboy1/vibe-git/issues)

現在のバージョンは **0.20** です。Cloudflare Quick Tunnel のアドレスは一時的なもので、実際の複数デバイス環境や公開 Host は対象環境での統合テストが必要です。
