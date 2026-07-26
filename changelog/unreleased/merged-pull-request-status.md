---
title: Pull request lifecycle status
type: feature
authors:
  - mavam
  - codex
prs:
  - 21
  - 23
created: 2026-07-26T06:36:55.055012Z
---

Pull requests now remain visible in the footer after merging. The PR icon uses the theme's accent color when auto-merge is enabled and a fixed GitHub purple after the pull request has merged, while other open pull requests keep their configured icon color. The merged purple is theme-independent, so set the widget's icon color to override it. The separate CI indicator continues to show workflow status, and a non-default PR icon color override still takes precedence.
