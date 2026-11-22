/**
 * What a push carries: one JSON object in WebKit's Declarative Web Push shape. Safari 18.4 and
 * later shows it without running the service worker; the worker (`apps/web/src/sw/sw.ts`) reads
 * the same `notification` member everywhere else. Pure, so the api and the worker share it.
 */

/** The magic number that opts a payload into declarative display. */
export const DECLARATIVE_WEB_PUSH = 8030;

/** The title when a caller gives none: Safari refuses a declarative payload without one. */
export const FALLBACK_TITLE = "Uroboros";

/** A notification to show. */
export interface Notice {
  title: string;
  body?: string;
  /** The absolute URL a tap opens; the worker keeps a tap on the app's own origin. */
  navigate: string;
  /** Replaces an earlier notification with the same tag. */
  tag?: string;
}

export interface Payload {
  web_push: typeof DECLARATIVE_WEB_PUSH;
  notification: Notice;
}

function text(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
}

/** The payload for `notice`, with an empty body or tag left out and a title always present. */
export function buildPayload(notice: Notice): Payload {
  const body = text(notice.body);
  const tag = text(notice.tag);
  return {
    web_push: DECLARATIVE_WEB_PUSH,
    notification: {
      title: text(notice.title) ?? FALLBACK_TITLE,
      ...(body === undefined ? {} : { body }),
      navigate: notice.navigate,
      ...(tag === undefined ? {} : { tag }),
    },
  };
}

/** The JSON text to encrypt. */
export function encodePayload(payload: Payload): string {
  return JSON.stringify(payload);
}
