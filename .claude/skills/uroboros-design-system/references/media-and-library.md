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

- The grid is `tileGrid` in `library/VideoTile.tsx`: auto-filled columns of at least 30rem, half
  again YouTube's (`minmax(min(30rem,100%),1fr)`; three across a 1920-pixel window beside the side
  navigation, two at 1440, four at 2560), `gap-x-4 gap-y-10`. Every tile grid (videos, playlists,
  shared) uses it.
- The title and meta use `tileTitle` (two lines, 16/22 at 500 from `md` up, 14/20 on phones) and
  `tileMeta` (muted, 14 from `md` up, 12 on phones).
- There's no card, no border and no padded body.
- With no thumbnail, `bg-raised` holds a muted 32px `Film` icon.
- The meta line uses `LibraryEntry`'s fields: profile name, size, and when it was added. There's
  no item page yet, so the title is plain text; when one exists, the title becomes the link.
- ⋮ opens the menu (a bottom sheet on phones). The whole tile is never a button.
- The watched bar (a 4px `bg-primary` bar on a `bg-white/35` track along the thumbnail's bottom
  edge) appears only once watch progress is tracked.
- **Hover preview** (`PreviewSurface` in `library/ThumbnailPreview.tsx`, `VideoThumbnail`'s
  `preview`, `PreviewPlayer.tsx`): a grid tile's thumbnail plays the whole video at 480p once a
  mouse rests on it for 300 ms, or after a press and hold on a phone. It starts muted with
  captions on, covers the picture (`object-cover`) and fades in over 150 ms once it plays (no fade
  with reduced motion), under the duration badge. Its controls sit over it: a sound button
  (`VolumeX`/`Volume2`) and, below it, a captions button (`Captions`/`CaptionsOff`, only with
  subtitles) in the top right, each a 32px `bg-overlay` circle with a 44px hit area and
  `aria-pressed`, and a scrub bar that takes the watched bar's place while it plays: a 2rem band
  along the bottom with the bar raised inside it (`px-3 pb-2.5`; the watched bar's 4px track,
  6px with a 12px `bg-primary` knob while hovered or dragged, played in `bg-primary`), pressed to
  seek and dragged to scrub. A press on a control never opens
  the video. It stops at the end, when the mouse leaves, another tile starts
  one, the tile scrolls away or a touch lands elsewhere. One plays at a time. It is never the
  player, so it reports no progress. The rows (suggestions, Up next, the playlist editor, the
  palette) have none: a hover there means picking. Sound alone (`hasVideo` false) has none.

## Watch page

`library/ItemPage.tsx`, after YouTube's watch page, across the whole page:

