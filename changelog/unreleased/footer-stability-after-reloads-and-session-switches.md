---
title: Footer stability after reloads and session switches
type: bugfix
authors:
  - mavam
  - codex
created: 2026-04-23T11:48:08.193579Z
---

The fancy footer no longer crashes pi after `/reload` or other session replacement flows.

Previously, the footer could keep rendering against stale extension state and terminate the session with a stale-instance error. After this fix, reloads and session switches keep the footer active without requiring configuration changes.
