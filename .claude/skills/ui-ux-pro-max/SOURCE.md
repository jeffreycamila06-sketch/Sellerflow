# Where this folder came from

- Source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill (MIT — see LICENSE here)
- Pinned commit: 6ec2bb58334ca3014573c4cbd4834ee3a40afd9d (2026-11-22), version 2.15.0
- Copied byte for byte from `.claude/skills/ui-ux-pro-max/` of that commit:
  `SKILL.md`, `references/*.md`, `data/*.csv`, `data/stacks/react.csv`, `data/stacks/html-tailwind.csv`,
  `scripts/core.py`, `scripts/design_system.py`, `scripts/reasoning_contract.py`, `scripts/search.py`.

## Left out on purpose

- `scripts/preview.py` (writes an HTML preview, by default into the system temp folder)
- `scripts/validate_data.py` and `scripts/tests/` (the maintainers' own checks)
- `data/*.json` (catalog records read only by validate_data.py) and the other 20 `data/stacks/*.csv`
- The six other skills of that repository (banner-design, brand, design, design-system, slides, ui-styling)

## How it may be run here

Read-only searches that print to the screen, with Python 3 and no extra packages:

    python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<words>" --domain <style|color|typography|ux|product|landing|motion>
    python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<words>" --design-system

Never with `--persist`, `--page`, `--tokens` + `--persist` or `--preview`: those write files
(`design-system/…` in the current folder; `--preview` no longer works at all because preview.py is left out).
