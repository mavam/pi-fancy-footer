---
title: Color overrides for styled footer widgets
type: bugfix
authors:
  - mavam
  - claude
created: 2026-03-02T21:45:48.037926Z
---

Widget configuration overrides for `iconColor` and `textColor` were not
propagated into styled widgets' render functions. This caused widgets like
`git-status` to ignore user-configured colors. The git status icon now also
uses semantic colors automatically—warning for behind, accent for ahead or
diverged—when the icon color is set to `text`.
