# Vibe-Git

<p align="center"><a href="../README.md">简体中文</a> · <a href="README_EN.md">English</a> · <a href="README_JA.md">日本語</a> · <a href="README_FR.md">Français</a> · <strong>Deutsch</strong></p>

<p align="center"><strong>One repo. Many agents. One intent.</strong><br />Ein nachvollziehbares Kollaborationsprotokoll für Teams, die mit Codex entwickeln.</p>

<p align="center"><code>CLI-first</code> · <code>Captain-hosted</code> · <code>Git + Codex</code> · <code>v0.20</code></p>

<p align="center"><a href="https://tfboy1.github.io/vibe-git/">Dokumentation</a> · <a href="#schnellstart">Schnellstart</a> · <a href="../vibe-git/README.md">Benutzerhandbuch</a> · <a href="../vibe-git/CHANGELOG.md">Änderungsprotokoll</a> · <a href="https://github.com/TFboy1/vibe-git/issues">Issues</a></p>

---

## Git zeichnet Code auf; Vibe-Git zeichnet Teamentscheidungen auf

Mehrere Codex-Agenten können korrekten Code schreiben und dennoch dieselbe Anforderung unterschiedlich umsetzen. Git speichert Branches, Commits und Diffs; es zeigt nicht automatisch, welcher Vorschlag bestätigt wurde, wer einen Konflikt entschieden hat oder mit welcher Version die Arbeit beginnen soll.

Vibe-Git verwaltet **Vorschlag → Abstimmung → Aufgabe → Änderungsprüfung** auf einem bestehenden Git-Arbeitsbereich. Der Captain hostet den Kollaborationsraum, während die Mitglieder Codex und Git auf ihren eigenen Rechnern verwenden.

## Schnellstart

Benötigt werden **Node.js 24+, Git und Codex CLI**. Zuerst das Skill, danach die CLI installieren:

```powershell
npx skills add TFboy1/vibe-git-skill --skill vibe-git
npm install -g @vibe-git/vibe-git
vibe-git --help
```

Die CLI kann auch aus dem Quellcode gebaut werden:

```powershell
git clone --recurse-submodules https://github.com/TFboy1/vibe-git.git
cd vibe-git/vibe-git
npm ci
npm run build
npm link
```

Der Captain startet den Raum im eigenen Git-Arbeitsbereich:

```powershell
vibe-git host start
vibe-git open
```

Mitglieder treten aus ihren eigenen Arbeitsbereichen bei und senden einen UTF-8-Markdown-Vorschlag:

```powershell
vibe-git connect "https://xxxx.trycloudflare.com/join/xxxxx"
vibe-git plan submit .\proposal.md
```

Weitere Informationen enthält das [vollständige Benutzerhandbuch](../vibe-git/README.md). Beitrittslinks enthalten einen Registrierungsschlüssel und sollten nur an vorgesehene Mitglieder weitergegeben werden.

## Workflow

| Phase | Aktion | Ergebnis |
| --- | --- | --- |
| **PLAN** | `plan submit <file.md>` | Ein aktueller Vorschlag pro Mitglied und neue Versionen bei Änderungen |
| **ALIGN** | `align start`, danach `tasks publish` | Eingefrorene Vorschläge, abgestimmter Entwurf, Konfliktentscheidungen und Aufgaben |
| **BUILD** | `task pull`, `task start`, `task sync`, `task done` | Expliziter Start, Git/Codex-Status und Abschlussbestätigung |
| **CHANGE** | `pr submit`, danach `review apply` oder `review reject` | Anforderungsänderung, Auswirkungsnachweis und Anwendungsentscheidung |

Das Veröffentlichen von Aufgaben startet nicht automatisch alle Codex-Agenten. Das Ende von Codex markiert eine Aufgabe ebenfalls nicht automatisch als abgeschlossen. `pr submit` erstellt eine **interne Vibe-Git-Anforderungsänderung**, keinen GitHub Pull Request.

## Dokumentation und aktueller Stand

- [Benutzerhandbuch](../vibe-git/README.md)
- [Codex Skill](https://github.com/TFboy1/vibe-git-skill)
- [Änderungsprotokoll](../vibe-git/CHANGELOG.md)
- [Issues](https://github.com/TFboy1/vibe-git/issues)

Die aktuelle Version ist **0.20**. Die Adresse des Cloudflare Quick Tunnel ist temporär; echte geräteübergreifende Räume und ein öffentlicher Host benötigen noch Integrationstests in der Zielumgebung.
