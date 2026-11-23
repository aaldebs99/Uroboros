# Media and library

Today the library is `library/LibraryPage.tsx` (an `EntryCard` in a bordered card) and the queue
is `downloads/QueueRow.tsx` (a 6px flat bar and filled badges). The formatters live in
`downloads/format.ts`. The target below replaces their look.

## Video tile

A bare tile with no card: the thumbnail, and the details under it beside a channel avatar.

```tsx
<li className="grid gap-3">
  <div className="relative aspect-video overflow-hidden rounded-[12px] bg-raised">
    {entry.thumbnailUrl === null ? (
      <Film className="absolute inset-0 m-auto size-8 text-muted-foreground" aria-hidden />
    ) : (
      <img src={entry.thumbnailUrl} alt="" loading="lazy" className="size-full object-cover" />
    )}
    {entry.duration === null ? null : (
      <span className="absolute right-1.5 bottom-1.5 rounded-[4px] bg-overlay px-1 py-0.5 text-xs font-medium text-overlay-foreground tabular-nums">
        {formatDuration(entry.duration)}
      </span>
    )}
  </div>
  <div className="flex gap-3">
    {/* No channel images exist yet: the channel's initial on bg-raised stands in for the avatar. */}
    <span
      aria-hidden
      className="grid size-9 shrink-0 place-items-center rounded-full bg-raised text-sm font-medium"
    >
      {(entry.channel ?? "?").slice(0, 1).toUpperCase()}
    </span>
    <div className="min-w-0 flex-1">
      <p className="line-clamp-2 text-[15px]/[21px] font-medium">{entry.title}</p>
      <p className="text-xs text-muted-foreground">{entry.channel}</p>
      <p className="text-xs text-muted-foreground">
        {entry.profileName} · {formatBytes(entry.sizeBytes)} · added {relativeTime(entry.addedAt)}
      </p>
    </div>
    <button
      type="button"
      aria-label={`Actions for ${entry.title}`}
      className="grid size-10 shrink-0 place-items-center rounded-[10px] hover:bg-accent hover:text-primary
                 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/45"
    >
      <MoreVertical className="size-5" aria-hidden />
    </button>
  </div>
</li>
```

- The grid is `grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-x-4 gap-y-8`.
- There's no card, no border and no padded body.
- With no thumbnail, `bg-raised` holds a muted 32px `Film` icon.
- The meta line uses `LibraryEntry`'s fields: profile name, size, and when it was added. There's
  no item page yet, so the title is plain text; when one exists, the title becomes the link.
- ⋮ opens the menu (a bottom sheet on phones). The whole tile is never a button.
- The watched bar (a 4px `bg-primary` bar on a `bg-white/35` track along the thumbnail's bottom
  edge) appears only once watch progress is tracked.

## Watch page

`library/ItemPage.tsx`, after YouTube's watch page, across the whole page:

