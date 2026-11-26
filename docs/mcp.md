# The MCP server

Uroboros serves a [Model Context Protocol](https://modelcontextprotocol.io) server at `/api/mcp`, so
an AI tool (Claude Code, Cursor, VS Code and other clients that send a bearer token) can search a
person's library, read transcripts, save videos, curate playlists and manage subscriptions, acting
as that person. Djinn has an MCP client but no server, so this design is Uroboros's own; it sits on
the API tokens Uroboros took from Djinn (docs/auth.md).

## Turning it on

The server is on unless the deployment sets `UROBOROS_MCP_ENABLED=false` (`config.ts`). Each
replica reads it when it starts, so set it the same on every replica and restart them to change it;
there is no switch in the app. It still reaches nobody until a person makes a token for MCP. Off, `/api/mcp` answers 404 "the MCP server is off", which stops
every MCP token, and no token can be made for MCP (409). Turning it back on restores the tokens that
already exist.

## Tokens for MCP

A person makes a token under **Settings › Tokens** (New token opens a dialog) and ticks **MCP**
among its access (docs/auth.md has the scopes). The box is greyed out while the server is off, and the server refuses such a token
then (409). A token can hold both scopes, and **Read-only** limits it to the tools that change
nothing. After making an MCP token the dialog shows its secret once, the server's address
(`UROBOROS_PUBLIC_BASE_URL` + `/api/mcp`, or the page's own origin) and a command for Claude Code:

```sh
claude mcp add --transport http uroboros https://tube.example/api/mcp \
  --header "Authorization: Bearer <token>"
```

Cursor (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "uroboros": {
      "url": "https://tube.example/api/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

VS Code (`.vscode/mcp.json`, asking for the token rather than storing it):

```json
{
  "inputs": [{ "id": "uroboros-token", "type": "promptString", "password": true }],
  "servers": {
    "uroboros": {
      "type": "http",
      "url": "https://tube.example/api/mcp",
      "headers": { "Authorization": "Bearer ${input:uroboros-token}" }
    }
  }
}
```

There is no OAuth, so connectors that only sign in through OAuth (the Claude apps' remote
connectors) cannot use it yet. A client that probes for an OAuth server after a 401 gets a JSON
404 at `/.well-known/*` rather than the web app's page, and the 401 itself carries
`WWW-Authenticate: Bearer`.

## How it is served

`src/mcp/route.ts` mounts `@modelcontextprotocol/server` (the v2 SDK, pinned) on `MCP_PATH` as a
plain Hono route, outside the OpenAPI document. The usual gates come first: the readiness gate
(503 while the replica starts), the 64 KiB body limit (413) and the guard, which lets only a token
with the `mcp` scope through, never the session cookie. Then:

- **Stateless.** Every request gets a fresh `McpServer` with no session, so any replica answers any
  request and nothing needs sticky routing. 2026-07-28 clients go to the SDK's `createMcpHandler`
  (`legacy: "reject"`, `responseMode: "json"`); 2025-era clients (told apart by `isLegacyRequest`)
  go to a stateless `WebStandardStreamableHTTPServerTransport` with JSON responses, so both get
  one plain JSON answer, and a GET or DELETE (a 2025 session's stream or end) answers 405. The
  server declares its tool list fixed (`tools.listChanged: false`), so a 2026-07-28 client's
  `subscriptions/listen` is acknowledged and closed at once rather than held open as an event
  stream. No reply is a stream, so shutdown's drain needs nothing new.
- **The caller** travels to the per-request server as the SDK's `authInfo` (`src/mcp/caller.ts`):
  the token's owner, the token, and whether it is read-only.
- **A member's reach.** The tools run as the token's owner with the role `member`, whatever their
  real role: an admin's token cannot cancel someone else's download here, though over REST it keeps
  the admin's reach outside `/api/admin`.
- **Read-only.** A read-only token is offered only the reading tools in `tools/list`, and a call to
  any other is refused (`src/mcp/tool.ts` checks again at call time).
- **Results.** A tool returns structured content (its output schema is in the contract,
  `packages/contract/src/mcp.ts`, with every input schema) and the same as JSON text. A refusal the
  REST API would answer with an error is the tool's own error, worded `code: message`
  (`not_found: no such library entry`); anything unexpected is logged and reported without its
  details. Links in results (thumbnails and the like) are paths on the Uroboros server, which a
  token reaches only with the `api` scope too.

The tools call the same service functions as the REST routes, so permissions match:
`visibleEntry` for what a person may see, owner checks for what they may change.

## The tools

| Tool                      | Reads or writes | What it does                                                                                                                                                                   |
| ------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `search_library`          | reads           | Search (`q`, with where a match is: chapter, description or captions, and the second it starts) or list by channel, playlist, tag, watched, kind (video or audio), sort; paged |
| `get_entry`               | reads           | One video: description, chapters, subtitle tracks, tags, progress                                                                                                              |
| `read_transcript`         | reads           | A video's caption lines with their start times, from the captions indexed for search; paged by `fromSeconds`                                                                   |
| `list_channels`           | reads           | The library's channels and their keys                                                                                                                                          |
| `list_playlists`          | reads           | The person's playlists and the YouTube playlists they queued                                                                                                                   |
| `get_playlist`            | reads           | One playlist and a page of its videos in order                                                                                                                                 |
| `list_downloads`          | reads           | The person's downloads, active first                                                                                                                                           |
| `get_download_request`    | reads           | A link or search being read; `waitSeconds` (up to 15) waits for it to leave `probing`                                                                                          |
| `list_profiles`           | reads           | The format profiles the person may use                                                                                                                                         |
| `list_subscriptions`      | reads           | The channels and playlists the person follows                                                                                                                                  |
| `list_subscription_items` | reads           | A subscription's recent activity; paged                                                                                                                                        |
| `download_link`           | writes          | Save a video from a link (a playlist or channel link is previewed for `queue_selection`); https:// is assumed when it has no scheme                                            |
| `search_youtube`          | writes          | List YouTube's top results for a search, to save with `queue_selection`                                                                                                        |
| `queue_selection`         | writes          | Download picked entries of a preview or search                                                                                                                                 |
| `cancel_download`         | writes          | Cancel a queued or running download                                                                                                                                            |
| `retry_download`          | writes          | Queue a failed or cancelled download again                                                                                                                                     |
| `confirm_download`        | writes          | Let a download held for its size (its `sizeHold`) go ahead                                                                                                                     |
| `create_playlist`         | writes          | Make a playlist, optionally with videos                                                                                                                                        |
| `add_to_playlist`         | writes          | Add videos to the end of a playlist                                                                                                                                            |
| `remove_from_playlist`    | writes          | Take a video out of a playlist                                                                                                                                                 |
| `update_entry`            | writes          | Replace tags, mark watched or not, keep from clean-up                                                                                                                          |
| `preview_subscription`    | writes          | Read a channel or playlist link for subscribing                                                                                                                                |
| `create_subscription`     | writes          | Follow a previewed channel or playlist                                                                                                                                         |
| `update_subscription`     | writes          | Change one (`enabled: false` pauses it)                                                                                                                                        |
| `delete_subscription`     | writes          | Unsubscribe; downloads not started are cancelled                                                                                                                               |
| `check_subscription_now`  | writes          | Look for new videos now                                                                                                                                                        |

Saving from a search takes three calls: `search_youtube`, `get_download_request` with `waitSeconds`
until it is `choosing`, then `queue_selection` with the picked entry ids. `get_download_request`
polls the request's row every 500 ms and stops early when the client cancels the call.

## Left for later

OAuth (for clients that only sign in that way), per-tool or per-playlist scopes, resources and
prompts, and change notifications to clients (`subscriptions/listen`).
