# Foundations

## Palette

The colours come from the logo: navy (`#0b1d33`, `#050e1c`, `#143a66`), electric blue
(`#3b82f6`, `#60a5fa`) and ice (`#cfe8ff`, `#f0f8ff`). They live as oklch custom properties in
`apps/web/src/index.css` (`:root` for light, `.dark` for dark), under shadcn's token names so the
utility classes keep their meaning. The hex values below are the source; convert them to oklch
when writing `index.css`.

| Role               | Token (class)                                            | Light                                       | Dark                                        |
| ------------------ | -------------------------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| Canvas             | `--background` (`bg-background`)                         | `#f7f9fc`                                   | `#0b1526`                                   |
| Surface            | `--card`, `--popover` (`bg-card`, `bg-popover`)          | `#ffffff`                                   | `#11203a`                                   |
| Raised             | `--raised` (`bg-raised`); `--muted`, `--secondary`       | `#eef3fa`                                   | `#172a4a`                                   |
| Text               | `--foreground`                                           | `#13213a`                                   | `#eef4ff`                                   |
| Muted text         | `--muted-foreground`                                     | `#5b6b82`                                   | `#9aaccb`                                   |
| Border             | `--border`, `--input`                                    | `#e1e8f2`                                   | `rgba(255,255,255,.09)`                     |
| Accent             | `--primary` (`bg-primary`, `text-primary`)               | `#2f6fe8`                                   | `#6aa8ff`                                   |
| On accent          | `--primary-foreground`                                   | `#ffffff`                                   | `#0b1526`                                   |
| Accent strong      | `--primary-strong`                                       | `#2459c7`                                   | `#3b82f6`                                   |
| Accent soft        | `--accent` (`bg-accent`), `--accent-foreground` = accent | `#e6efff`                                   | `#1a3360`                                   |
| Ok / warn / danger | `--success` / `--warning` / `--destructive`              | `#0f8f6a` / `#b7791f` / `#d23b3b`           | `#5ee0a8` / `#f6c66b` / `#ff8a8a`           |
| Focus              | `--ring` = accent                                        | `ring-ring/45`                              | `ring-ring/45`                              |
| Card shadow        | `--shadow-card` (`shadow-card`)                          | `0 1px 2px #0b1d330f, 0 8px 24px #0b1d330f` | `0 0 0 1px #ffffff0d, 0 8px 24px #00000059` |
| Menu shadow        | `--shadow-menu` (`shadow-menu`)                          | `0 12px 32px #0b1d3329`                     | `0 16px 40px #0000008c`                     |
| Primary glow       | `--shadow-glow` (`shadow-glow`)                          | `0 0 18px` accent at 45%                    | `0 0 18px` accent at 45%                    |
| Overlay            | `--overlay`, `--overlay-foreground`                      | `#050e1c` at 85% / `#f0f8ff`                | same                                        |
| Scrim              | `--scrim`                                                | black at 55%                                | same                                        |

- The page sits on the existing `.page-glow` radial gradient: `#e6f0ff` from the top right in
  light, `#15305c` in dark.
- `--overlay` and `--scrim` stay the same in both themes because they sit on images or over the
  page. The watched bar's track is white at 35% on the image.
- The `--sidebar-*` tokens are retired: the guide is the canvas colour.
- The brand tile `/uroboros-tile.svg` is the only navy element in light mode.
- Accent blue marks actions, links, selection and focus. It never means success, warning or
  failure.

## Type

- **Roboto** 400, 500 and 700 for everything, from `@fontsource/roboto` (this replaces Geist and
  Bricolage).
- Technical text (format selectors, templates, paths) uses the mono stack.

| Use                       | Size / line / weight     |
| ------------------------- | ------------------------ |
| Page title                | 24 / 1.15 / 700          |
| Section heading           | 16 / 1.3 / 700           |
| Body                      | 14 / 20 / 400            |
| Labels and button text    | 14 / 500                 |
| Video title in a tile     | 15 / 21 / 500, two lines |
| Video title in a list row | 16 / 22 / 500            |
| Meta                      | 12, muted                |
| Badge                     | 11.5 / 500               |

There is no negative letter-spacing, and no display font.

## Density (roomy)

| Thing                                   | Value         |
| --------------------------------------- | ------------- |
| Regular control (button, select)        | 44px tall     |
| Compact control                         | 36px tall     |
| Outlined text field                     | 56px tall     |
| Button side padding (compact)           | 20px (14px)   |
| Icon button                             | 40px square   |
| Guide row                               | 40px          |
| List row vertical padding               | 14px          |
| Gap between sections / related controls | 16px / 8–12px |
| Phone touch target                      | ≥ 44px        |

## Corners

| Thing                                      | Radius                      |
| ------------------------------------------ | --------------------------- |
| Buttons, selects, icon buttons, guide rows | 10px                        |
| Outlined text field                        | 8px                         |
| Chips, avatars, switches, search, Create   | full                        |
| Thumbnails                                 | 12px (none on phones' feed) |
| Cards and panels                           | 16px                        |
| Menus and dialogs (one dialog primitive)   | 12px                        |
| Phone bottom sheet                         | 16px                        |
| Duration and count badges                  | 4px                         |

## Focus and states

- **Focus:** `focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/45`,
  one class for both themes. An outlined field also turns its border `border-primary`.
- **Hover:** `bg-raised` on ghost and quiet things, and `bg-accent text-primary` on icon buttons.
- **Selected:** guide rows and menu items fill `bg-raised` or `bg-accent`. Chips invert.
- **Disabled:** `disabled:opacity-45`, with the real `disabled` attribute.
- Honour `prefers-reduced-motion`: no shimmer and no shrinking timer line.

## Elevation

- Cards and panels (`bg-card`) use `shadow-card`.
- Menus, popovers, toasts and dialogs use `shadow-menu`.
- YouTube-shaped regions are flat: the top bar, the guide, settings sections and tables.

## Today

`index.css` still has Geist and Bricolage (`--font-display`), the shadcn token set with the navy
`--sidebar-*` tokens, and no `--raised`, `--primary-strong`, `--shadow-*`, `--overlay` or
`--scrim`. The re-skin adds them. Until it lands, those classes don't exist; adding the tokens
is the first step of the re-skin.
