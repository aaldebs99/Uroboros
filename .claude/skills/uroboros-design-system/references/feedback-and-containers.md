# Feedback and containers

## Toasts

Sonner (`components/ui/sonner.tsx`, mounted once in `root.tsx`), restyled.

- **Placement:** from `md` up, top right under the top bar. On phones, bottom right, 12px above the
  bottom tabs (`<Toaster aboveTabBar />` in `root.tsx`); a public link's page has no tabs, so its
  toasts sit 16px from the bottom. `Toaster` picks the position with `useMediaQuery(DESKTOP_QUERY)`
  and gives Sonner's own phone layout (below 600px) the same offsets; the card keeps its width
  and keeps to the right (`max-md:ml-auto`).
- **Shape:** `bg-popover border border-border rounded-[12px] shadow-menu`, about 300px wide, with
  `px-3.5 py-3` padding.
- **Content:** a tone icon (`CircleCheck` success, `CircleAlert` destructive, `Info` primary), a
  title at 500, muted detail, and at most one compact secondary action ("View", "Undo").
- **Timer line** (C's): a 2px `bg-primary` bar along the bottom edge that shrinks from full width
  to zero over the toast's duration. It pauses while hovered and isn't drawn under reduced motion.
- **How:** one helper in `components/ui/sonner.tsx`, `notify({ tone, title, detail, action,
  duration = 5000 })`, renders the card with `toast.custom((id) => <ToastCard … />, { duration })`.
  Callers use `notify`, never raw `toast.*`, so every toast gets the same card and timer.
- **Timer line:** an element inside `ToastCard`, not a pseudo-element (Sonner's own
  `[data-sonner-toast]::after` is taken):
  `<span className="toast-timer absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary"
  style={{ animationDuration: `${duration}ms` }} />`. In `index.css`, `.toast-timer` animates
  `scaleX(1)` to `scaleX(0)` linearly. It pauses whenever Sonner pauses:
  `[data-sonner-toaster]:hover .toast-timer` and `[data-expanded="true"] .toast-timer` get
  `animation-play-state: paused`. Under `prefers-reduced-motion` the line isn't drawn.
- **When to use one:** a toast reports what an action came to. Never use one for page state,
  validation (that stays inline) or progress.

## Status badges

C's outlined pill without a dot. The target component is `StatusBadge`; today `ui/badge.tsx` is
shadcn's filled badge.

```tsx
<span className="inline-flex h-[22px] items-center rounded-full border border-current/45 px-2 text-[11.5px] font-medium text-warning">
  Pick entries
</span>
```

Requests and jobs are separate contract enums, so there are two maps: `RequestState` for
requests, and `DownloadState` (plus `DownloadProgress["phase"]` while running) for jobs.

| Request state (`RequestState`) | Label        | Tone (text class)       |
| ------------------------------ | ------------ | ----------------------- |
| `probing`                      | Checking     | `text-primary`          |
| `choosing`                     | Pick entries | `text-warning`          |
| `queued`                       | Queued       | `text-muted-foreground` |
| `failed`                       | Failed       | `text-destructive`      |

| Job state (`DownloadState`)       | Label         | Tone (text class)       |
| --------------------------------- | ------------- | ----------------------- |
| `queued`                          | Queued        | `text-muted-foreground` |
| `queued`, held (`sizeHold`)       | Needs your OK | `text-warning`          |
| `running`, no progress yet        | Starting      | `text-primary`          |
| `running`, phase `downloading`    | Downloading   | `text-primary`          |
| `running`, phase `storing`        | Saving        | `text-primary`          |
| `running`, phase `merging`        | Merging       | `text-warning`          |
| `running`, phase `postprocessing` | Processing    | `text-warning`          |
| `done`                            | Done          | `text-success`          |
| `failed`                          | Failed        | `text-destructive`      |
| `cancelled`                       | Cancelled     | `text-muted-foreground` |

- Write each map as `{…} as const satisfies Record<RequestState, …>` (likewise
  `Record<DownloadState, …>` and `Record<DownloadProgress["phase"], …>`), so a new state breaks
  `tsc`.
- Badges carry state only. Format, size and quality are a muted text line.

## Notices

B's tinted box:

```tsx
<div
  role="status"
  className="flex gap-3 rounded-[12px] border border-warning/40 bg-warning/10 px-3.5 py-3"
>
  <TriangleAlert className="mt-0.5 size-[18px] shrink-0 text-warning" aria-hidden />
  <div>
    <p className="font-medium">Cookies expire soon</p>
    <p className="text-xs text-muted-foreground">Upload fresh cookies in Settings.</p>
    <Link className="text-[13px] text-primary hover:underline" to="/settings">
      Open settings
    </Link>
  </div>
</div>
```

The tone follows the meaning: warning, destructive, success, or primary for information. A notice
stays until its condition is gone. It may carry one or two actions in a row under its text
(`Notice`'s `actions`, default-size buttons so they are 44px to touch), as the installed app's
offer of notifications does with Turn on and Not now.

## Empty states

Centred: a large circled glyph, a title, one line and one action. The target component is
`EmptyState`, replacing `ComingSoon`'s dashed card.

```tsx
<div className="flex flex-col items-center gap-3 py-12 text-center">
  <span className="grid size-24 place-items-center rounded-full bg-raised text-muted-foreground">
    <Library className="size-11" strokeWidth={1.5} aria-hidden />
  </span>
  <h2 className="text-base font-bold">Your library is empty</h2>
  <p className="max-w-[34ch] text-xs text-muted-foreground">
    Videos you download show up here. Paste a link to get started.
  </p>
  <Button variant="primary">
    <Plus aria-hidden />
    Download a link
  </Button>
</div>
```

There's no box or dashed border, and at most one action, which opens an existing flow.

## Loading

B's shimmer:

- Placeholders take the content's shape: a 16:9 block with 12px corners, a 36px circle and two
  12px text bars (90% and 60% wide), all `bg-raised`.
- A 1.4s linear shimmer sweeps across them. It's static under reduced motion.
- Placeholders are `aria-hidden`; the region gets `aria-busy`.
- Loading, empty, failed and forbidden are four different states.

## Settings sections

Flat rows with no card: a label column on the left, and rules between rows.

- A grid of `grid-cols-[200px_1fr] gap-5 py-4`, with a hairline `border-t border-border` between
  rows.
- The left column is the label at 14/500.
- The right column holds the muted description (12px) on the left and the control at the right
  edge (`flex items-center justify-between gap-4`).
- Below `md` the columns stack: label, description, control.
- A group of sections gets a section heading (16/700) and optionally a muted line.
- A secret the server keeps for someone (a saved site login's password) is write-only: an "Add …"
  button opens a form dialog that takes it with `autoComplete="new-password"` (so the browser
  doesn't offer the Uroboros password), the list shows only what identifies it (site, username,
  when it changed) and whether it still works, and changing it means entering it again in the same
  dialog.

## Dialogs

A plain panel with a title, muted text and text-button actions. Add
`components/ui/alert-dialog.tsx` (radix `AlertDialog`) for confirmations and
`components/ui/dialog.tsx` (radix `Dialog`) for form dialogs. Neither exists today; the library
still uses `window.confirm`. Both share the panel below.

- **Overlay:** `bg-scrim`.
- **Panel:** `bg-popover rounded-[12px] p-6 shadow-menu w-[min(26rem,calc(100vw-2rem))]`, with
  `gap-3.5`.
- **Text:** the title at 18/700 and the description in muted body text.
- **Confirmation dialogs** (`AlertDialog`): every footer action is a **text-only pill** at the
  bottom right, `h-10 rounded-full px-3.5 font-medium text-primary hover:bg-raised`. The
  destructive one is `text-destructive hover:bg-destructive/13`.
- **Form dialogs** (`Dialog`, such as Download a link): the footer is a quiet Cancel followed by a
  primary button for the action the form starts.

```tsx
<div className="flex justify-end gap-1">
  <AlertDialogCancel className="h-10 rounded-full px-3.5 font-medium text-primary hover:bg-raised">
    Cancel
  </AlertDialogCancel>
  <AlertDialogAction className="h-10 rounded-full px-3.5 font-medium text-destructive hover:bg-destructive/13">
    Remove
  </AlertDialogAction>
</div>
```

## Stats

Numbers an admin reads at a glance (`admin/AdminStatsPage.tsx`, and the tiles of
`admin/AdminHealthPage.tsx`), after the dataviz skill:

- **Stat tiles** in a row (`grid-cols-2 md:grid-cols-4 gap-4`), each a `<dt>`/`<dd>` pair in a
  `<dl>`: a card (`rounded-2xl bg-card p-4 shadow-card`), the label 14px muted in sentence case,
  the value 24/700 with proportional figures. No delta or sparkline until there is a history.
- **Meter lists** for parts of a whole, one hue: each row's name and figures (`bytes · share`,
  muted, `tabular-nums`) on one line and its bar beneath, largest first. The bar is an 8px
  `bg-primary` fill on a `bg-primary/15` track, both `rounded-full`, `aria-hidden` (the figures
  carry the values). A part at zero draws nothing; a share under 1% reads "<1%".
- A table column can end in the same meter under its figure (By person's Storage).

## Tables

A gridless table: hairlines between rows, quiet headers, and a hover fill.

- Native `<table>`, with no grid.
- Headers at 12/500 muted, `px-2.5 py-2.5`.
- Rows are split by hairlines, and the row under the pointer is filled `bg-raised`.
- A thumbnail column (72px, 8px corners) where it helps.
- Numbers right-aligned with `tabular-nums`; technical values in mono.
- A wide table scrolls locally (`overflow-x-auto`).
- Columns show only fields the contract has; a column waits for its field.
- Below `md` each row becomes a stacked block: name first, then muted `label: value` lines, and
  the actions at the side.
