import { ChevronDown } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { boxClasses, FieldFoot, labelClasses, useFieldIds } from "./field";

/** Options whose text holds `filter` (any case), those starting with it first. */
export function rankOptions(options: readonly string[], filter: string): string[] {
  const needle = filter.trim().toLowerCase();
  if (needle === "") return [...options];
  const starts = options.filter((o) => o.toLowerCase().startsWith(needle));
  const within = options.filter(
    (o) => !o.toLowerCase().startsWith(needle) && o.toLowerCase().includes(needle),
  );
  return [...starts, ...within];
}

/** Keeps the active option in view as the arrow keys move through a scrolling list. */
function scrollIntoList(list: HTMLUListElement | null, index: number): void {
  const item = list?.children[index];
  if (list === null || !(item instanceof HTMLElement)) return;
  if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
  const bottom = item.offsetTop + item.offsetHeight;
  if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
}

/**
 * A searchable select in the outlined field's box, for a list too long to scroll (the login
 * sites): typing filters the options, the arrow keys move through them, Enter or a click picks
 * one, and Escape closes the list (not the dialog around it). The value is always one of the
 * options or "" (nothing picked): text that matches none is dropped when the field loses focus.
 * `free` makes it a text field with suggestions instead (a channel's name): the value is what is
 * typed, nothing is picked until an arrow key moves to a suggestion (so Enter submits the form),
 * and no suggestion matching hides the list. WAI-ARIA's combobox pattern: an input with
 * `role="combobox"` controlling a listbox.
 */
export function ComboboxField({
  label,
  options,
  value,
  onChange,
  placeholder,
  noMatch = "Nothing matches",
  help,
  error,
  required,
  free = false,
  maxLength,
  id,
  className,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  noMatch?: string;
  help?: string;
  error?: string | null;
  required?: boolean;
  free?: boolean;
  maxLength?: number;
  id?: string;
  className?: string;
}) {
  const chrome = { label, help, error };
  const { fieldId, helpId, errorId, describedBy } = useFieldIds(id, chrome);
  const listId = `${fieldId}-list`;
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  // Free text picks no suggestion until an arrow key moves to one.
  const none = free ? -1 : 0;
  const [active, setActive] = useState(none);
  const listRef = useRef<HTMLUListElement>(null);
  // The picked option's own text lists everything; anything else typed filters (free text, always).
  const matches = rankOptions(options, text === value && !free ? "" : text);
  const listed = open && (matches.length > 0 || !free);
  const activeId =
    open && matches[active] !== undefined ? `${listId}-${String(active)}` : undefined;

  const close = () => {
    setOpen(false);
    setText(value);
  };
  const choose = (option: string) => {
    onChange(option);
    setText(option);
    setOpen(false);
  };

  // Escape closes the list first: caught on window, ahead of a dialog's own document listener,
  // and marked handled so the dialog stays open.
  useEffect(() => {
    if (!open) return undefined;
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setText(value);
    };
    window.addEventListener("keydown", onEscape, { capture: true });
    return () => {
      window.removeEventListener("keydown", onEscape, { capture: true });
    };
  }, [open, value]);

  useEffect(() => {
    scrollIntoList(listRef.current, active);
  }, [active]);

  const move = (step: number) => {
    setOpen(true);
    setActive((at) => Math.min(Math.max(at + step, 0), Math.max(matches.length - 1, 0)));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    const pick = matches[active];
    if (event.key === "Enter" && open && pick !== undefined) {
      // Picks rather than submitting the form around the field.
      event.preventDefault();
      choose(pick);
    }
  };

  return (
    <div className={cn("grid gap-1", className)}>
      <div className="relative">
        <input
          id={fieldId}
          role="combobox"
          aria-expanded={listed}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          autoComplete="off"
          spellCheck={false}
          required={required}
          placeholder={placeholder}
          maxLength={maxLength}
          className={cn(boxClasses, "h-14 pt-4 pr-9")}
          value={text}
          onChange={(e) => {
            const typed = e.target.value;
            setText(typed);
            setOpen(true);
            setActive(none);
            // Typing an option exactly picks it; any other text leaves nothing picked (unless free).
            onChange(free || options.includes(typed) ? typed : "");
          }}
          onClick={() => {
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          onBlur={close}
        />
        <label htmlFor={fieldId} className={labelClasses}>
          {label}
        </label>
        <ChevronDown
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          hidden={!listed}
          className="absolute inset-x-0 top-full z-10 mt-1 max-h-60 overflow-y-auto rounded-[0.75rem] bg-popover py-2 text-popover-foreground shadow-menu"
        >
          {matches.map((option, i) => (
            <li
              key={option}
              id={`${listId}-${String(i)}`}
              role="option"
              aria-selected={i === active}
              className={cn(
                "cursor-pointer px-4 py-2 text-sm",
                i === active && "bg-accent text-primary",
                option === value && "font-medium",
              )}
              // Keeps the focus in the input, so picking doesn't count as leaving the field.
              onMouseDown={(e) => {
                e.preventDefault();
              }}
              onMouseEnter={() => {
                setActive(i);
              }}
              onClick={() => {
                choose(option);
              }}
            >
              {option}
            </li>
          ))}
          {matches.length === 0 && !free ? (
            <li
              role="option"
              aria-selected={false}
              aria-disabled
              className="px-4 py-2 text-sm text-muted-foreground"
            >
              {noMatch}
            </li>
          ) : null}
        </ul>
      </div>
      <FieldFoot chrome={chrome} helpId={helpId} errorId={errorId} />
    </div>
  );
}
