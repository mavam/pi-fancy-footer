---
title: Cache statistics widgets
type: feature
authors:
  - mavam
  - claude
created: 2026-07-11T09:54:23.908831Z
---

Three new built-in widgets surface pi's prompt-cache stats in the fancy footer: cache-read and cache-write show cumulative cache tokens for the session in compact form (e.g. 246k), and cache-hit-rate shows the latest turn's cache hit rate. They sit on the right of the top row before context-capacity and total-cost, keeping the cost rightmost, and hide when the session has no cache activity or the terminal is narrower than 60 columns.
