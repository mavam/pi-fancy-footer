Pull requests now stay visible in the footer through their whole lifecycle, from open to merged. All gauges also share one direction now: they fill up as a resource gets consumed.

## 🚀 Features

### Pull request lifecycle status

Pull requests now remain visible in the footer after merging. The PR icon uses the theme's accent color when auto-merge is enabled and a fixed GitHub purple after the pull request has merged, while other open pull requests keep their configured icon color. The merged purple is theme-independent, so set the widget's icon color to override it. The separate CI indicator continues to show workflow status, and a non-default PR icon color override still takes precedence.

*By @mavam and @codex in #21 and #23.*

## 🔧 Changes

### Fill all gauges from empty to full

All gauges now fill from the left with what a resource has already consumed. The provider quota gauges for the 5-hour and weekly windows previously counted down, showing the share still available, while the context bar counted up. They now match: a nearly full gauge means a nearly exhausted resource, colors run from healthy on the left to critical on the right, and the percentage next to each gauge is the used share. The compact `providerStatus.display: text` form changes accordingly, for example from `5h:95% 7d:97%` to `5h:5% 7d:3%`.

*By @mavam and @claude in #22.*
