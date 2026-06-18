The PR widgets now target GitHub Enterprise hosts consistently for pull request, review-thread, and CI lookups. This fixes Enterprise remotes that were recognized for display but queried through the wrong GitHub host.

## 🐞 Bug fixes

### GitHub Enterprise PR widget lookups

The PR widgets now work with GitHub Enterprise remotes whose hostnames use a GitHub-style domain, such as `github.example.com`.

Previously, these remotes could be recognized for display but follow-up PR, review-thread, and CI lookups did not consistently target the Enterprise host.

*By @theli-ua, @mavam, and @codex in #12.*
