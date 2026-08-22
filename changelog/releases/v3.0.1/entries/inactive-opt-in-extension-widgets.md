---
title: Inactive opt-in extension widgets
type: bugfix
authors:
  - mavam
prs:
  - 35
created: 2026-08-22T09:19:24.903433Z
---

Opt-in extension widgets now stay out of the footer while their text is empty. This hides the `pi-agents` workflow and agent icons when no workflow is running, while default-enabled icon-only widgets such as pull request CI status remain visible.
