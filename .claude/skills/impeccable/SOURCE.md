# Where this folder came from

- Source: https://github.com/pbakaus/impeccable (Apache License 2.0 — see LICENSE and NOTICE.md here)
- Pinned commit: b49177d32788f2dc585c42831d845dacf1ebed2c (2026-11-18), skill version 4.10.0
- Copied byte for byte from `.claude/skills/impeccable/` of that commit: `SKILL.md` and every file under `reference/`.
- LICENSE and NOTICE.md are the repository's root files.

## Left out on purpose

The whole `scripts/` folder of the skill is NOT installed:

- `scripts/impeccable` and `scripts/impeccable.cmd` — launchers. On first run they download a compiled
  program from GitHub releases and save it in `~/.impeccable/` (network + a folder outside this project).
- `scripts/live-browser*.js`, `scripts/modern-screenshot.umd.js` — the "live" browser mode.
- `scripts/data/font-index.json`, `command-metadata.json`, `VERSION`, `engine-checksums.txt` — used only by that program.

Also not installed: the project hooks, the plugin, the five helper agents, the browser extension.

## What this means in use

Every `…/scripts/impeccable <verb>` line in the playbooks cannot run here. SKILL.md's own rule for that case
("Launcher unavailable") applies: read the project context directly and follow the playbook by hand.
The 62-rule automatic detector, `shot`, `live`, `pin` and the saved critique history are not available.
