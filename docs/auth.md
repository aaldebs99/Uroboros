# Sign-in and accounts

Uroboros is multi-user and every page needs a signed-in user. People sign in through the
deployment's OIDC provider (Authentik, normally) or with a local account an admin made for them in
the web app.

## Accounts

One `users` table. An account is either **local** (a username and an argon2id password hash) or
**SSO** (an OIDC issuer and subject), never both, so "reset password" and "role from the provider's
groups" always mean one thing.

Roles are `admin` and `member`. An SSO user's role is derived from the groups claim at every
sign-in and by the claims sync: membership in any of `UROBOROS_OIDC_ADMIN_GROUPS` (default
`authentik Admins`) makes them an admin. Admins cannot override an SSO user's role. A local user's
role is set by an admin. The provider's groups decide only this role: sharing with a group means
one of the groups people make in Uroboros ([sharing.md](sharing.md#groups)). Admission is the provider's job: anyone the provider lets through gets an
account on first sign-in (just-in-time), unless `UROBOROS_OIDC_AUTO_CREATE` is
false: then only existing SSO accounts sign in, and a new identity is sent back with
`auth_error=unregistered` and no account is made. Admitting someone new then means turning it on
while they sign in once; a fresh install with it off and local login off lets nobody in.

Local accounts are created, renamed, given a role, disabled, re-enabled, reset and deleted in
Admin › Users. SSO accounts can be disabled but not deleted: deleting one would only bring it back
at the next sign-in. Nobody can disable, delete or change the role of themselves, and the
bootstrap admin can be neither disabled nor deleted. There is no account CLI.

The **bootstrap admin** (`UROBOROS_BOOTSTRAP_USERNAME` and `_PASSWORD`, both or neither) is
created on the first start and re-seeded on every start: its username, password and admin role are
put back if they changed, and the password is re-hashed only when it no longer verifies. With no
flagged account, an existing local account of that name is adopted. Replicas starting together
are fine. This is how a fresh install without SSO gets its first admin, so without OIDC it is
required: the server refuses to start without it (a fresh install would have no account to sign
in with, and there is no account CLI). With OIDC it is optional, since the provider's groups make
the admins. The password must be at least 12 characters unless
`UROBOROS_ALLOW_WEAK_BOOTSTRAP_PASSWORD` is true (the api logs a warning); never in production.
`compose.yaml` has no default account. The dev overlay, `mise run docker:up` and `mise run
dev:server` pass a dev-only `admin` / `admin` with that opt-out unless the shell sets the pair.

## Signing in

**Local**: `POST /api/auth/local/login {username, password}` answers 204 with the cookies. A wrong
password and an unknown username answer the same 401, in about the same time (an unknown name is
verified against a dummy hash). Attempts are counted in **Postgres** (the unlogged
`signin_failures` table, [jobs.md](jobs.md)), so the limit holds across replicas,
each within 15 minutes, then 429: 5 failures per username from one client IP, 100 per
username from every address together, and 30 per client IP. Counting a username per address means
a stranger's guesses lock only the stranger's address, never the person signing in from their own
(Uroboros used to lock the username itself, so six requests from anyone locked an account out);
the 100 bound a guesser spread over many addresses. An address's attempts count against the
username itself only while the address is under its own two limits, so one address can add at
most 5 there and cannot push an account to its overall limit; an IPv6 client is counted by its
/64 (`limiterAddress`), since one host usually holds a whole block. Each attempt is counted
before the password is checked, in one statement per step, so a burst of parallel guesses cannot
all slip past the check; a good sign-in takes its attempt back off the address and clears the
username's counts. The client IP is the last `X-Forwarded-For` entry (the one
the proxy in front added; entries to its left came from the client) only when
`UROBOROS_TRUST_PROXY` is true (compose sets it, since the replicas sit behind Caddy). A disabled account answers 403, only after the right password.

**OIDC** uses `openid-client`. Discovery runs in the
background with 1–60 s backoff; until it succeeds the sign-in button is disabled and says the
provider is not reachable yet. Providers that do not advertise PKCE S256 are refused.
`GET /api/auth/oidc/login` stores a pending sign-in (SHA-256 of the state and of a browser-binding
secret, the nonce and the PKCE verifier; 10 minutes) and sets the binding cookie `uroboros_oidc`
(`Path=/api/auth/oidc`, `HttpOnly`, `SameSite=Lax`). The callback consumes the pending row once,
compares the binding in constant time, exchanges the code with `client_secret_basic`, and checks
the ID token: issuer, audience, expiry (30 s leeway), nonce, and its **signature against the
provider's JWKS** (openid-client's non-repudiation checks are on; by default it skips signatures on
token-endpoint responses). Failures send the browser to
`/?auth_error=expired|cancelled|unavailable|failed|disabled|unregistered`, which the sign-in page explains. The
return path is same-origin only.

