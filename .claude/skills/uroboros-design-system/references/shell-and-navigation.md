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
2. The brand: `Brand` (the tile and "Uroboros" in Roboto 700, 18px).
3. The [search](actions-and-forms.md#search), centred and up to about 640px wide.
4. **"+ Create"**: a 36px full-round pill on `bg-raised` with a 20px `Plus` and the label at 500.
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
- Groups today: the primary group (Library, Downloads, Subscriptions, Settings), then **Admin**
  for admins (Users, Format profiles).
- When subscriptions exist, a **Subscriptions** group lists channels with 24px round avatars.
- **Mini mode** (from the menu button) is a 72px rail: the icon above a 10px label, with the
  current item filled.
- **On a watch page** (`/library/$entryId`, `isWatchPage` in `nav.ts`) the side navigation steps
  aside for the player, as on YouTube: the menu button opens it as a 240px drawer from the left
  over the scrim (`components/NavDrawer.tsx`), with its own menu button and brand where the top
  bar's sit. Any navigation closes it, and closing it returns the focus to the menu button. The
  same drawer is the [phone](phone.md#getting-around) menu.
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
- Not yet followed: Downloads, Settings, Account, Users and Format profiles still centre a
  `max-w-3xl` to `max-w-5xl` column. Bring each one to this rule when you next change it.

## Create and the download dialog

- **"+ Create"** opens the **Download a link** dialog directly: with one thing to create, a menu in
  between is a wasted click. It becomes a Radix dropdown (the [menu](actions-and-forms.md#menus)
  recipe) listing only real actions once there is a second one.
- The dialog (`rounded-[12px]`, the [dialog](feedback-and-containers.md#dialogs) recipe) holds:
  - the title "Download a link";
  - the [outlined field](actions-and-forms.md#text-fields) "Link", autofocused;
  - the format `<select>`, with the default profile first ("Default (…)") from `useProfiles`;
  - footer buttons: quiet **Cancel**, then primary **Download**. This dialog keeps a primary
    button.
- Submitting keeps today's `QuickDownload` logic:
  - `choosing` navigates to `/downloads?request=<id>`;
  - `probing` or `queued` closes the dialog and shows a toast with a View action;
  - `failed` and API errors show inline and keep the dialog open.

## Account menu

A Radix dropdown from the avatar, with a header about the person and ruled sections:

1. **Header:** a 40px avatar (the initial on `bg-raised` until avatars exist), the display name
   at 500, `@username` muted (the email when there's no username, or nothing), and a "Manage your
   account" link to `/account`.
2. **Settings**, with an 18px icon. The header's link is the way to the account page, so there's
   no separate Account item.
3. **Appearance: Device theme ›**, a submenu with Light, Dark and Device (check on the current
   one). It drives `lib/theme.ts`.
4. **Sign out**. Keep its push cleanup (`forgetThisDevice()` before `signOut`).

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
  tabpanels; links between routes stay links with `aria-current`.

## Page header

B: the title (24/700) with a muted description under it, the page's main action at the trailing
edge (wrapping under the title when narrow), and a hairline rule under the header (`pb-3.5
border-b border-border`). A page holding a single list doesn't repeat the list's own heading.
On phones a section's title, description and rule are hidden (the title stays for screen
readers) and only the action shows; a page about one thing passes `titleOnPhone` to keep its
title ([phone](phone.md#getting-around)).
