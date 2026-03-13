---
title: 'Duplicate # in pull-request widget with ascii icon family'
type: bugfix
authors:
  - mavam
  - claude
pr: 3
created: 2026-03-13T18:58:22.21386Z
---

The pull-request widget no longer shows a duplicate `#` when using the `ascii`
icon family. Previously the widget rendered `# #4` instead of `# 4` because the
ASCII icon already supplies `#` as its pull-request symbol and the number text
was also prefixed with `#`.
