# Shell and navigation

Today the shell is `routes/root.tsx` (a full-width bar over a fixed navy `SidebarNav`, and a
`Sheet` drawer on phones), with `components/QuickDownload.tsx` (a "+" popover), `auth/UserMenu.tsx`
and `components/ThemeToggle.tsx`. The target below replaces their look; the behaviour stays:
`AuthGate`, `usePushSync`, `isAdmin`, the routes, and the quick download's submit logic.

## Top bar (md and up)

A bar in the page colour (`bg-background`), 56px tall, with no border or shadow, holding from left
to right:

1. A ghost icon button with `Menu`, which toggles the side navigation between full and mini (on a
   watch page, and on phones, it opens the navigation drawer).
2. The brand: `Brand` (the tile and "Uroboros" in Roboto 700, 18px), a link to the library
   (`<Brand home />`, as in the navigation drawer; the sign-in page and a public link keep the
   bare mark).
3. The [search](actions-and-forms.md#search), centred and up to about 640px wide. While it is
   empty it shows a `<kbd>` hint for the [search palette](#search-palette-ctrlk) ("Ctrl K", or "⌘K"
   on a Mac, from `paletteHint()`).
4. **"+ Add"**: a 36px full-round pill on `bg-raised` with a 20px `Plus` and the label at 500,
   opening the [Add menu](#add-menu-and-its-dialogs).
5. The account avatar, a 32px circle, which opens the [account menu](#account-menu).

The bell slot stays empty until an in-app notification list exists. There's no separate theme
button: the theme lives in the account menu.

## Side navigation

A list of sections in the page colour, below the top bar, not a separate coloured panel:

- It is 240px wide on `bg-background`, not a separate navy panel.
- Rows are `h-10 rounded-[10px] px-3 gap-6`, with a 20px icon and a 14px label.
- The current row is `bg-raised font-medium` with `aria-current="page"`; hover is `bg-raised/60`.
- Groups are split by a hairline rule (`border-t border-border mx-1 my-2`), with headings at
  12/500 muted (`px-3 pt-3.5 pb-1.5`).
- Groups today: the primary group (Library, Downloads, Subscriptions, Shared, Settings), then
  **Admin** for admins (Users).
- **A section's views are indented under it** (`SECTIONS` in `components/SidebarNav.tsx`, the
  lists in `nav.ts`): Library's Videos, Channels and Playlists, and Settings' Notifications,
  Logins and Profiles, as `h-9 pl-14` muted rows, the current view filled. The section's own row then only
  turns medium while one of its pages is open. On phones the same views are underlined tabs atop
  the page (`ViewTabs`, `RouteTabs phoneOnly`); the mini rail has no room for them.
- When subscriptions exist, a **Subscriptions** group lists channels with 24px round avatars.
- **Mini mode** (from the menu button) is a 72px rail: the icon above a 10px label, with the
  current item filled.
- **On a watch page** (`/library/$entryId`, `isWatchPage` in `nav.ts`) the side navigation steps
  aside for the player, as on YouTube: the menu button opens it as a 240px drawer from the left
  over the scrim (`components/NavDrawer.tsx`), with its own menu button and brand where the top
  bar's sit. Any navigation closes it, and closing it returns the focus to the menu button. The
  same drawer is the [phone](phone.md#getting-around) menu, where a finger can also drag it in and
  out; from `md` up only the button opens it.
- The navigation list stays in `nav.ts`.

## Page width

The main area is the window less the side navigation, inside 32px margins (16px on phones, 24px
on a watch page). Pages use all of it:

- Grids, lists, tables, the downloads queue and the watch page fill the width and grow with the
  window. A video grid adds columns (`auto-fill`) rather than stretching its tiles.
- Never centre a page in an `mx-auto max-w-*` column: on a wide window it leaves empty bands on
  both sides and puts the content far from the navigation.
- A block that reads badly stretched (a form's fields, a settings column, a long paragraph) caps
  its own width (`max-w-3xl`, about 768px) and stays at the left margin.
- Sign-in, which has no shell, is the one centred page. Dialogs are centred overlays.
- Not yet followed: Account and Users still centre a `max-w-3xl` to `max-w-5xl` column. Bring each one to this rule when you next change it.

## Search palette (Ctrl+K)

`search/SearchPalette.tsx`: one field that finds a video or downloads one. Ctrl+K (⌘K) opens it
from anywhere, a field included, and closes it again (`usePaletteShortcut` in `lib/shortcuts.ts`,
which leaves the key alone while another dialog or the drawer is open); the phone's search button
opens it too.

- The panel is the [dialog](feedback-and-containers.md#dialogs) recipe made wide and anchored near
  the top (`w-[min(40rem,calc(100vw-2rem))]`, `md:top-[12dvh]`, `top-4` on phones), with no
  padding: a 56px field row with a `Search` glyph over a hairline (`border-b border-border`), then
  the list, scrolling inside the panel.
- The field is a WAI-ARIA combobox over a listbox; the focus never leaves it. The arrow keys move
  the active row (`bg-accent`), Enter chooses it, a pointer hovers and clicks. Rows are at least
  44px: a video is a 96px 16:9 thumbnail, a one-line title and a muted channel line; an action is a
  36px `bg-raised` circle with its glyph and one line of text.
- Sections carry small muted headings ("In your library", "On YouTube"); the actions ("See all
  results…", "Search YouTube for “…”", "Download this link", "Choose a format…") have none.
- Muted lines say where things stand ("Nothing in your library matches", "Checking your
  library…", "Searching YouTube…" with a spinner); a failure is destructive text with the
  collapsed yt-dlp output. What a download came to is a toast, and a YouTube result's row keeps it
  ("Queued" in success, "In your library" muted), so several can be downloaded in a row.

## Add menu and its dialogs

- **"+ Add"** opens a menu (`AddMenu` over `ResponsiveMenu`: the
  [menu](actions-and-forms.md#menus) recipe as a Radix dropdown from `md` up, the phone's bottom
  sheet below) with exactly two real actions: **Download** (lucide `Download`), opening the
  Download a link dialog, and **Upload** (lucide `Upload`), opening the Upload a video dialog. A
  new item joins only when its feature exists.
- The Download a link dialog (`rounded-[12px]`, the
  [dialog](feedback-and-containers.md#dialogs) recipe) holds:
  - the title "Download a link";
  - the [outlined field](actions-and-forms.md#text-fields) "Link", autofocused;
  - the format `<select>`, with the default profile first ("Default (…)") from `useProfiles`;
  - footer buttons: quiet **Cancel**, then primary **Download**. This dialog keeps a primary
    button.
- Submitting keeps today's `QuickDownload` logic:
  - `choosing` navigates to `/downloads?request=<id>`;
  - `probing` or `queued` closes the dialog and shows a toast with a View action;
  - `failed` and API errors show inline and keep the dialog open.
- The **Upload a video** dialog (`uploads/UploadDialog.tsx`, the same recipe) holds:
  - the file: a `bg-raised` `rounded-2xl` area with the file's name and size, which takes a
    dropped video from `md` up, and a secondary **Choose a video** button (the real input is
    `sr-only`, labelled "Choose a video");
  - the outlined fields Title (the file's name until the person writes one, with a counter),
    Description, Creator (their display name, with help), and Tags (comma-separated, with help);
  - the thumbnail picker (`ThumbnailPicker`): a 16:9 `rounded-[12px]` preview from a data: URL,
    **Choose an image**, and help saying a frame stands in without one;
  - footer buttons: quiet **Cancel**, then primary **Upload**.
- Once the server takes it, the dialog shows the upload instead: the title, the 8px glowing bar
  with real bytes ("12.0 MB of 40.0 MB"), and text pills **Cancel upload** (danger text), **Try
  again** when sending paused, and **Hide**, which keeps it going. It closes itself once the video
  is in the library; the toast "Uploaded: <title>" with an Open action reports it. Unfinished
  uploads also show on the Downloads page under **Uploads**, with the same badge and bar, and
  "Choose the file" to finish one a reload stopped.

## Account menu

A Radix dropdown from the avatar, with a header about the person and ruled sections:

1. **Header:** a 40px avatar (the initial on `bg-raised` until avatars exist), the display name
   at 500, `@username` muted (the email when there's no username, or nothing), and a "Manage your
   account" link to `/account`.
2. **Settings**, with an 18px icon. The header's link is the way to the account page, so there's
   no separate Account item.
3. **Appearance: Device theme ›**, a submenu with Light, Dark and Device (check on the current
   one). It drives `lib/theme.ts`.
4. **Size: 100% ›**, a submenu with 90, 100, 110 and 125% (check on the current one), the UI's
   [scale](foundations.md#scale) on this device. It drives `lib/uiScale.ts`.
5. **Sign out**. Keep its push cleanup (`forgetThisDevice()` before `signOut`).

Rules split the sections.

## Filter chips and tabs

Filters are a row of pills; views are underlined text tabs.

```tsx
<div role="toolbar" aria-label="Filter" className="flex gap-2 overflow-x-auto">
  <button
    aria-pressed
    className="h-8 rounded-full bg-foreground px-3 text-[13px] font-medium text-background"
  >
    All
  </button>
  <button aria-pressed={false} className="h-8 rounded-full bg-raised px-3 text-[13px] font-medium">
    Music
  </button>
</div>
```

- **Chips:** 32px pills on `bg-raised`, with the selected chip inverted (`bg-foreground
  text-background`). A row of chips scrolls sideways on phones, never wraps the page wider.
- **Sort** sits at the end of the chips' row, a compact `Select` after a muted "Sort" label (the
  label hidden on phones, the select keeping `aria-label="Sort"`). The chips (`min-w-0`) scroll
  beside it; the select doesn't shrink.
- **Tabs:** text at 500, muted; the current tab is `text-foreground` with a 2px `border-foreground`
  underline over a hairline (`border-b border-border`). Use `role="tablist"` only for real
  tabpanels; links between routes stay links with `aria-current`. A page whose views each have
  an address (Shared's With me and By me, Settings' Notifications and Logins) uses
  `components/ui/route-tabs.tsx`; add the view's route to its `RouteTab` union.

## Page header

No section titles, at any width: the navigation already says where you are, so `PageHeader`
keeps a section's title and muted description for screen readers only and a page starts with its
content. Only the page's main action shows, at the trailing edge, with no rule; a header with no
action takes no room at all. A page about **one thing** (a playlist, a subscription, a shared
playlist, a new subscription's source) passes `showTitle`, since its title names that thing: B's
title (24/700) with the muted description under it, the action at the trailing edge (wrapping
under the title when narrow), and a hairline rule under the header (`pb-3.5 border-b
border-border`). A page holding a single list doesn't repeat the list's own heading.

A detail page reached from a list (a subscription) has a **back link** above its title: a compact
quiet button at the left margin (`-ml-3.5`, so its arrow lines up with the text) with an
`ArrowLeft` and the list's name ("← Subscriptions"), a router `Link` to the list rather than
`history.back()`, so it works from a deep link too. It shows in the page's error state as well.
