---
title: Move pull request widgets to pi-pr
type: breaking
authors:
  - mavam
created: 2026-08-22T06:49:41.77398Z
---

The footer no longer talks to GitHub. Pull request number, unresolved review
threads, and CI status now come from
[pi-pr](https://github.com/mavam/pi-pr), which owns all GitHub polling and
publishes the widgets through the data-widget protocol. Data widgets can now
provide an HTTP or HTTPS link for their complete rendered content, so the moved
pull request widgets remain clickable.

To keep those widgets, install pi-pr:

```sh
pi install npm:pi-pr
```

Their configuration does not carry over. The built-in `pull-request`,
`pull-request-review-threads`, and `pull-request-ci-status` widgets are gone,
and pi-pr publishes `pi-pr.number`, `pi-pr.review-threads`, and `pi-pr.ci`
instead. Re-apply placement, visibility, and color overrides for the new IDs in
`/fancy-footer`. Overrides for the removed IDs are dropped from the config.

Two smaller changes come with the split: merged pull requests no longer use the
fixed GitHub purple, since extension widgets pick from the footer's standard
colors, and the `location` widget always shows the path instead of falling back
to the GitHub repository name.
