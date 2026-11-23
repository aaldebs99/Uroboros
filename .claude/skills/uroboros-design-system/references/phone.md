# Phone (below `md`, 48rem)

A slim top bar with a menu button, and bottom tabs.

## Getting around

- **Top bar:** slim, about 48px, on `bg-background`. It holds a ghost menu button at the left,
  the brand (tile and wordmark at 16px), a ghost search button, and the 28px avatar (the account
  menu).
- **The menu button** opens the side navigation as a 240px drawer from the left
  (`components/NavDrawer.tsx`, a native `<dialog>` over the scrim, ported from Djinn), with its own
  menu button and brand where the top bar's sit. It holds everything the side navigation does on
  desktop (the library's views, Settings, the Admin pages); any navigation closes it.
- **A finger drags it** in from anywhere on the page and drags it shut, following one to one, and
  a release settles on the nearer side or the way it was thrown. It is not an edge swipe, because
  phones take a swipe from the bezel as Back. A sideways drag that starts on something with its
  own use for one stays theirs: a sideways scroller (the chips, the library's tabs), a field, a
  slider, or anything marked `data-own-swipe` (the player).
- **Motion:** it slides in and out in 200ms on iOS's curve (`cubic-bezier(0.32, 0.72, 0, 1)`); the
  close button, the scrim and Escape slide it out, and reduced motion makes it instant.
- **No section titles:** a section page starts with its content. `PageHeader` hides a section's
  title and description on phones (screen readers still get them) and shows only its action. A
  page about one thing (a playlist, a subscription) keeps its title: pass `titleOnPhone`.
- **Filter chips** sit under the top bar on pages that have them, scrolling sideways, with the
  page's sort select at the end of the same row (its "Sort" label hidden on phones).
- **Bottom tab bar:**
  - 58px plus `env(safe-area-inset-bottom)`, `bg-background` with a hairline `border-t`, fixed to
    the bottom.
  - Five slots: **Library**, **Downloads**, a centred **"+"**, **Subscriptions** and **You**.
  - The "+" is a 40px circle with a 1.5px `border-foreground` and a 22px `Plus`.
  - Each tab is a 22px icon over a 10px label, with targets at least 44px wide.
  - The current tab is `text-foreground` with `aria-current="page"`; the others are muted.
- The **You** tab opens the account page (`/account`), which also lists Settings and, for admins,
  the Admin pages (Users, Format profiles).
- Leave room for the tab bar at the bottom of the scroll area (`pb-[calc(58px+env(safe-area-inset-bottom))]`).

## Library feed

A single-column feed:

- Thumbnails run **edge to edge**, full width with no corners.
- Under each: `px-3 pt-2.5`, a 36px avatar, the two-line title at 14/500, muted meta and a ghost
  ⋮.
- Items are 14px apart.

## Menus: the ⋮ bottom sheet

A sheet of action rows that slides up from the bottom:

- On phones, ⋮ and other action menus open a bottom sheet instead of a dropdown.
- Inset 8px from the edges, `bg-popover rounded-2xl`, with a grab handle (36×4, `bg-border`)
  and `bg-scrim` behind.
- Rows are 48px, `gap-4 px-5`, each with a 22px icon. The destructive row is `text-destructive`.
- It closes on scrim tap, Escape, or a downward swipe.
- Build it from the existing radix `Dialog` or `Sheet` with `side="bottom"`. Keep one component
  that renders a dropdown at `md` and up and a sheet below it.

## Download a link

The **"+"** opens the same centred **Download a link** [dialog](feedback-and-containers.md#dialogs)
as desktop's Create, inset 24px from the sides. Once there is more than one thing to create, it
opens them as a bottom sheet (above) instead.

## Rules

- Nothing widens a 375px page. Rows wrap, and flex children holding text get `min-w-0`.
- Touch targets are at least 44px, and nothing is hover-only: actions revealed on hover stay
  visible under `(hover: none)`.
- Tables become stacked blocks, and settings rows stack.
