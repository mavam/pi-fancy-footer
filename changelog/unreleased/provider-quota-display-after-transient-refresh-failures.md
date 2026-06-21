---
title: Provider quota display after transient refresh failures
type: bugfix
authors:
  - mavam
  - codex
prs:
  - 13
created: 2026-06-21T10:57:57.100797Z
---

Provider quota widgets keep showing cached hourly and weekly limits when a transient refresh failure occurs, until the cached quota windows reset.

Previously, a short-lived provider error such as an HTTP 429 response could hide the provider status widget as soon as the normal cache window expired, even though the footer still had usable quota data from the last successful refresh.
