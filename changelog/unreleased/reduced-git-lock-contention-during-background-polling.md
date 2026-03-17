---
title: Reduced Git lock contention during background polling
type: bugfix
authors:
  - mavam
  - codex
created: 2026-03-17T07:42:18.677732Z
---

Background Git polling now runs with `git --no-optional-locks`, which reduces how often the footer refresh loop creates `.git/index.lock` files. Rebases and other Git operations are now less likely to conflict when multiple pi agents are running in the same repository.
