Background Git polling no longer creates `.git/index.lock` files, reducing conflicts when multiple pi agents run in the same repository.

## 🐛 Bug Fixes

### Reduced Git lock contention during background polling

Background Git polling now runs with `git --no-optional-locks`, which reduces how often the footer refresh loop creates `.git/index.lock` files. Rebases and other Git operations are now less likely to conflict when multiple pi agents are running in the same repository.

_By @mavam and @codex._
