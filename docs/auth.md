# Sign-in and accounts

Uroboros is multi-user and every page needs a signed-in user. People sign in through the
deployment's OIDC provider (Authentik, normally) or with a local account an admin made for them in
the web app. The design is a port of Djinn's authentication
(`/PM9A3/.repos/Djinn/docs/design/authentication.md`, `identity.md`, `api-tokens.md`,
`oidc-claims-sync.md`), with the differences called out below.

## Accounts

One `users` table. An account is either **local** (a username and an argon2id password hash) or
**SSO** (an OIDC issuer and subject), never both, so "reset password" and "role from the provider's
groups" always mean one thing. Djinn allows both on one row; Uroboros does not.

Roles are `admin` and `member`. An SSO user's role is derived from the groups claim at every
sign-in and by the claims sync: membership in any of `UROBOROS_OIDC_ADMIN_GROUPS` (default
`authentik Admins`) makes them an admin. Admins cannot override an SSO user's role. A local user's
role is set by an admin. Admission is the provider's job: anyone the provider lets through gets an
account on first sign-in (just-in-time), as in Djinn.

Local accounts are created, renamed, given a role, disabled, re-enabled, reset and deleted in
Admin › Users. SSO accounts can be disabled but not deleted: deleting one would only bring it back
at the next sign-in. Nobody can disable, delete or change the role of themselves, and the
bootstrap admin can be neither disabled nor deleted. There is no account CLI.

The **bootstrap admin** (`UROBOROS_BOOTSTRAP_USERNAME` and `_PASSWORD`, both or neither) is
created on the first start and re-seeded on every start: its username, password and admin role are
put back if they changed, and the password is re-hashed only when it no longer verifies. With no
flagged account, an existing local account of that name is adopted. Replicas starting together
are fine. This is how a fresh install gets its first admin. The password must be at least 12
characters unless `UROBOROS_ALLOW_WEAK_BOOTSTRAP_PASSWORD` is true, which the compose dev stack
sets for its `admin` / `admin` account (the api logs a warning); never in production.

## Signing in

**Local**: `POST /api/auth/local/login {username, password}` answers 204 with the cookies. A wrong
password and an unknown username answer the same 401, in about the same time (an unknown name is
verified against a dummy hash). Attempts are counted in **Valkey**, so the limit holds across
replicas (Djinn counts per process): 5 failures per username and 30 per client IP within 15
minutes, then 429. Each attempt is counted before the password is checked, in one transaction, so
a burst of parallel guesses cannot all slip past the check; a good sign-in takes its attempt back
off and clears the username's count. The client IP is the last `X-Forwarded-For` entry (the one
the proxy in front added; entries to its left came from the client) only when
`UROBOROS_TRUST_PROXY` is true (compose sets it, since the replicas sit behind Caddy). A disabled account answers 403, only after the right password.

**OIDC** uses `openid-client` (Djinn hand-rolled its client in Rust). Discovery runs in the
background with 1–60 s backoff; until it succeeds the sign-in button is disabled and says the
provider is not reachable yet. Providers that do not advertise PKCE S256 are refused.
`GET /api/auth/oidc/login` stores a pending sign-in (SHA-256 of the state and of a browser-binding
secret, the nonce and the PKCE verifier; 10 minutes) and sets the binding cookie `uroboros_oidc`
(`Path=/api/auth/oidc`, `HttpOnly`, `SameSite=Lax`). The callback consumes the pending row once,
compares the binding in constant time, exchanges the code with `client_secret_basic`, and checks
the ID token: issuer, audience, expiry (30 s leeway), nonce, and its **signature against the
provider's JWKS** (openid-client's non-repudiation checks are on; by default it skips signatures on
token-endpoint responses). Failures send the browser to
`/?auth_error=expired|cancelled|unavailable|failed|disabled`, which the sign-in page explains. The
return path is same-origin only.

Signing out deletes the session; an SSO user's browser then goes to the provider's end-session
URL (`client_id` and `post_logout_redirect_uri`; there is no `id_token_hint`, because the ID token
is not stored).

## Sessions and CSRF

A session is a random 32-byte token in the `uroboros_session` cookie (`HttpOnly`,
`SameSite=Strict`, `Path=/`, `Secure` when the public URL is https); only its SHA-256 is stored, in
Postgres, so any replica can resolve it. Lifetime is fixed at `UROBOROS_SESSION_TTL_HOURS` (720),
with no sliding expiry. `last_seen_at` is written at most once a minute. Every non-GET request that
uses the cookie must send `X-Uroboros-CSRF` equal to the readable `uroboros_csrf` cookie and to the
session's stored value, or it gets 403. Disabling or revoking a user stops their sessions and
tokens on the next request. The leader deletes expired sessions and pending sign-ins hourly.

People see their signed-in browsers on the Account page and can sign out one, or all but this one.
Changing your password signs out your other sessions; an admin resetting it signs you out
everywhere.

## API tokens

`/api/me/tokens` creates (the secret is shown once), lists and revokes personal tokens: 64 hex
characters sent as `Authorization: Bearer …`, SHA-256 at rest, at most 20 per user, names unique per
user, no scopes and no expiry (Djinn's choices). A token acts as its owner except on
`/api/admin/*`, `/api/me/tokens*`, `/api/me/password`, `/api/me/sessions*` and `/api/me/push*`,
which answer 403 "an API token cannot be used here; sign in in the browser": a leaked token must not
mint successors, act as an admin, change the password or move someone's notifications. Token
requests need no CSRF header.

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
email, self-registration, several OIDC providers, token scopes and expiry, sliding sessions, a
Host/Origin allowlist and `__Host-` cookies.
