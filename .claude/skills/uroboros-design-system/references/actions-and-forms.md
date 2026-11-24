# Actions and forms

The button lives in `components/ui/button.tsx` (cva). Its target variants are `primary`,
`secondary`, `quiet`, `destructive`, `icon` and `ghost`, in sizes `default` (44px) and `compact`
(36px). Today it has shadcn's `default`, `outline`, `destructive` (solid red) and others. The
re-skin replaces them; map old uses as you touch them.

## Buttons

Every button shares a base: `inline-flex items-center justify-center gap-2 h-11 px-5 rounded-[10px]`,
14/500 text, a lucide icon at 16–18px before the label, the focus ring, and 45% opacity when
disabled.

| Variant     | Classes (beyond the base)                                                              | Use                               |
| ----------- | -------------------------------------------------------------------------------------- | --------------------------------- |
| Primary     | `bg-primary text-primary-foreground shadow-glow`                                       | The one main action in a region   |
| Secondary   | `bg-card border border-border text-foreground shadow-[0_1px_2px_#0b1d330f]`            | Other actions                     |
| Quiet       | `text-primary bg-transparent hover:bg-raised`                                          | Cancel, Select none, View all     |
| Destructive | `bg-destructive/13 text-destructive hover:bg-destructive/20` (a tonal fill, no border) | Remove, Delete, Cancel a download |
| Compact     | `h-9 px-3.5 text-[13px]`                                                               | Rows, toasts, dense headers       |

- A pending action keeps its label and changes it ("Saving…") with real `disabled`.
- Destructive is never solid red.
- Inside a dialog, actions are text-only pills: see
  [dialogs](feedback-and-containers.md#dialogs).

## Icon buttons

- A 40px square with 10px corners on `bg-raised`, the icon at 18–20px, and an `aria-label`.
- **Ghost** (in the top bar and for ⋮) has no fill until hovered.
- Hover: `bg-accent text-primary`.
- A destructive icon (cancel, delete) stays danger on hover: `text-destructive
  hover:bg-destructive/13`, never the accent hover.

## Links

Accent text with no underline at rest, underlined on hover and focus: `text-primary no-underline
hover:underline focus-visible:underline`. Use the router
`Link` for in-app destinations.

## Text fields

An outlined box, 56px tall, with the label inside it at the top left and the value beneath:

```tsx
<div className="grid gap-1">
  <div className="relative">
    {/* The input comes first so the label can follow its focus and error state with peer-*. */}
    <input
      id={id}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy /* only the ids that render: help and/or error, else omit */}
      className="peer h-14 w-full rounded-[8px] border border-foreground/25 bg-transparent px-3.5 pt-4 text-sm
                 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/45
                 aria-invalid:border-destructive"
    />
    <label
      htmlFor={id}
      className="absolute top-2 left-3.5 text-xs text-muted-foreground peer-focus-visible:text-primary peer-aria-invalid:text-destructive"
    >
      Output template
    </label>
  </div>
  <div className="flex justify-between text-xs text-muted-foreground">
    <span id={`${id}-help`}>Where finished files go.</span>
    <span className="tabular-nums">17/200</span>
  </div>
  {error ? (
    <p id={`${id}-err`} className="text-xs text-destructive">
      {error}
    </p>
  ) : null}
</div>
```

- The label sits inside the box at the top left, 12px muted. It turns accent on focus and danger
  on error.
- Helper text and an optional `n/max` counter go below the box, and the error goes below them.
- Technical values use `font-mono`.
- The target is an outlined `Field` component in `components/ui/`. Today `input.tsx` is shadcn's
  plain input with the label above it.

## Selects

- A native `<select>` styled as a box: `h-11 rounded-[10px] border border-border bg-card px-3.5
  pr-9`, with a lucide `ChevronDown` decoration (16px) at the right.
- The native popup and keyboard behaviour stay. Every select carries a `data-slot` (`Select`,
  `SelectField`), which `index.css` uses to draw the open list as a [menu](#menus) where the browser
  allows (`appearance: base-select`: `bg-popover`, a hairline, `rounded-[12px]`, `shadow-menu`,
  rows `px-4 py-2.5`, the chosen one `bg-accent text-primary` with its check), and to give the
  OS list the theme's colours elsewhere. Never a bare `<select>`.
- The compact variant is `h-9 text-[13px]`.
- **A list too long to scroll** (the ~90 login sites) is a searchable `ComboboxField`
  (`components/ui/combobox-field.tsx`) instead: the outlined field's box with an input
  (`role="combobox"`, "Type to search") over a [menu](#menus)-styled listbox. Typing filters
  (matches that start with the text first), the arrow keys move the `bg-accent text-primary` row,
  Enter or a click picks, Escape closes only the list, and text that matches nothing is dropped on
  leaving the field. Keep a native select for short lists.

## Menus

Radix `DropdownMenu` (`components/ui/dropdown-menu.tsx`):

- The menu is `bg-popover rounded-[12px] shadow-menu py-2 min-w-56`.
- Items are `px-4 py-2.5 gap-3` with an 18px leading icon.
- The current item is `bg-accent text-primary` with a trailing `Check`.
- Groups are split by a hairline separator.
- A destructive item is `text-destructive`.
- On phones the same actions open as a bottom sheet: see [phone](phone.md).

## Checkboxes, radios and switches

- **Checkbox:** 18px with 5px corners and a 1.5px `border-muted-foreground`. Checked:
  `bg-primary border-primary`, an on-accent check and a soft glow
  (`shadow-[0_0_10px] shadow-primary/45`).
- **Radio:** an 18px circle with a 2px muted ring. Selected: an accent ring with an 8px accent
  dot.
- **Switch:** radix `Switch` (add `components/ui/switch.tsx`). Root: `h-[22px] w-[38px] rounded-full
  border border-border bg-raised data-[state=checked]:bg-primary data-[state=checked]:shadow-glow`.
  Thumb: `size-4 rounded-full bg-muted-foreground translate-x-0.5 transition-transform
  data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-white`.
- Labels make rows of at least 32px (44px on phones). Native keyboard behaviour stays.

## Search

A pill-shaped input joined on its right to a search button segment, so the two read as one
control:

```tsx
<form role="search" className="flex w-full max-w-xl">
  <input
    aria-label="Search your library"
    placeholder="Search"
    className="h-10 min-w-0 flex-1 rounded-l-full border border-r-0 border-foreground/22 bg-card px-4 text-sm"
  />
  <button
    type="submit"
    aria-label="Search"
    className="grid h-10 w-16 place-items-center rounded-r-full border border-foreground/22 bg-raised"
  >
    <Search className="size-5" aria-hidden />
  </button>
</form>
```
