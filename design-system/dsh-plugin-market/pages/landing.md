# Landing Page Override

This file overrides `../MASTER.md` for the public WebUI preview.

## Why this override exists

The generated OLED/newsletter direction conflicts with the product brief and the software-interface constraints in `design-taste-frontend`. This page is a developer-tool marketplace and interactive catalog, not an editorial newsletter. The first dark implementation was explicitly rejected because it made the product small, left too much empty space, and produced poor Chinese line breaks.

## Direction

- Pattern: search-first marketplace plus interactive product demo.
- Theme: light, content-first, calm technical utility.
- Layout: asymmetric left-aligned introduction followed immediately by a large interactive catalog.
- Density: medium. Information is grouped with dividers and negative space instead of repeated cards.
- Motion: CSS transforms and opacity only, 180–360ms, with a reduced-motion fallback.

## Tokens

| Role | Value |
| --- | --- |
| Canvas | `#f3f4ef` |
| Surface | `#ffffff` |
| Primary text | `#191d1b` |
| Secondary text | `#65706a` |
| Divider | `#d9ded9` |
| Accent | `#267a59` |
| Accent soft | `#e5f1eb` |
| Error | `#a44738` |

Use only the green accent family. Do not add purple, blue glow, gradient text, or pure black.

## Typography

- Product and body: Geist Variable.
- Code, numbers, metadata: Geist Mono Variable.
- No serif type and no oversized hero heading.
- Maximum hero size: `clamp(2.75rem, 5.4vw, 5.25rem)` with balanced wrapping.

## Component rules

- Use `@phosphor-icons/react` exclusively, regular weight by default.
- Interactive targets are at least 44px.
- Buttons have hover, focus-visible, active, disabled, success, and error states.
- Search includes loading, no-results guidance, and clear-filter recovery.
- At widths below 768px, all asymmetric grids collapse to one column and plugin details use a sliding panel.
- The live catalog is the main visual asset and begins above the fold on common laptop sizes.

## Forbidden patterns

- Centered hero copy.
- Dark full-page canvas.
- Serif headlines.
- Giant decorative typography.
- Three equal feature cards.
- Empty decorative space that pushes the working product below the fold.
- Structural emoji or hand-drawn icon systems.