- The side navigation is a [drawer](shell-and-navigation.md#side-navigation) here and the margins
  are 24px, so the player starts at the left margin and takes the page's width less the
  suggestions column (18 to 25rem) on the right, 24px away.
- Under the player: the title (20/700), the channel row with the actions (Watched, Keep on a
  subscription's entry, Save, Remove, Open on the site), the clamped description, tags, the
  playlists it is in, and chapters.
- The columns follow the page's width (`@container`, two columns from `@6xl`); on a narrower page
  the suggestions stack under the details.
- The suggestions are "From your library" rows: a 168px thumbnail with the title, channel and
  when it was added beside it.

## Player

Video.js 10's packaged Neutral video skin (`library/Player.tsx`), branded through its public
custom properties (accent, radius, font) and, for the timeline only, `library/player.css`:

- The timeline is a full-width row along the top of the control bar, after YouTube's: 3px, 5px
  while pointed at (the pointed-at chapter 7px), chapters 2px apart. Unplayed is white at 20%,
  buffered white at 40%, the run up to the pointer white at 30%, and played the accent with a soft
  glow. The thumb is a 13px accent circle, shown on hover, drag or focus.
- Under the timeline, play, volume and the time sit at the left; captions, settings, cast,
  picture-in-picture and fullscreen sit at the right.
- `player.css` targets the skin's own class names; `playerSkin.test.ts` fails when an upgrade
  renames one. Keep new styling to the public custom properties where they reach.
- Shortcuts: Space and `k` play and pause, `j`/`l` seek 10 s, the arrows 5 s (`PlayerHotkeys`), `,`
  and `.` pause and step one frame, `m` mute, `f` fullscreen, `c` captions, `i`
  picture-in-picture, `0`-`9` jump, `<`/`>` speed.
- The volume and mute are remembered in this browser; opening a video plays it.

## List row

A wide row: a large thumbnail at the left, the details beside it.

- A 200px thumbnail with the same badge.
- The title at 16/22 weight 500, then the meta line and one line of detail, all muted 12px.
- ⋮ at the trailing edge.
- Hover fills the row `bg-raised` with 12px corners.

## Channel header

A banner over a large avatar, with the details and actions beside it:

- A banner (`h-[90px]` up to 16:5) with `rounded-[14px]`.
- An 80px round avatar, then the name at 24/700.
- A line of "@handle · N downloaded" (plus the subscriber count once subscriptions exist).
- A clamped description with a "more" link.
- Actions: the subscription pill (inverted `bg-foreground text-background`, a bell and a chevron,
  once subscriptions exist) and a secondary "Download all".

## Playlist tile

A video tile that looks like a stack, with a count on the thumbnail:

- Two layers peek above the thumbnail: 12px and 6px tall, inset, `bg-raised` at 60% and 85%.
- A count badge at the bottom right (`bg-overlay`, a `ListVideo` icon and "14 videos").
- Below: the title, "Channel · Playlist" muted, and a "View full playlist" link.

## Download progress

B's bar under an outlined badge:

```tsx
<div className="grid gap-1.5">
  <div className="flex items-center gap-2.5">
    <StatusBadge download={download} />
    <span className="flex-1 text-xs text-muted-foreground">
      {detail /* "12.4 MB/s · 38 s left" */}
    </span>
    <span className="text-sm font-medium tabular-nums">{pct}%</span>
  </div>
  <div
    role="progressbar"
    aria-label={`${title} progress`}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={pct}
    className="h-2 overflow-hidden rounded-full bg-raised"
  >
    <div
      className="h-full rounded-full bg-linear-to-r from-primary-strong to-primary shadow-[0_0_12px] shadow-primary/60"
      style={{ width: `${pct}%` }}
    />
  </div>
</div>
```

- Show the bar and the percentage only when there is a real fraction (`percent` not null).
  - A running job with no progress yet shows "Starting" (primary) with no bar.
  - A known phase with a null `percent` shows the phase badge and the detail, with no bar.
- Queued, failed, cancelled and done show the badge and the detail line only.
- The badge tones are in [status badges](feedback-and-containers.md#status-badges).

## Queue row

A's layout:

- A 120px thumbnail.
- The title at 500.
- A state line: the badge and detail, with the error text in `text-destructive` when failed.
- The progress bar while running.
- **One** ghost icon action: **cancel** (`X`, the destructive icon button) while queued or
  running, and **retry** (`RotateCcw`) when failed or cancelled. There's no pause: the contract has none.
- Rows are split by hairlines.

## Playlist preview picker

A's checkbox list:

- **Header:** "Open movies · 3 of 4 selected" at 500, a quiet **Select none** / **Select all**,
  and a primary **Queue 3** (the count in the label).
- **Rows:** a [checkbox](actions-and-forms.md#checkboxes-radios-and-switches), a 120px thumbnail,
  the title at 500, and channel · duration muted. The whole row is the checkbox's `<label>`.
- Unticked rows drop to `opacity-55`.
- Entries already in the library show "In library", muted, in place of the checkbox.
