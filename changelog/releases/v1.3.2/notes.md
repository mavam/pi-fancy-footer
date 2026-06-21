Provider quota widgets now keep showing valid cached hourly and weekly limits when a refresh fails. This prevents transient provider errors from blanking usable quota status in the footer before the cached windows reset.

## 🐞 Bug fixes

### Provider quota display after refresh failures

Provider quota widgets keep showing cached hourly and weekly limits when a refresh fails, until the cached quota windows reset.

A quota window is valid until its reset time, independent of why a refresh failed, so the footer now keeps displaying the last known windows that have not reset yet instead of hiding the widget as soon as the normal cache window expires. Previously, a provider error such as an HTTP 429 response could blank the widget even though the footer still had usable quota data from the last successful refresh.

*By @mavam and @codex in #13.*
