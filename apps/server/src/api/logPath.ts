/**
 * A request's path as the log records it: a public link's code (`/s/<code>`, `/api/public/s/<code>`)
 * and a save link's token (`/api/public/saves/<token>`) are the only secrets behind them, so anyone
 * reading the logs could open every link visited or save every file saved.
 */
export const loggedPath = (path: string): string =>
  path
    .replace(/^((?:\/api\/public)?\/s\/)[^/]+/, "$1…")
    .replace(/^(\/api\/public\/saves\/)[^/]+/, "$1…");
