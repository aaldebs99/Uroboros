/**
 * What a push from Uroboros says. The server sends WebKit's Declarative Web Push shape
 * (`{ web_push: 8030, notification: {...} }`, `apps/server/src/push/payload.ts`), which Safari
 * 18.4 and later shows by itself and the service worker reads everywhere else. Pure, so the worker
 * and the tests share it; it runs in the worker, so it uses nothing from the DOM.
 */

/** The notification to show. */
export interface PushNotice {
  title: string;
  body: string;
  /** The absolute URL a tap opens. */
  navigate: string;
  tag?: string;
}

const FALLBACK_TITLE = "Uroboros";

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function fieldsOf(data: unknown): Record<string, unknown> {
  if (typeof data !== "object" || data === null || !("notification" in data)) return {};
  const { notification } = data;
  return typeof notification === "object" && notification !== null
    ? (notification as Record<string, unknown>)
    : {};
}

/**
 * The notice in `data` (the push's parsed JSON), else a plain one: every push must show
 * something, or the browser stops delivering them.
 */
export function noticeOf(data: unknown, origin: string): PushNotice {
  const fields = fieldsOf(data);
  const tag = text(fields["tag"]);
  return {
    title: text(fields["title"]) ?? FALLBACK_TITLE,
    body: text(fields["body"]) ?? "",
    navigate: text(fields["navigate"]) ?? `${origin}/`,
    ...(tag === undefined ? {} : { tag }),
  };
}

/**
 * Where a tap goes within the app: the notice's path when its URL is on this origin, else the
 * start page, so a push can never send the app elsewhere.
 */
export function targetOf(navigate: string, origin: string): string {
  try {
    const url = new URL(navigate, origin);
    return url.origin === origin ? url.pathname + url.search + url.hash : "/";
  } catch {
    return "/";
  }
}
