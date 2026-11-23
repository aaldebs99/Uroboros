import { X } from "lucide-react";
import { useState, type SubmitEvent } from "react";

/** The entry's tags as removable chips, and a field to add one. */
export function TagEditor({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [text, setText] = useState("");
  const add = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const tag = text.trim().toLowerCase().slice(0, 32);
    setText("");
    if (tag !== "" && !tags.includes(tag) && tags.length < 20) onChange([...tags, tag]);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((t) => (
        <span
          key={t}
          className="inline-flex h-8 items-center gap-1 rounded-full bg-raised pr-1 pl-3 text-[13px] font-medium"
        >
          {t}
          <button
            type="button"
            aria-label={`Remove tag ${t}`}
            onClick={() => {
              onChange(tags.filter((x) => x !== t));
            }}
            className="grid size-6 place-items-center rounded-full hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/45 focus-visible:outline-none"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </span>
      ))}
      <form onSubmit={add}>
        <input
          aria-label="Add a tag"
          placeholder="Add a tag"
          value={text}
          maxLength={32}
          onChange={(e) => {
            setText(e.target.value);
          }}
          className="h-8 w-32 rounded-full border border-foreground/22 bg-card px-3 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/45"
        />
      </form>
    </div>
  );
}
