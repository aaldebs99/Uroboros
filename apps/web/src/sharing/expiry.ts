/** When a share stops working (docs/sharing.md). */
export const EXPIRY_CHOICES = ["never", "day", "week", "month", "date"] as const;
export type ExpiryChoice = (typeof EXPIRY_CHOICES)[number];

export const EXPIRY_LABELS: Record<ExpiryChoice, string> = {
  never: "Never",
  day: "A day",
  week: "A week",
  month: "A month",
  date: "A date",
};

const DAY_MS = 86_400_000;

/**
 * The ISO expiry for a choice, from `now`: null for never; `date` is the end of that day
 * (`YYYY-MM-DD`, local time), or null while none is picked.
 */
export function expiresAtFor(choice: ExpiryChoice, date?: string, now = new Date()): string | null {
  switch (choice) {
    case "never":
      return null;
    case "day":
      return new Date(now.getTime() + DAY_MS).toISOString();
    case "week":
      return new Date(now.getTime() + 7 * DAY_MS).toISOString();
    case "month":
      return new Date(now.getTime() + 30 * DAY_MS).toISOString();
    case "date": {
      if (date === undefined || date === "") return null;
      return new Date(`${date}T23:59:59`).toISOString();
    }
  }
}

/** "Until 1 Dec 2026", or "Expired", for a share's expiry. */
export function expiryText(expiresAt: string | null, expired: boolean): string | null {
  if (expired) return "Expired";
  if (expiresAt === null) return null;
  return `Until ${new Date(expiresAt).toLocaleDateString(undefined, { dateStyle: "medium" })}`;
}
