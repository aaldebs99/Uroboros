---
name: uroboros-design-system
description: Use when building, changing or reviewing anything in Uroboros's web UI under apps/web/ (pages, the shell, buttons, fields, badges, toasts, dialogs, video tiles, progress bars, tables, phone layouts, colors, fonts, spacing, focus) or deciding how a new control should look.
---

# Uroboros design system

Uroboros is a **media library drawn in the Uroboros logo's colours** (navy, electric blue and
ice): bare 16:9 thumbnails with the details beneath, pill-shaped chips and search, flat
page-coloured navigation, quiet menus, and bottom tabs on phones. The user picked every
primitive from four rendered options in a mockup workshop on 2026-11-22. Colour, focus and
elevation are today's look refined, at a **roomy** density: Roboto 14px, 44px controls. Both light and dark themes stay.

## Target, not today

This skill describes the **target design**. The re-skin of `apps/web` follows it; until then the
app still has Geist and Bricolage, a navy sidebar, shadcn's default variants and a drawer on
phones. **Build new UI to the target**, using the recipes here. When a target component (such as
`EmptyState` or the outlined `Field`) doesn't exist yet, write its recipe or create it in
`components/ui/`; never import a name that isn't there. Where today's code differs from this
skill, this skill wins. The existing files are listed in each reference.

## Rules for every change

