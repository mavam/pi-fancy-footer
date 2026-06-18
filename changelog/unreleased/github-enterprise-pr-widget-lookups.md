---
title: GitHub Enterprise PR widget lookups
type: bugfix
authors:
  - theli-ua
  - mavam
  - codex
prs:
  - 12
created: 2026-06-18T08:35:51.515844Z
---

The PR widgets now work with GitHub Enterprise remotes whose hostnames use a GitHub-style domain, such as `github.example.com`.

Previously, these remotes could be recognized for display but follow-up PR, review-thread, and CI lookups did not consistently target the Enterprise host.
