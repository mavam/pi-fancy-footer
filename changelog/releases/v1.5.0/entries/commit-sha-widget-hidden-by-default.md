---
title: Commit SHA widget hidden by default
type: change
authors:
  - mavam
  - codex
prs:
  - 19
created: 2026-07-15T20:55:38.449772Z
---

The commit SHA widget now starts hidden, keeping the default footer focused on branch and pull request context.

Enable it from `/fancy-footer` or in `~/.pi/agent/fancy-footer.json`:

```json
{
  "widgets": {
    "commit": {
      "enabled": true
    }
  }
}
```
