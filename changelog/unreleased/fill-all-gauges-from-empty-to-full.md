---
title: Fill all gauges from empty to full
type: change
authors:
  - mavam
created: 2026-07-26T20:13:33.867573Z
---

All gauges now fill from the left with what a resource has already consumed.
The provider quota gauges for the 5-hour and weekly windows previously counted
down, showing the share still available, while the context bar counted up. They
now match: a nearly full gauge means a nearly exhausted resource, colors run
from healthy on the left to critical on the right, and the percentage next to
each gauge is the used share. The compact `providerStatus.display: text` form
changes accordingly, for example from `5h:95% 7d:97%` to `5h:5% 7d:3%`.
