import { ChevronDown } from "lucide-react";
import { type ReactNode, useId } from "react";
import type * as React from "react";

import { cn } from "@/lib/utils";

type FieldChrome = {
  label: string;
  /** Muted help under the box. */
  help?: ReactNode | undefined;
  /** The error under the help; turns the box and label danger. */
  error?: string | null | undefined;
  /** An `n/max` counter at the right under the box. */
  counter?: string | undefined;
  /** Technical values (templates, paths, format selectors). */
  mono?: boolean | undefined;
  className?: string | undefined;
};

const boxClasses =
  "peer w-full rounded-[8px] border border-foreground/25 bg-transparent px-3.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/45 disabled:opacity-45 aria-invalid:border-destructive";
const labelClasses =
  "pointer-events-none absolute top-2 left-3.5 text-xs text-muted-foreground peer-focus-visible:text-primary peer-aria-invalid:text-destructive";

function useFieldIds(id: string | undefined, chrome: FieldChrome) {
  const generated = useId();
  const fieldId = id ?? generated;
  const helpId = chrome.help === undefined ? undefined : `${fieldId}-help`;
  const errorId = chrome.error ? `${fieldId}-err` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;
  return { fieldId, helpId, errorId, describedBy };
}

function FieldFoot({
  chrome,
  helpId,
  errorId,
}: {
  chrome: FieldChrome;
  helpId: string | undefined;
  errorId: string | undefined;
}) {
  return (
    <>
      {chrome.help === undefined && chrome.counter === undefined ? null : (
        <div className="flex justify-between gap-3 px-0.5 text-xs text-muted-foreground">
          <span id={helpId}>{chrome.help}</span>
          {chrome.counter === undefined ? null : (
            <span className="tabular-nums">{chrome.counter}</span>
          )}
        </div>
      )}
      {chrome.error ? (
        <p id={errorId} role="alert" className="px-0.5 text-xs text-destructive">
          {chrome.error}
        </p>
      ) : null}
    </>
  );
}

/** The outlined text field: a 56px box with its label inside at the top left. */
function Field({
  label,
  help,
  error,
  counter,
  mono,
  className,
  id,
  ...input
}: FieldChrome & Omit<React.ComponentProps<"input">, "className">) {
  const chrome = { label, help, error, counter, mono };
  const { fieldId, helpId, errorId, describedBy } = useFieldIds(id, chrome);
  return (
    <div className={cn("grid gap-1", className)}>
      <div className="relative">
        <input
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(boxClasses, "h-14 pt-4", mono && "font-mono")}
          {...input}
        />
        <label htmlFor={fieldId} className={labelClasses}>
          {label}
        </label>
      </div>
      <FieldFoot chrome={chrome} helpId={helpId} errorId={errorId} />
    </div>
  );
}

/** The outlined field for longer text: the same box, growing with its rows. */
function TextareaField({
  label,
  help,
  error,
  counter,
  mono,
  className,
  id,
  ...textarea
}: FieldChrome & Omit<React.ComponentProps<"textarea">, "className">) {
  const chrome = { label, help, error, counter, mono };
  const { fieldId, helpId, errorId, describedBy } = useFieldIds(id, chrome);
  return (
    <div className={cn("grid gap-1", className)}>
      <div className="relative">
        <textarea
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(boxClasses, "min-h-24 pt-7 pb-2", mono && "font-mono")}
          {...textarea}
        />
        <label htmlFor={fieldId} className={labelClasses}>
          {label}
        </label>
      </div>
      <FieldFoot chrome={chrome} helpId={helpId} errorId={errorId} />
    </div>
  );
}

/** A native select in the outlined field's box, with its label inside. */
function SelectField({
  label,
  help,
  error,
  className,
  id,
  ...select
}: Omit<FieldChrome, "counter" | "mono"> & Omit<React.ComponentProps<"select">, "className">) {
  const chrome = { label, help, error };
  const { fieldId, helpId, errorId, describedBy } = useFieldIds(id, chrome);
  return (
    <div className={cn("grid gap-1", className)}>
      <div className="relative">
        <select
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(boxClasses, "h-14 appearance-none pt-4 pr-9")}
          {...select}
        />
        <label htmlFor={fieldId} className={labelClasses}>
          {label}
        </label>
        <ChevronDown
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
      </div>
      <FieldFoot chrome={chrome} helpId={helpId} errorId={errorId} />
    </div>
  );
}

export { Field, SelectField, TextareaField };
