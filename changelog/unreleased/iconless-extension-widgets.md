---
title: Iconless extension widgets
type: bugfix
authors:
  - aldoborrero
prs:
  - 6
created: 2026-05-19T15:55:38.624617Z
---

Extension widgets without an icon now render safely. Third-party widgets may omit the `icon` field or set it to `false` when they should appear without a leading icon.
