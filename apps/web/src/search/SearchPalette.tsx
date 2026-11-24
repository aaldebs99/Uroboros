import { useNavigate } from "@tanstack/react-router";
import { SEARCH_MIN_CHARS } from "@uroboros/contract";
import { LoaderCircle, Search } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";

import { useLibraryLookup } from "@/api/library";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useStartDownload } from "@/downloads/useStartDownload";
import { YtDlpDetails } from "@/downloads/YtDlpDetails";

import { OptionList, optionId, useKeepInView } from "./OptionList";
import { asLink, type PaletteOption, paletteSections } from "./paletteOptions";
import { useYouTubeSearch } from "./useYouTubeSearch";

/** How long typing rests before the library is asked. */
const SETTLE_MS = 200;

function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSettled(value);
    }, ms);
    return () => {
      window.clearTimeout(timer);
    };
  }, [value, ms]);
  return settled;
}

const Note = ({ children }: { children: ReactNode }) => (
  <p className="px-4 py-3 text-sm text-muted-foreground">{children}</p>
);

function Busy({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
      <LoaderCircle className="size-4 animate-spin" aria-hidden /> {children}
    </p>
  );
}

function Failure({ message, lines }: { message: string | null; lines: readonly string[] }) {
  if (message === null) return null;
  return (
    <div className="grid gap-1 px-4 py-3">
      <p role="alert" className="text-sm text-destructive">
        {message}
      </p>
      <YtDlpDetails lines={lines} />
    </div>
  );
}

/** What the palette says above its rows: how to start, or what the library had. */
function TopNote({
  typed,
  link,
  found,
}: {
  typed: string;
  link: string | null;
  found: readonly unknown[] | undefined;
}) {
  if (typed === "") return <Note>Search your library, or paste a link to download it.</Note>;
  if (link === null && tooShort(typed)) {
    return <Note>Type at least {String(SEARCH_MIN_CHARS)} characters to search your library.</Note>;
  }
  if (link !== null && found === undefined) return <Busy>Checking your library…</Busy>;
  if (found?.length !== 0) return null;
  return link === null ? (
    <Note>Nothing in your library matches “{typed}”.</Note>
  ) : (
    <Note>That video isn’t in your library yet.</Note>
  );
}

/** What the YouTube search for the typed words came to, below its rows. */
function YouTubeNote({ youtube }: { youtube: ReturnType<typeof useYouTubeSearch> }) {
  if (youtube.pending) return <Busy>Searching YouTube…</Busy>;
  if (youtube.results?.length === 0) return <Note>YouTube found nothing for that.</Note>;
  return <Failure message={youtube.error} lines={youtube.ytdlp} />;
}

/** Fewer characters than the library searches (docs/library.md "Search"). */
const tooShort = (words: string) => Array.from(words).length < SEARCH_MIN_CHARS;

/** The library's matches for the typed text: words as they settle, or a link at once. */
function useMatches(typed: string, link: string | null) {
  const words = useSettled(link === null ? typed : "", SETTLE_MS);
  const wordMatches = useLibraryLookup({ q: words, limit: 8 }, !tooShort(words));
  const linkMatches = useLibraryLookup({ url: link ?? "", limit: 5 }, link !== null);
  // Too few characters to search: no matches, never the last longer words' ones.
  if (link === null) return tooShort(typed) ? [] : wordMatches.data;
  // A link's answer is for that link alone: never the last link's while the next one loads.
  return linkMatches.isPlaceholderData ? undefined : linkMatches.data;
}

/** What choosing each kind of option does. */
function useChoose(
  close: () => void,
  onChooseFormat: (url: string) => void,
  youtube: ReturnType<typeof useYouTubeSearch>,
  download: ReturnType<typeof useStartDownload>,
) {
  const navigate = useNavigate();
  return (o: PaletteOption) => {
    switch (o.kind) {
      case "entry": {
        close();
        // A chapter or caption match opens at its moment.
        const start = o.entry.match?.start ?? null;
        void navigate({
          to: "/library/$entryId",
          params: { entryId: o.entry.id },
          ...(start === null ? {} : { search: { t: Math.floor(start) } }),
        });
        return;
      }
      case "all":
        close();
        void navigate({ href: `/?q=${encodeURIComponent(o.query)}` });
        return;
      case "youtube":
        youtube.begin(o.query);
        return;
      case "result":
        youtube.download(o.result);
        return;
      case "download":
        if (!download.pending) download.start({ url: o.url });
        return;
      case "format":
        onChooseFormat(o.url);
        return;
    }
  };
}

function Palette({
  onClose,
  onChooseFormat,
}: {
  onClose: () => void;
  onChooseFormat: (url: string) => void;
}) {
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const typed = text.trim();
  const link = asLink(typed);
  const found = useMatches(typed, link);
  const youtube = useYouTubeSearch();
  const download = useStartDownload(onClose);
  const choose = useChoose(onClose, onChooseFormat, youtube, download);
  const mine = youtube.query === typed;
  const sections = paletteSections({
    typed,
    found,
    results: mine ? youtube.results : null,
    searching: mine && (youtube.pending || youtube.results !== null),
  });
  const options = sections.flatMap((s) => s.options);
  const at = Math.min(active, options.length - 1);
  const current = options[at];
  const activeId = current === undefined ? undefined : optionId(listId, current);
  useKeepInView(box, activeId);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive(Math.min(Math.max(at + step, 0), Math.max(options.length - 1, 0)));
    } else if (event.key === "Enter" && current !== undefined) {
      event.preventDefault();
      choose(current);
    }
  };

  return (
    <>
      <div className="flex items-center gap-3 border-b border-border px-4">
        <Search className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <input
          role="combobox"
          aria-label="Search your library or paste a link"
          aria-expanded={options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          autoComplete="off"
          spellCheck={false}
          placeholder="Search your library or paste a link"
          className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
            download.clear();
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div ref={box} className="relative max-h-[min(30rem,65dvh)] overflow-y-auto pb-2">
        <TopNote typed={typed} link={link} found={found} />
        <OptionList
          listId={listId}
          sections={sections}
          active={at}
          onActive={setActive}
          onChoose={choose}
          states={youtube.states}
          downloading={download.pending}
        />
        {mine ? <YouTubeNote youtube={youtube} /> : null}
        <Failure message={download.error} lines={download.ytdlp} />
      </div>
    </>
  );
}

/**
 * The Ctrl+K palette (and the phone's search button): one field that searches the library as it
 * is typed in. Words also offer a YouTube search whose results download from the list; a pasted
 * link shows the video if the library has it, and otherwise offers to download it, at once or
 * after choosing a format in the Download a link dialog (`onChooseFormat`).
 */
export function SearchPalette({
  open,
  onOpenChange,
  onChooseFormat,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChooseFormat: (url: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-4 w-[min(40rem,calc(100vw-2rem))] translate-y-0 gap-0 overflow-hidden p-0 md:top-[12dvh]">
        <DialogTitle className="sr-only">Search or download</DialogTitle>
        <DialogDescription className="sr-only">
          Type to search your library, or paste a link to download it.
        </DialogDescription>
        <Palette
          onClose={() => {
            onOpenChange(false);
          }}
          onChooseFormat={onChooseFormat}
        />
      </DialogContent>
    </Dialog>
  );
}
