---
title: Clearer Nerd Font icon language
type: change
authors:
  - mavam
  - codex
created: 2026-04-28T10:02:32.766254Z
---

The built-in Nerd Font icon language is now more consistent across the footer.

| Widget                | Before | After |
| --------------------- | ------ | ----- |
| `model`               | `󰧑`    | `󰚩`   |
| `thinking`            | `󰭻`    | `󰧑`   |
| `git-status` diverged | ``    | ``   |
| `total-cost`          | `$`    | `󰇁`   |

The `model` widget now uses a robot symbol, while `thinking` uses a brain symbol instead of a comment bubble. This matches the emoji icon language and avoids using the brain metaphor for both concepts. The `total-cost` widget now uses a dedicated currency symbol. The Nerd Font git status symbols also use a vertical diverged marker, matching the direction of the ahead and behind markers. The README icon table now documents the actual Nerd Font symbols for all built-in widgets instead of leaving cells blank.
