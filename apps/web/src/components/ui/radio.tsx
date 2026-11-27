/**
 * One choice of a radio group (a `fieldset` with its `legend`): a row a finger can take, the native
 * radio in the accent, its label, and a line of help under it when it has one.
 */
export function RadioChoice({
  name,
  label,
  help,
  checked,
  onPick,
}: {
  name: string;
  label: string;
  help?: string;
  checked: boolean;
  onPick: () => void;
}) {
  return (
    <label
      className={`flex min-h-11 gap-3 ${help === undefined ? "items-center" : "items-start py-1.5"}`}
    >
      <input
        type="radio"
        name={name}
        className={`size-4.5 shrink-0 accent-primary ${help === undefined ? "" : "mt-0.5"}`}
        checked={checked}
        onChange={onPick}
      />
      {help === undefined ? (
        label
      ) : (
        <span className="grid gap-0.5">
          <span>{label}</span>
          <span className="text-xs text-muted-foreground">{help}</span>
        </span>
      )}
    </label>
  );
}
