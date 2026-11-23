import { useState } from "react";

import { Field, SelectField } from "@/components/ui/field";

import {
  EXPIRY_CHOICES,
  EXPIRY_LABELS,
  expiresAtFor,
  expiryText,
  type ExpiryChoice,
} from "./expiry";

/**
 * When a share stops working: its current expiry (if any), Never, a day, a week, a month, or a
 * chosen date. Each choice calls `onChange` with the new ISO expiry (null: never).
 */
export function ExpirySelect({
  label,
  expiresAt,
  expired,
  disabled,
  onChange,
}: {
  label: string;
  expiresAt: string | null;
  expired: boolean;
  disabled?: boolean;
  onChange: (expiresAt: string | null) => void;
}) {
  const [picking, setPicking] = useState(false);
  const current = expiryText(expiresAt, expired);
  const value = picking ? "date" : current === null ? "never" : "current";
  return (
    <div className="grid gap-2">
      <SelectField
        label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const choice = e.target.value;
          if (choice === "current") return;
          if (choice === "date") {
            setPicking(true);
            return;
          }
          setPicking(false);
          onChange(expiresAtFor(choice as ExpiryChoice));
        }}
      >
        {current === null ? null : <option value="current">{current}</option>}
        {EXPIRY_CHOICES.map((c) => (
          <option key={c} value={c}>
            {EXPIRY_LABELS[c]}
          </option>
        ))}
      </SelectField>
      {picking ? (
        <Field
          label="Expires on"
          type="date"
          disabled={disabled}
          min={new Date().toISOString().slice(0, 10)}
          onChange={(e) => {
            const at = expiresAtFor("date", e.target.value);
            if (at !== null) {
              setPicking(false);
              onChange(at);
            }
          }}
        />
      ) : null}
    </div>
  );
}
