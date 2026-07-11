---
title: Keep cached quota windows on partial provider refresh
type: bugfix
authors:
  - edxeth
  - mavam
prs:
  - 15
created: 2026-07-11T06:08:58.927854Z
---

A provider usage refresh that returns only some quota windows no longer drops the still-valid cached ones. When Anthropic reports just the weekly window, the footer keeps showing the cached 5-hour window until it resets.
