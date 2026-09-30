The footer now includes model usage from codemode and other tools, cache warming, compaction, and branch summaries in whole-session cost and cache totals. Statistics refresh as messages finish while the context gauge and cache-hit rate stay tied to the active conversation.

## 🐞 Bug fixes

### Complete session usage totals

The footer's cost and cumulative cache statistics now include model usage reported by tools such as codemode, as well as cache warming, compaction, and branch summaries. Totals cover the whole session, including other conversation branches, without counting nested tool usage twice.

Completed assistant and tool messages now update these statistics without waiting for the background Git refresh. The context gauge and cache hit rate continue to describe the active conversation rather than nested model calls.

*By @mavam in #37.*
