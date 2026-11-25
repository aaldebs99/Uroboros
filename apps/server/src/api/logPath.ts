/**
 * A request's path as the log records it: a public link's code (`/s/<code>`, `/api/public/s/<code>`)
 * is the only secret behind that link, so anyone reading the logs could open every link visited.
 */
export const loggedPath = (path: string): string =>
  path.replace(/^((?:\/api\/public)?\/s\/)[^/]+/, "$1…");
