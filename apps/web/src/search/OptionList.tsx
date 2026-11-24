import { useEffect } from "react";

import { cn } from "@/lib/utils";

import { PaletteRow } from "./PaletteRow";
import type { PaletteOption, PaletteSection } from "./paletteOptions";
import type { ResultState } from "./useYouTubeSearch";

/** The id of an option's row, for the field's `aria-activedescendant`. */
export const optionId = (listId: string, option: PaletteOption) => `${listId}-${option.key}`;

/** Scrolls `box` just enough to show `item`. */
function scrollToShow(box: HTMLElement, item: HTMLElement): void {
  const bottom = item.offsetTop + item.offsetHeight;
  if (item.offsetTop < box.scrollTop) box.scrollTop = item.offsetTop;
  else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
}

/** Keeps the active option in view as the arrow keys move through the scrolling list. */
export function useKeepInView(box: { current: HTMLElement | null }, activeId: string | undefined) {
  useEffect(() => {
    const item = activeId === undefined ? null : document.getElementById(activeId);
    if (box.current !== null && item !== null) scrollToShow(box.current, item);
  }, [box, activeId]);
}

/**
 * The palette's listbox: each section a group under its heading (the actions have none), every
 * row an option. The focus stays in the field; a pointer moves the active row and clicks one.
 */
export function OptionList({
  listId,
  sections,
  active,
  onActive,
  onChoose,
  states,
  downloading,
}: {
  listId: string;
  sections: PaletteSection[];
  /** The active option's index across every section. */
  active: number;
  onActive: (index: number) => void;
  onChoose: (option: PaletteOption) => void;
  states: ReadonlyMap<string, ResultState>;
  /** "Download this link" is under way. */
  downloading: boolean;
}) {
  let index = 0;
  const row = (o: PaletteOption) => {
    const i = index++;
    return (
      <li
        key={o.key}
        id={optionId(listId, o)}
        role="option"
        aria-selected={i === active}
        className={cn(
          "flex min-h-11 cursor-pointer items-center gap-3 px-4 py-1.5 text-sm",
          i === active && "bg-accent",
        )}
        // Keeps the focus in the field, where the arrow keys and typing work.
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onMouseEnter={() => {
          onActive(i);
        }}
        onClick={() => {
          onChoose(o);
        }}
      >
        <PaletteRow
          option={o}
          state={o.kind === "result" ? states.get(o.result.id) : undefined}
          pending={o.kind === "download" && downloading}
        />
      </li>
    );
  };
  return (
    <ul id={listId} role="listbox" aria-label="Results">
      {sections.map((section, n) => {
        const labelId = `${listId}-section-${String(n)}`;
        return (
          <li role="presentation" key={labelId}>
            {section.label === null ? null : (
              <p id={labelId} className="px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">
                {section.label}
              </p>
            )}
            <ul
              role="group"
              aria-labelledby={section.label === null ? undefined : labelId}
              aria-label={section.label === null ? "Actions" : undefined}
            >
              {section.options.map(row)}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}