1. **Colours come from tokens.** Use the target token classes in
   [foundations](references/foundations.md): `bg-background`, `bg-card`, `bg-raised`,
   `bg-primary`, `bg-accent` (soft blue), `text-muted-foreground`, `text-destructive`,
   `text-success`, `text-warning`, `shadow-card`, `shadow-menu` and `bg-overlay`. Never use a hex
   value or a raw Tailwind colour (`red-600`, `bg-black/75`). Tokens switch with the theme, so
   don't add `dark:` colour pairs. The one exception is data: SponsorBlock's marks on the player's
   timeline wear the colours the viewer picked ([media](references/media-and-library.md#player)).
2. **Blue is the accent, never a state.** Success is `success`, warnings are `warning` and
   failures are `destructive`. Every contract state has a tone in
   [feedback](references/feedback-and-containers.md#status-badges). Branch on contract enums
   exhaustively.
3. **Destructive actions are tonal** (a danger label on a 13% danger tint, no border) everywhere
   except a dialog's footer, where every action is a **text-only pill** and the destructive one
   is danger text. Never a solid red button.
4. **Status is an outlined pill**: a 45% tone border, tone text, no fill and no dot. Metadata
   (format, size) is a muted text line, not a badge.
5. **Focus is a 3px soft ring** (`focus-visible:outline-none focus-visible:ring-[3px]
   focus-visible:ring-ring/45`, one class for both themes). Hover,
   focus, selected and disabled (45% opacity, real `disabled`) all look different.
6. **Keep native semantics.** Real labels, a native `<select>`, `<table>`, `aria-current`,
   `aria-describedby` for help and errors, and `role="progressbar"` with values. Icons are
   lucide at 18–22px; an icon-only button has an `aria-label`.
7. **Toasts report outcomes; notices persist.** What an action came to (queued, saved, failed)
   is a Sonner toast. A condition the page keeps (cookies expiring) is a notice. Never show a
   fake percentage.
8. **One breakpoint, `md` (48rem).** Above it: the top bar and the side navigation. Below it: the slim top
   bar, whose menu button opens the navigation as a drawer, and the **bottom tab bar**. Nothing
   may widen a 375px page. Touch targets are at least 44px. At every width a section's page title
   is for screen readers only; a page about one thing shows its title (`showTitle`).
9. **Show only real features.** No Pause, watched bar, subscriber count or Add menu item until
   the feature behind it exists. The bell exists: the top bar's notifications and work in
   progress ([shell](references/shell-and-navigation.md#notifications)).
10. **Pages use the whole page.** A page fills the main area from its left margin to its right:
    grids, lists, tables and the watch page grow with the window. Never centre a page in an
    `mx-auto max-w-*` column that leaves empty bands either side. A block that reads badly
    stretched (a form, a settings column, a paragraph) caps its own width and stays at the left
    margin. Details in [shell-and-navigation](references/shell-and-navigation.md#page-width).
11. **Sizes are rem, never pixels.** One knob sizes the whole UI: the root font size, 100% of the
    reader's browser size on desktop and 110% on phones, times `--ui-scale` (the account menu's
    Size). The pixel figures in this skill are design pixels at a 16px rem: write a Tailwind
    spacing step when there is one (`w-42` for 168, `size-4.5` for 18) and `px ÷ 16` rem
    otherwise (`rounded-[0.75rem]`, `text-[0.8125rem]`). Only 1px hairlines stay pixels.
    `ratchet:pixels` fails any other `px` under `apps/web/src`; a value that truly must be device
    pixels carries `px-allow: <why>` on its line. Details in
    [foundations](references/foundations.md#scale).
12. **Every detail page has a back link.** A page about one thing that a list leads to (a
    channel, a playlist, a subscription, a group, a shared playlist, a new subscription) starts
    with `BackLink` (`components/ui/back-link.tsx`) above its title: "← Playlists", a router link
    to that list, never `history.back()`. It shows in every state the page has, loading and errors
    included. Only the watch page goes without. Details in
    [shell-and-navigation](references/shell-and-navigation.md#back-link).

## Where each primitive is

| Primitive                                                                                                | Pick                                                                                                                                          | Reference                                                        |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Palette, tokens, type, density, corners, focus, elevation                                                | Today's blues refined; Roboto 14/20; 44px; 10px controls, 16px cards; soft ring                                                               | [foundations](references/foundations.md)                         |
| Buttons, icon buttons, links, text fields, selects, menus, checkboxes, radios, switches, search          | Glowing primary, tonal delete; underline-on-hover links, label-inside fields, pill search                                                     | [actions-and-forms](references/actions-and-forms.md)             |
| Top bar, side navigation, Add menu and its dialogs, account menu, chips and tabs, page header, back link | Page-coloured bar and side navigation, an Add menu (Download, Upload), inverted chips; header with action right; "← List" above a detail page | [shell-and-navigation](references/shell-and-navigation.md)       |
| Video tile, list row, channel header, playlist tile, progress, queue row, preview picker                 | Bare thumbnail tiles, stacked playlist tiles, checkbox picker; thick glowing progress bar                                                     | [media-and-library](references/media-and-library.md)             |
| Toasts, status badges, notices, empty states, loading, settings sections, dialogs, tables                | Corner toast with timer line; outlined badges; circled-glyph empty state; flat settings rows, text-button dialogs, gridless tables            | [feedback-and-containers](references/feedback-and-containers.md) |
| Phone shell, library feed, ⋮ sheet, download dialog                                                      | Bottom tabs with a centred +, edge-to-edge feed, bottom sheet                                                                                 | [phone](references/phone.md)                                     |

Read the reference for the family you are touching before you write classes.

## Corners are explicit

`index.css` maps `rounded-lg` and `rounded-xl` to its `--radius` scale, so the recipes use exact
values, in rem: `rounded-[0.625rem]` (10) controls, `rounded-[0.5rem]` (8) fields,
`rounded-[0.75rem]` (12) thumbnails, menus, dialogs and toasts, `rounded-2xl` (16) cards and
sheets, `rounded-[0.25rem]` (4) duration badges, and `rounded-full` pills. Write those, not a bare
`rounded-lg` or `rounded-xl`.

## Common mistakes

| Mistake                                                         | Instead                                                                       |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `variant="destructive"` solid red, or an outlined Cancel        | Tonal destructive; in dialogs, text-only pill actions                         |
| A filled or dotted status badge (`bg-warning`, a coloured dot)  | An outlined pill with tone text                                               |
| A video in a bordered card with the title in a padded body      | A bare tile: thumbnail, then avatar, two-line title, meta, ⋮                  |
| A dashed box for an empty list                                  | `EmptyState`: a 96px circle with a glyph, a title, a line, one action         |
| A section title ("Library", "Downloads") atop a page            | `PageHeader` keeps it for screen readers; the navigation says where you are   |
| A label above an input                                          | The outlined field with the label inside the box                              |
| Geist or Bricolage, body text at 16px, `font-display`           | Roboto 14/20 body; titles are Roboto 700                                      |
| A 6px flat `bg-primary` progress bar                            | An 8px pill bar with an accent gradient and glow, plus `role="progressbar"`   |
| `bg-black/75` on a duration badge                               | `bg-overlay text-overlay-foreground`                                          |
| A navy sidebar (`bg-sidebar`)                                   | Side navigation on the canvas colour, with the current row filled `bg-raised` |
| A Pause button or a subscriber count                            | Only when the feature exists                                                  |
| A pixel size (`w-[168px]`, `rounded-[12px]`, `text-[13px]`)     | A spacing step or rem: `w-42`, `rounded-[0.75rem]`, `text-[0.8125rem]`        |
| A page centred in `mx-auto max-w-4xl` with empty bands beside   | The page at full width; a form or settings column capped and left-aligned     |
| A detail page with no way back, or back only once it has loaded | `BackLink` to its list above the title, in every state of the page            |
