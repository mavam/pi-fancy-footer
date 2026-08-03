Pull request status reporting now matches GitHub's current checks, so superseded workflow runs no longer leave the footer showing a false failure. Push-triggered and external CI checks continue to contribute to the displayed status.

## 🐞 Bug fixes

### Current pull request check status

The pull request CI widget now matches the checks that GitHub shows for the pull request. Superseded workflow runs no longer keep the icon red after GitHub replaces them with current checks, while push-triggered and external CI checks associated with the pull request still contribute to its status.

*By @mavam and @codex in #30.*
