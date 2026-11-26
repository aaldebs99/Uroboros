import { Check, type LucideIcon } from "lucide-react";
import { Fragment, type ReactElement, useRef, useState } from "react";

import { DESKTOP_QUERY, useMediaQuery } from "@/lib/media";
import { cn } from "@/lib/utils";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "./sheet";

export type MenuAction = {
  label: string;
  icon: LucideIcon;
  destructive?: boolean;
  /** A hairline above the row, starting a group. */
  separated?: boolean;
} & (
  | {
      onSelect: () => void;
      /** A row that is on or off: the current item's accent and a trailing check while on. */
      checked?: boolean;
      href?: never;
    }
  | {
      /** A file to save (a real `<a download>`), or with `external` a page to open in a new tab. */
      href: string;
      external?: boolean;
      onSelect?: never;
      checked?: never;
    }
);

const sheetRow =
  "flex h-12 w-full items-center gap-4 px-5 text-left text-sm outline-none hover:bg-raised focus-visible:bg-raised";

const linkTarget = (external = false) =>
  external ? { target: "_blank", rel: "noreferrer" } : { download: true };

type Pick = (onSelect: () => void) => () => void;

/** A dropdown row. A toggle hands focus back to the trigger; any other pick may open a dialog. */
function DropdownRow({ action, pick }: { action: MenuAction; pick: Pick }) {
  const { label, icon: Icon, destructive = false } = action;
  const body = (
    <>
      <Icon aria-hidden />
      {label}
    </>
  );
  if (action.href !== undefined) {
    return (
      <DropdownMenuItem destructive={destructive} asChild>
        <a href={action.href} {...linkTarget(action.external)}>
          {body}
        </a>
      </DropdownMenuItem>
    );
  }
  if (action.checked !== undefined) {
    return (
      <DropdownMenuCheckboxItem checked={action.checked} onSelect={action.onSelect}>
        {body}
      </DropdownMenuCheckboxItem>
    );
  }
  return (
    <DropdownMenuItem destructive={destructive} onSelect={pick(action.onSelect)}>
      {body}
    </DropdownMenuItem>
  );
}

/** A bottom sheet row; a toggle says whether it is on (`aria-pressed`) and shows a check. */
function SheetRow({ action, pick, close }: { action: MenuAction; pick: Pick; close: () => void }) {
  const { label, icon: Icon, destructive = false } = action;
  const on = action.checked === true;
  const className = cn(sheetRow, destructive && "text-destructive", on && "bg-accent text-primary");
  const body = (
    <>
      <Icon className="size-5.5" aria-hidden />
      {label}
      {on ? <Check className="ml-auto size-5.5" aria-hidden /> : null}
    </>
  );
  if (action.href !== undefined) {
    return (
      <a href={action.href} {...linkTarget(action.external)} className={className} onClick={close}>
        {body}
      </a>
    );
  }
  const run = action.checked === undefined ? pick(action.onSelect) : action.onSelect;
  return (
    <button
      type="button"
      className={className}
      aria-pressed={action.checked}
      onClick={() => {
        close();
        run();
      }}
    >
      {body}
    </button>
  );
}

/**
 * An action menu: a dropdown from `md` up, and below it a bottom sheet with 3rem rows. Rows act,
 * save a file, open a page in a new tab (`external`), or toggle (`checked`); `separated` starts a
 * group. `trigger` must be a single element that accepts a ref (a `Button`).
 */
export function ResponsiveMenu({
  title,
  trigger,
  actions,
  align = "end",
}: {
  /** Names the menu for screen readers (the sheet's title). */
  title: string;
  trigger: ReactElement;
  actions: readonly MenuAction[];
  align?: "start" | "end";
}) {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const [open, setOpen] = useState(false);
  /** Set when an action was picked: it may open a dialog, so focus mustn't return to the trigger. */
  const picked = useRef(false);
  const keepFocus = (event: Event) => {
    if (picked.current) event.preventDefault();
    picked.current = false;
  };
  const pick = (onSelect: () => void) => () => {
    picked.current = true;
    onSelect();
  };
  if (desktop) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align={align} aria-label={title} onCloseAutoFocus={keepFocus}>
          {actions.map((action) => (
            <Fragment key={action.label}>
              {action.separated === true ? <DropdownMenuSeparator /> : null}
              <DropdownRow action={action} pick={pick} />
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="bottom" hideClose className="gap-0 py-2" onCloseAutoFocus={keepFocus}>
        <span aria-hidden className="mx-auto mb-1 h-1 w-9 rounded-full bg-border" />
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <SheetDescription className="sr-only">{title}</SheetDescription>
        <ul className="grid">
          {actions.map((action) => (
            <li
              key={action.label}
              className={cn(action.separated === true && "mt-2 border-t border-border pt-2")}
            >
              <SheetRow
                action={action}
                pick={pick}
                close={() => {
                  setOpen(false);
                }}
              />
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