- The side navigation is a [drawer](shell-and-navigation.md#side-navigation) here and the margins
  are 24px, so the player starts at the left margin. It takes 65% of the page and the suggestions
  column the rest (at least 18rem), 24px away; the player isn't wider than that, because a
  full-width player on a large screen is too much.
- Above the player, the [back link](shell-and-navigation.md#back-link) to the page the video was
  opened from (`WatchBack`).
- Under the player: the title (20/700), the channel row with the actions, the clamped
  description, tags, the playlists it is in, and chapters.
- The actions: Watched, Keep on a subscription's entry, then a row of
  [icon buttons](actions-and-forms.md#icon-buttons) each named in a tooltip (Edit details on any
  video of the person's own, Save, Save to playlist, Share, Remove, the last one tonal danger;
  `gap-4`, `md:gap-2`), and Open on the site.
- Edit details on an upload of the person's: title, description, creator and thumbnail, for
  everyone. On any other video of theirs (their own details, docs/library.md#your-own-details): a
  muted line saying only they see them, title, description and a free `ComboboxField` Channel
  suggesting their channels, no thumbnail. While their own show, each changed field's help says
  "On the site: …" ("From the uploader: …" on an upload), and the footer leads with a quiet
  **Reset to the site's details** (`mr-auto`, the footer wraps on a phone) before Cancel and Save.
- The description's http(s) URLs are accent links opening in a new tab (`LinkifiedText`); nothing
  else in it becomes markup. Playlist descriptions and a public link's do the same.
- The player has no `title` (it is `aria-label`led, so no tooltip hangs over the picture) and no
  focus ring of its own: it takes the focus for its shortcuts, and its controls keep theirs.
- What the player says about itself goes over the picture, never in a page toast: a small
  `bg-overlay` pill, as Jump to highlight (top right) and the skip notice (bottom right, the whole
  pill its Unskip button, `SkipNotice`) are, riding above the control bar while it shows.
- The columns follow the page's width (`@container`, two columns from `@6xl`); on a narrower page
  the suggestions stack under the details.
- The suggestions are "From your library" rows, one per row however wide the column (beside the
  player, or under the details on a narrow page): the thumbnail takes 40% of the row (never under
  168px, a phone's; at most 320px when stacked under the details, `@6xl:max-w-none` beside the
  player), and the title, channel and when it was added fill the rest beside it.

## Player

Video.js 10's packaged Neutral video skin (`library/Player.tsx`), branded through its public
custom properties (accent, radius, font) and, for the timeline only, `library/player.css`:

- The timeline is a full-width row along the top of the control bar, after YouTube's: 3px, 5px
  while pointed at (the pointed-at chapter 7px), chapters 2px apart. Unplayed is white at 20%,
  buffered white at 40%, the run up to the pointer white at 30%, and played the accent with a soft
  glow. The thumb is a 13px accent circle, shown on hover, drag or focus.
- SponsorBlock's marks lie over the timeline (`SponsorSkip.tsx`, `player.css`): each shown
  category's bands as thick as the bar, strong (85%) where playback jumps them and faint (40%)
  where it only shows them, and the highlight a 4px full-strength mark. They are the one place a
  color comes from data rather than a token: the viewer's own (Settings › SponsorBlock), the
  SponsorBlock extension's until they choose (`DEFAULT_SPONSORBLOCK_COLORS` in the contract), set
  on the skin as `--uro-sb-<category>`.
- **Jump to highlight** (`HighlightJump.tsx`): while playback is short of the highlight, a
  `bg-overlay` pill in the player's top-right corner, 44px tall (36px from `md`), a `Sparkles`
  icon in the highlight's color beside the label. It comes and goes with the controls and keeps
  the skin's gestures off its press.
- Under the timeline, play, volume and the time sit at the left; captions, settings, cast,
  picture-in-picture and fullscreen sit at the right.
- **Clip** (with clips on): an icon button in the watch page's row under the title, before Save
  (`ItemActions.tsx`; `Scissors`, `aria-pressed`, `bg-accent text-primary` while on). A picked clip
  is a white band over the timeline (`ClipControls.tsx`, in the slot the patch adds), as thick as
  the bar, between two accent handles that are `role="slider"` above the thumb (2.75rem hit areas
  below `md`, 1.5rem from it, the 3px focus ring); a `bg-overlay`
  pill in the top-left corner says its range and length, coming and going with the controls. A
  range a link opens at is the band alone. With a clip picked, Save's menu starts with "This clip
  (1:02–1:30)", and the Share dialog opens on a radio group (Only the clip, The whole video opened
  at it) with a help line under each choice (`components/ui/radio.tsx`).
- The settings menu's **Quality** submenu is ours (`library/QualityMenu.tsx`, in the slot the
  patch adds): Original, then the rungs a video offers, in the skin's own menu classes
  (`playerSkin.test.ts` checks they exist). Under the player, one muted 12px line says how it plays
  ("Direct play", "Direct stream", "Transcoding to 720p · NVIDIA GPU"; `PlaybackStatus.tsx`); while
  a session waits or starts, the player's frame says so in muted text, never a fake percentage.
- `player.css` targets the skin's own class names; `playerSkin.test.ts` fails when an upgrade
  renames one. Keep new styling to the public custom properties where they reach.
- Shortcuts: Space and `k` play and pause, `j`/`l` seek 10 s, the arrows 5 s (`PlayerHotkeys`), `,`
  and `.` pause and step one frame, `m` mute, `f` fullscreen, `c` captions, `i`
  picture-in-picture, `0`-`9` jump, `<`/`>` speed.
- The shortcuts work page-wide on a page with a player (the watch page, a public share), as on
  YouTube: a click on the description or a suggestion doesn't take them away (`PlayerHotkeys` binds
  each on the document too). Typing in a field, Space or Enter on a button or link, and any key
  while the focus is in a dialog, the nav drawer or a menu stay theirs.
- Pointer gestures: on a phone, a tap shows or hides the controls and a double tap at either side
  seeks 10 s (the centre's is fullscreen); with a mouse, a click plays and pauses and a double-click
  anywhere is fullscreen, never a seek (the skin's side double taps are made touch-only by
  `patches/@videojs__react.patch`).
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
