Configure the fancy footer visually with a live preview that mirrors widget rows, alignment, order, and settings, making customization immediate and intuitive. This release also adds prompt-cache statistics, smarter context-bar sizing, and broader thinking-level support.

## 🚀 Features

### Cache statistics widgets

Three new built-in widgets surface pi's prompt-cache stats in the fancy footer: cache-read and cache-write show cumulative cache tokens for the session in compact form (e.g. 246k), and cache-hit-rate shows the latest turn's cache hit rate. They sit on the right of the top row before context-capacity and total-cost, keeping the cost rightmost, and hide when the session has no cache activity or the terminal is narrower than 60 columns.

*By @mavam and @claude in #17.*

### WYSIWYG footer configuration

The /fancy-footer config screen is now a WYSIWYG micro-view: widgets appear as chips in the same rows, alignment groups, and order as the real footer, which updates live below on every change. Arrow keys select a widget (shown inverted); l/r move it within and across alignment groups, u/d move it between rows, a cycles alignment, f toggles fill, and x hides it into a bench strip. Enter opens the per-widget settings (visibility, icon, colors, min width), and the general settings sit inline below the preview. Crowded rows automatically degrade from full widget names to short names to icons so every widget stays visible and selectable, with a status line always naming the current selection. Previously every widget had to be positioned through identical row/position/align/fill submenus, which made arranging the footer a guessing game.

*By @mavam and @claude in #16.*

## 🔧 Changes

### Leaner context stats with SI units

The context-capacity widget moved from the top-right corner into the top-left context group next to the context bar, and is now hidden by default: the bar's gauge already conveys usage, so the raw window size starts on the /fancy-footer bench until you enable it. Token counts across the footer now use compact SI-style units, so a one-million-token window reads 1M instead of 1000k, and the total-cost widget stays anchored at the far right of the top row.

*By @mavam and @claude in #17.*

## 🐞 Bug fixes

### Keep cached quota windows on partial provider refresh

A provider usage refresh that returns only some quota windows no longer drops the still-valid cached ones. When Anthropic reports just the weekly window, the footer keeps showing the cached 5-hour window until it resets.

*By @edxeth and @mavam in #15.*

### Let the context bar grow across the row

Setting fill to grow on the context-bar widget now works as documented: the bar expands across the available row width, prefixed with the used context tokens (e.g. 246k) and flanked by the context-capacity widget. Previously the grow setting allocated the width but the bar still drew a fixed gaugeWidth-cell gauge. The default footer is unchanged and keeps the compact mini gauge.

*By @edxeth and @mavam in #15.*

### Support for Pi thinking levels

The thinking widget stays visible when Pi uses the `max` thinking level.

Thinking levels now follow Pi's definitions directly, so future levels also appear in the footer without requiring a matching extension update.

*By @edxeth, @mavam, and @codex in #14.*