Signing out deletes the session; an SSO user's browser then goes to the provider's end-session
URL (`client_id` and `post_logout_redirect_uri`; there is no `id_token_hint`, because the ID token
is not stored).

## Sessions and CSRF

A session is a random 32-byte token in the `uroboros_session` cookie (`HttpOnly`,
`SameSite=Strict`, `Path=/`, `Secure` when the public URL is https or the sign-in itself came over
https, by its own scheme or a trusted proxy's `X-Forwarded-Proto`); only its SHA-256 is stored, in
Postgres, so any replica can resolve it. Lifetime is fixed at `UROBOROS_SESSION_TTL_HOURS` (720),
with no sliding expiry. `last_seen_at` is written at most once a minute. Every non-GET request that
uses the cookie must send `X-Uroboros-CSRF` equal to the readable `uroboros_csrf` cookie and to the
session's stored value, or it gets 403. Disabling or revoking a user stops their sessions and
tokens on the next request. The leader deletes expired sessions and pending sign-ins hourly.

People see their signed-in browsers on the Account page and can sign out one, or all but this one.
Changing your password signs out your other sessions and keeps your API tokens (the Account page
says so, and points to Settings › Tokens, where they are listed to revoke). An admin resetting
it, or disabling the account, signs you out everywhere and deletes every API token you have, so
nothing made with a stolen session outlives the steps taken after a compromise; re-enabling the
account brings none of it back (`revokeAccess` in `auth/adminUserRoutes.ts`).

## API tokens

`/api/me/tokens` creates (the secret is shown once), lists and revokes personal tokens, which people
manage in Settings › Tokens (New token opens a dialog for the options, then shows the secret): 64 hex
characters sent as `Authorization: Bearer …`, SHA-256 at rest, at most 20 per user, names unique per
user, and no expiry. A token acts as its owner except on
`/api/admin/*`, `/api/me/tokens*`, `/api/me/password`, `/api/me/sessions*`, `/api/me/push*` and
`/api/me/site-logins*`, which answer 403 "an API token cannot be used here; sign in in the
browser": a leaked token must not mint successors, act as an admin, change the password, move
someone's notifications or read and replace their saved site logins. Token requests need no CSRF
header.

Each token carries **scopes**, chosen when it is made (the MCP server needs them, docs/mcp.md):
`api` reaches the REST API, `mcp` the MCP server at
`/api/mcp`, and a token may hold both (the default is `api` alone). The guard checks them after it
has found the token's owner (`checkTokenReach` in `auth/guard.ts`), so a refused request still
counts as the token's use: `/api/mcp` without `mcp` answers 403 "this token cannot use MCP", any
other route without `api` 403 "this token cannot use the REST API". A **read-only** token gets 403
"this token is read-only" on every REST write (anything but GET, HEAD and OPTIONS, so it cannot
start a playback session either), and the MCP server hides and refuses its tools that change
anything. `/api/mcp` takes tokens only, never the session cookie, and its 401 carries
`WWW-Authenticate: Bearer`. A token for MCP can be made only while the MCP server is on
(`UROBOROS_MCP_ENABLED`; 409 otherwise); turning it off later keeps the token but stops it at the
MCP server (404). Over
REST an admin's token keeps the admin's reach outside `/api/admin` (all downloads, for one); the
MCP server always acts as a member.

## Claims sync

Every replica ticks every 60 s (first after 15 s). Each pass takes the `URO_OSYN` advisory lock on a
connection of its own, so only one replica redeems refresh tokens at a time: they rotate and are
single-use, so two replicas redeeming the same one would look like a revocation. A pass recomputes
every SSO user's role from their stored groups (the admin groups may have changed), then redeems
the refresh token of each user whose claims are older than `UROBOROS_OIDC_SYNC_INTERVAL_SECS`
(900) and rewrites their groups, role, name and email. A refused grant (`invalid_grant`) demotes the
user to member, clears their groups, deletes the grant and sets `revoked_at`, which stops their
sessions and tokens; their next real sign-in clears it. An unreachable provider changes nothing.
A rotated refresh token is stored as soon as it is redeemed, and every write is guarded on the
token the pass redeemed still being the stored one, so a sign-in that lands mid-pass is never
revoked by its old token's refusal. A sign-in that brings no refresh token drops the stored one.
One user's failure is logged and the pass moves on, oldest claims first. Admins can force a pass
from Admin › Users, which refreshes every SSO user, due or not, even with the background sync off
(409 while one runs).

## Out of scope

Device-authorization sign-in (with the browser extension), Discord linking, password reset by
email, self-registration, several OIDC providers, token expiry, sliding sessions, a
Host/Origin allowlist and `__Host-` cookies.
