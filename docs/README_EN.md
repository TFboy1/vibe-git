# Vibe-Git

<p align="center"><a href="../README.md">简体中文</a> · <strong>English</strong> · <a href="README_JA.md">日本語</a> · <a href="README_FR.md">Français</a> · <a href="README_DE.md">Deutsch</a></p>

<p align="center"><strong>One repo. Many agents. One intent.</strong><br />A traceable collaboration protocol for teams developing with Codex.</p>

<p align="center"><code>CLI-first</code> · <code>Captain-hosted</code> · <code>Git + Codex</code> · <code>v0.20</code></p>

<p align="center"><a href="https://tfboy1.github.io/vibe-git/">Documentation</a> · <a href="#quick-start">Quick start</a> · <a href="../vibe-git/README.md">User manual</a> · <a href="../vibe-git/CHANGELOG.md">Changelog</a> · <a href="https://github.com/TFboy1/vibe-git/issues">Issues</a></p>

---

## Git records code; Vibe-Git records team decisions

Multiple Codex agents can write correct code while implementing different interpretations of the same requirement. Git preserves branches, commits, and diffs; it does not automatically tell the team which proposal was confirmed, who resolved a conflict, or which version work should start from.

Vibe-Git manages **proposal → alignment → task → change review** on top of an existing Git workspace. The captain hosts the collaboration room while members use Codex and Git on their own machines. Git still manages code, and team decisions gain explicit versions and states.

| What the team needs to know | Visible in Git | Added by Vibe-Git |
| --- | --- | --- |
| What to build | History of requirement files | Each member's proposal, frozen version, aligned draft, and unresolved questions |
| When to start | Branches and commits | Captain-published tasks and explicit member-side Codex start actions |
| Who is affected by a change | Code diff | Internal requirement changes, per-task impact evidence, and captain confirmation |
| When it is complete | Final commit | Synchronized Codex/Git state and owner completion confirmation |

## Quick start

Requires **Node.js 24+, Git, and Codex CLI**. Install the Skill first, then install the CLI:

```powershell
npx skills add TFboy1/vibe-git-skill --skill vibe-git
npm install -g @vibe-git/vibe-git
vibe-git --help
```

You can also build the CLI from source:

```powershell
git clone --recurse-submodules https://github.com/TFboy1/vibe-git.git
cd vibe-git/vibe-git
npm ci
npm run build
npm link
```

The captain enters their **own project Git workspace**, starts a room, and shares the join command:

```powershell
vibe-git host start
vibe-git open
```

Members enter **their own project Git workspaces**, run the join command, and submit a UTF-8 Markdown proposal:

```powershell
vibe-git connect "https://xxxx.trycloudflare.com/join/xxxxx"
vibe-git plan submit .\proposal.md
```

Before alignment and review, each node can run `vibe-git codex bind` to bind an independent Codex review pool. The captain then runs `vibe-git align start`. See the [full user manual](../vibe-git/README.md) for decisions, assignments, and publishing commands. Join links contain a registration key and should only be shared with intended members.

## Workflow

| Stage | Action | Result |
| --- | --- | --- |
| **PLAN** | Member runs `plan submit <file.md>` | One current proposal per member; updates create new versions |
| **ALIGN** | Captain runs `align start`, resolves decisions, then `tasks publish` | Frozen proposal set, aligned draft, conflict choices, and tasks |
| **BUILD** | Owner runs `task pull`, `task start`, `task sync`, and `task done` | Explicit start action, Git/Codex state, and completion confirmation |
| **CHANGE** | Member runs `pr submit`; captain runs `review apply` or `review reject` | Requirement change, impact evidence, and application decision |

Publishing tasks does not automatically start every Codex agent, and finishing Codex does not automatically mark a task complete. `pr submit` creates an **internal Vibe-Git requirement change**, not a GitHub Pull Request.

## Runtime model

```text
Captain computer: Git workspace + Codex + Vibe-Git CLI
                              │
                              └── Host + SQLite + web room
                                             ▲
                                 Cloudflare Quick Tunnel
                                             │
Member computers: each member's Git workspace + Codex + Vibe-Git CLI
```

Each member keeps their own Git workspace and normal Codex configuration. Credentials for the dedicated review pool stay on each node; the Host receives collaboration state and limited evidence, not members' everyday Codex credentials, full chat content, or tool logs.

## Documentation and current status

- [User manual](../vibe-git/README.md): complete CLI commands, captain/member workflows, and data boundaries.
- [Codex Skill](https://github.com/TFboy1/vibe-git-skill): install with `npx skills add TFboy1/vibe-git-skill --skill vibe-git`.
- [Changelog](../vibe-git/CHANGELOG.md): updates for 0.20.
- [Issues](https://github.com/TFboy1/vibe-git/issues): feedback and usage reports.

The current version is **0.20**. Cloudflare Quick Tunnel uses a temporary address; real cross-device rooms and a public Host still require integration testing in the target environment. The [AgentGit M0 handoff](../M0-HANDOFF.md) and [validation record](../M0-VALIDATION.md) are historical snapshots, not current installation steps.
