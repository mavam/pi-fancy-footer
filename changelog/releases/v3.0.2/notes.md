Provider quota gauges now show unknown usage instead of a misleading 0% when a response omits its percentage. Valid cached readings remain visible without carrying stale usage into a different reset period.

## 🐞 Bug fixes

### Stop showing 0% for unreported provider quota

Provider quota gauges no longer flash 0% before settling on the real number. When a provider named a quota window without reporting its percentage — an OpenAI response carrying a reset time but no usage, for instance — the footer filled in 0% and drew a full, empty-looking gauge until the next refresh happened to include the number. Unreported usage is now shown as unknown, and a cached percentage that still describes the current period is kept instead of being overwritten.

*By @mavam.*
