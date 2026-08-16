# Landing Page Override

This file overrides `../MASTER.md` for the public WebUI preview (Vercel).

## Why this override exists

The generated OLED/newsletter direction in the Master file conflicts with the product brief. As of 2026-08 the shipped direction is the interactive design comp `Plugin Market.dc.html` (Organic design system base, custom blue/teal token layer): a light, warm, over-rounded marketplace — the site is the product, and the same language runs inside the in-DSH settings panel.

## Direction

- Pattern: full-viewport application shell (store/catalog), not a scrolling marketing page. No hero, no feature sections, no conversion copy.
- Theme: light canvas `#f5f7fb` with an atmospheric background layer — blue hairline grid that fades downward, two blurred halo blobs, and slow scanning beam lines (`dshBeamX/Y`, `dshHalo` keyframes; everything still under `prefers-reduced-motion`).
- Layout (desktop):
  1. Sticky blurred top bar: blue shield brand mark, Caprasimo brand name, centered search pill (`⌘K` focuses), 中文/EN segment, GitHub outline pill.
  2. Teal-tinted status strip: ruleset-online pulse, index stats in mono (entries / one-click / npm verified / source verified), snapshot date.
  3. Body: left filter rail (246px sticky; 安装能力 / 能力标签 / 分类 pill options with mono counts; rail footer is a dark-ink card with the market install command) + card grid (`repeat(auto-fill, minmax(330px, 1fr))`).
  4. Detail replaces the list (deep-linkable via `?e=<entry-id>`): back pill, header card (tier-tinted monogram avatar, Caprasimo name, tier pill, repo link, labelled AI summary, big score + primary action), README.md panel, 322px sticky sidebar (evidence card with will-run terminal, author-hint card, 12-metric grid, category/tags + topics).
  5. The grid is card-based, not hairline rows: white surfaces with a 1px blue gradient top line, hover lift + blue glow.
- Mobile (<900px): rail collapses to a horizontal scrolling pill row; detail sidebar stacks under the main column.
- Keyboard: `⌘K` focus search, `Esc` back to list. All clickables Tab-reachable with a blue `:focus-visible` ring.
- Motion: opacity/transform only, 150–300ms, `prefers-reduced-motion` fallback.

## Tokens

| Role | Value |
| --- | --- |
| Canvas / surface / elev | `#f5f7fb` / `#ffffff` / `#eef1f7` |
| Ink (text) | `#212327` (800 `#2c2f36`, 700 `#454a55`, 600 `#6b7280`, 400 `#b9bec9`) |
| Hairline | `#e4e7ef` |
| Accent blue | `#4d6bfe` (600 `#3d57e0`, 700 `#2f43b8`, 800 `#24338c`, 300 `#a9b8ff`, 200 `#d3dbff`, 100 `#eaeeff`) |
| Sage/teal (verified, online) | `#0f9d8f` (100 `#e2f5f2`, 300 `#96ddd4`, ink `#0b6f66`) |
| Terminal | bg `#212327`, fg `#a9b8ff` — dark in every context |

Tier colors are functional: npm-verified sage, source-verified blue, likely/related quiet grey. Score readouts are bold mono in accent blue.

## Typography

- Display: Caprasimo (`@fontsource/caprasimo`), weight 400 — brand, headlines, card titles. CJK falls back to the system stack (as in the comp).
- Body: Figtree Variable (`@fontsource-variable/figtree`).
- Numbers, metadata, counts, kbd hints, terminals: `ui-monospace, SFMono-Regular, Menlo` with `tabular-nums`.
- Icons: inline SVG, Lucide paths on a 24 grid, stroke-width 2.75.

## Component rules

- Buttons and inputs are pills (`border-radius: 999px`); cards are 20–22px; overlays ~28–32px. No sharp corners, no hairline-only geometry.
- Filter options are full-row pills (active = solid accent); the sort control is a segmented pill group; tier badges are tinted pills with a dot; chips are 7–8px-radius accent tints.
- Terminal blocks carry a `$` prompt and a small copy button riding the top-right corner.
- Interactive states always themed (hover tint, pressed step darker, `:focus-visible` 2px accent outline); disabled at 45% opacity.
- Search keeps: loading skeleton cards, empty state with recovery action, clear-all-filters dashed chip.
- Performance: keep `backdrop-filter` OFF repeated content surfaces (cards/panels). It stays only on the two sticky chrome bars; blurring over the animated background from 100+ cards pegs the compositor.

## Forbidden patterns

- Marketing landing structure (hero, feature grids, testimonial strips).
- Dark canvas (the site is light-only), serif headlines other than Caprasimo, centered hero copy, giant decorative typography.
- Emoji or hand-drawn icon systems.
- Layout-shifting hovers, invisible focus states, instant state changes.

## Embedded plugin UI (src/client)

The in-DSH marketplace tab is the panel variant of the same language inside the host's ~560px settings column: header zone (title + synced pulse + mono count + refresh icon-button), pill search with `/` shortcut hint, filter pills (可一键安装 / 全部 / 已安装, mono counts) with a sort popover, the dashed "entries hidden by One-click" widen chip, hover-tinted rows (name + tier pill + installed pill / summary / mono meta line, action button right), and a replace-style detail view (back pill + tier pill, install card with will-run terminal + evidence line, author-hint dashed box with 不会执行 badge, 4-column metrics, README.md section, tag chips, sticky footer with score + the single action).

Host constraints still apply: neutrals derive from host `--ds-*` variables with light/dark fallbacks via `prefers-color-scheme` (light `#f5f7fb/#ffffff` family, dark `#16181d/#1d2026` family), the market blue accent family is its own, hand-written inline SVG icons only (`ui.tsx`), CSS Modules only. The pre-install confirmation dialog (trust text + will-run terminal) stays mandatory and matches the overlay/dialog pattern.

### Panel preview

`?preview=panel` on the site renders the real `src/client/MarketTab.tsx` inside a mock settings window (fake nav, host `--ds-*` variables set for light/dark, zh/EN toggle, mocked install state) — code-split via `React.lazy` so site visitors never download it. Use it to browser-test the panel without booting a DSH host.
