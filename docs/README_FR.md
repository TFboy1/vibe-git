# Vibe-Git

<p align="center"><a href="../README.md">简体中文</a> · <a href="README_EN.md">English</a> · <a href="README_JA.md">日本語</a> · <strong>Français</strong> · <a href="README_DE.md">Deutsch</a></p>

<p align="center"><strong>One repo. Many agents. One intent.</strong><br />Un protocole de collaboration traçable pour les équipes qui développent avec Codex.</p>

<p align="center"><code>CLI-first</code> · <code>Captain-hosted</code> · <code>Git + Codex</code> · <code>v0.20</code></p>

<p align="center"><a href="https://tfboy1.github.io/vibe-git/">Documentation</a> · <a href="#démarrage-rapide">Démarrage rapide</a> · <a href="../vibe-git/README.md">Manuel utilisateur</a> · <a href="../vibe-git/CHANGELOG.md">Journal des modifications</a> · <a href="https://github.com/TFboy1/vibe-git/issues">Issues</a></p>

---

## Git enregistre le code ; Vibe-Git enregistre les décisions de l’équipe

Plusieurs agents Codex peuvent produire du code correct tout en interprétant différemment une même exigence. Git conserve les branches, les commits et les diff ; il n’indique pas automatiquement quelle proposition a été validée, qui a tranché un conflit ni depuis quelle version le travail doit commencer.

Vibe-Git gère **proposition → alignement → tâche → revue des changements** au-dessus d’un espace de travail Git existant. Le capitaine héberge la salle de collaboration et les membres utilisent Codex et Git sur leurs propres machines.

## Démarrage rapide

Pré-requis : **Node.js 24+, Git et Codex CLI**. Installez d’abord le Skill, puis le CLI :

```powershell
npx skills add TFboy1/vibe-git-skill --skill vibe-git
npm install -g @vibe-git/vibe-git
vibe-git --help
```

Pour compiler le CLI depuis les sources :

```powershell
git clone --recurse-submodules https://github.com/TFboy1/vibe-git.git
cd vibe-git/vibe-git
npm ci
npm run build
npm link
```

Le capitaine démarre une salle dans son espace de travail Git :

```powershell
vibe-git host start
vibe-git open
```

Les membres rejoignent la salle depuis leur propre espace de travail et envoient une proposition Markdown UTF-8 :

```powershell
vibe-git connect "https://xxxx.trycloudflare.com/join/xxxxx"
vibe-git plan submit .\proposal.md
```

Consultez le [manuel utilisateur complet](../vibe-git/README.md). Les liens d’invitation contiennent une clé d’inscription et doivent rester réservés aux membres concernés.

## Workflow

| Étape | Action | Résultat conservé |
| --- | --- | --- |
| **PLAN** | `plan submit <file.md>` | Une proposition courante par membre et ses versions successives |
| **ALIGN** | `align start`, puis `tasks publish` | Ensemble figé, document aligné, choix de conflits et tâches |
| **BUILD** | `task pull`, `task start`, `task sync`, `task done` | Démarrage explicite, états Git/Codex et confirmation de fin |
| **CHANGE** | `pr submit`, puis `review apply` ou `review reject` | Modification d’exigence, preuve d’impact et décision d’application |

La publication des tâches ne démarre pas automatiquement tous les agents Codex. La fin de Codex ne marque pas non plus automatiquement une tâche comme terminée. `pr submit` crée une **modification interne des exigences Vibe-Git**, et non une Pull Request GitHub.

## Documentation et état actuel

- [Manuel utilisateur](../vibe-git/README.md)
- [Codex Skill](https://github.com/TFboy1/vibe-git-skill)
- [Journal des modifications](../vibe-git/CHANGELOG.md)
- [Issues](https://github.com/TFboy1/vibe-git/issues)

La version actuelle est **0.20**. L’adresse Cloudflare Quick Tunnel est temporaire ; les salles multi-appareils et un Host public nécessitent encore des tests d’intégration dans l’environnement cible.
