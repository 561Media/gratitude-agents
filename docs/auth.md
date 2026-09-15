# Portal authentication (Clerk)

Last updated: 2026-09-15 (branch `phase0-clerk-auth`). Covers review findings P0.4, P0.5 (login part) and P1.1 (identity part) from `2026-09-15-codex-enterprise-readiness-review.md`.

## How it works

**Clerk proves who someone is. The portal `users` table decides what they may do.**

- Sign-in is an emailed 6-digit code (`/sign-in`, a custom server-rendered form, not Clerk's `<SignIn />`). No passwords, no social login.
- Sign-up is invitation-only. Admins invite from `/admin`; the invitation link lands on `/sign-in` with a ticket that creates the Clerk account.
- On every protected request `lib/auth.ts` resolves the Clerk session to a `users` row:
  1. by `users.clerk_user_id`;
  2. on first sign-in only, by the Clerk user's **verified** primary email, then binds `clerk_user_id` (conditional update, never overwrites an existing binding).
- The row must be `active`. `role` (admin, employee, partner) is read from the row on that request. Roles are never taken from JWT claims, so a disable or role change takes effect on the next request even though the Clerk session token is still valid.
- `getSession()`, `requireSession()`, `requireAdmin()` and `SessionUser { userId, email, name, role }` keep their pre-Clerk names and shape. `userId` is still the portal uuid used in ownership columns. New fields: `clerkUserId`, `secondFactorVerified`.
- API routes get `401` JSON from middleware when signed out (never an HTML redirect). Signed in to Clerk but no active portal account: `/api/session` returns `403`, and the UI sends the person to `/no-access`.

### Revocation (P0.4)

`PATCH /api/admin/users` and `DELETE /api/admin/users` write the database first (this alone blocks the user on the next request), then call Clerk:

| Admin action | Database | Clerk |
|---|---|---|
| Disable | `active = false` | revoke all active sessions, ban user (blocks new sign-ins) |
| Enable | `active = true` | unban |
| Role change | `role = ...` | revoke all active sessions, sync Gratitude org role |
| Remove | `active = false`, `clerk_user_id = null` (row kept, it owns conversations and files) | revoke sessions, delete Clerk user |
| Revoke invitation | unaccepted row set inactive | revoke invitation |

If a Clerk call fails the API still returns success with a `warning`, because the database block already holds. Guard rails: an admin cannot disable, demote or remove themselves, and the last active admin cannot be removed.

The old bootstrap (`PORTAL_BOOTSTRAP_USERS_JSON` / `APP_PASSWORD_HASH` upsert that re-activated users and reset passwords on every cold start) is deleted. First-admin provisioning is a one-time flag on the migration script.

### Admin MFA

The instance offers authenticator apps (TOTP) and backup codes. Clerk can only require MFA for everyone, so admin enforcement is in the app: `requireAdmin()` returns `403 { code: "mfa_required" }` unless the session's `factorVerificationAge` shows a completed second factor. Admins enrol at `/account` (Clerk `<UserProfile />`, Security tab), then sign out and back in. `ADMIN_MFA_REQUIRED=0` turns the check off (local testing only).

### Workspace organization

Organizations are enabled with one "Gratitude" organization (`CLERK_ORGANIZATION_ID`). Members are mirrored on first sign-in and on role change: admin maps to `org:admin`, everyone else to `org:member`. The mirror is best effort and is not used for authorization; it keeps the workspace model ready for multi-tenant later (P1.1).

## Clerk application

- App: **Gratitude X 561 Media**, `app_3JN86vuRC7ZpS5OhpLvW5VMJ0CS`
- Development instance: `ins_3JN86uknQlCIeRpuLUQ2cUDqJQR` (configured 2026-09-15)
- Development org "Gratitude": `org_3JN928qUwrVdQhQWj8q053KoxKE`
- Production instance: **not created yet** (needs DNS on gratitude.com, see cutover).

### Instance settings (applied to dev 2026-09-15, apply the same to prod)

| Setting | Value |
|---|---|
| Email sign-in strategies | `email_code` only; email required and verified at sign-up |
| Password | disabled |
| Google and all other social | disabled |
| Passkeys | not a sign-in method, button hidden |
| Sign-up mode | `restricted` (invitation only) |
| Disposable email domains | blocked |
| MFA | authenticator app on, backup codes on, not required instance-wide (admins enforced in app) |
| Session inactivity timeout | 12 hours (43200 s) |
| Session maximum lifetime | 7 days (604800 s) |
| Multi-session | off |
| Organizations | on, personal accounts allowed (`force_organization_selection: false`), admin delete off, auto-create off |

The config patch lives in the CLI history; to reproduce on prod:

```sh
clerk config pull --app app_3JN86vuRC7ZpS5OhpLvW5VMJ0CS --instance dev > dev.json   # compare
clerk config patch --app app_3JN86vuRC7ZpS5OhpLvW5VMJ0CS --instance prod --file patch.json --dry-run
clerk config patch --app app_3JN86vuRC7ZpS5OhpLvW5VMJ0CS --instance prod --file patch.json --yes
```

## Login abuse (P0.5, sign-in part)

The custom login endpoint is gone, so there is no application login surface to rate limit. Clerk provides, as configured on dev:

- Bot protection: Cloudflare Turnstile, "smart" widget (mounted in `#clerk-captcha` on the form).
- Account lockout after 10 failed attempts, for 60 minutes.
- Email enumeration protection.
- Rate limits and short expiry on email verification codes (Clerk-managed).
- Invitation-only sign-up plus disposable-domain blocking.

Still open elsewhere in P0.5 and not part of this branch: per-user quotas and concurrency caps on chat, image generation, exports and uploads.

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | all | Clerk publishable key (`pk_test_` dev, `pk_live_` prod) |
| `CLERK_SECRET_KEY` | all | Clerk secret key. Server only. Never commit. |
| `CLERK_DISABLE_AUTO_PROXY` | Vercel: set `1` | House rule. Clerk v7 auto-proxies FAPI through `/__clerk` when it thinks the host is `*.vercel.app`; client and middleware decide separately and break sign-in on custom domains. Leave `1` unless `agents.gratitude.com` is registered as the Vercel project production domain and you have verified the proxy. |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | all | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | all | `/sign-in` (invitations land on the sign-in page) |
| `CLERK_ORGANIZATION_ID` | all | the Gratitude org id for the instance (dev and prod differ) |
| `APP_URL` | prod | `https://agents.gratitude.com`, used for invitation links |
| `ADMIN_MFA_REQUIRED` | optional | default on; `0` disables the admin second-factor check |
| `NEON_LOCAL_HTTP_ENDPOINT` | local only | point the Neon driver at a local proxy; ignored in production |

Remove after cutover is confirmed: `JWT_SECRET`, `APP_PASSWORD_HASH`, `PORTAL_BOOTSTRAP_USERS_JSON`, `PORTAL_ADMIN_EMAIL`, `PORTAL_ADMIN_NAME`. Keep `JWT_SECRET` until the rollback window has passed.

## Local development

```sh
clerk env pull --app app_3JN86vuRC7ZpS5OhpLvW5VMJ0CS --instance dev --file .env.development.local
```

Never write Clerk dev keys into `.env.local`; in the main checkout that file holds production values. Add the non-secret settings above to `.env.development.local`.

Do not point local runs at the production Neon database. A throwaway database:

```sh
docker network create gratitude-authtest
docker run -d --name gratitude-authtest-pg --network gratitude-authtest \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=main -p 55432:5432 pgvector/pgvector:pg16
docker run -d --name gratitude-authtest-proxy --network gratitude-authtest \
  -e PG_CONNECTION_STRING=postgres://postgres:postgres@gratitude-authtest-pg:5432/main \
  -p 4444:4444 ghcr.io/timowilhelm/local-neon-http-proxy:main
# .env.development.local
#   DATABASE_URL=postgres://postgres:postgres@db.localtest.me:5432/main
#   NEON_LOCAL_HTTP_ENDPOINT=http://localhost:4444/sql
```

Create the schema with `drizzle-kit export` piped into `psql` in the container (after `create extension vector`), then provision a first admin with `node --env-file=.env.development.local scripts/migrate-users-to-clerk.mjs --create-admin=you+clerk_test@example.com --name="You" --apply --confirm-db-host=db.localtest.me`.

Clerk test mode (dev instance only): any address containing `+clerk_test` receives no email and accepts code `424242`.

Tests: `npm test` (vitest; session resolution and revocation logic with Clerk mocked).

## Production cutover checklist

Each step needs Michael's approval. Nothing below has been done.

1. **Create the production instance** for app `app_3JN86vuRC7ZpS5OhpLvW5VMJ0CS`. In a terminal (the wizard is interactive): `clerk deploy`. Choose the domain. Recommended: `gratitude.com` as the application domain with the portal at `agents.gratitude.com`.
2. **DNS on gratitude.com.** Clerk lists the exact records on the Domains page and in `clerk deploy`. Copy them from there; do not type them from this doc. The usual set for a Clerk production instance is five CNAMEs:
   - `clerk.<domain>` to `frontend-api.clerk.services` (Frontend API)
   - `accounts.<domain>` to `accounts.clerk.services` (Account Portal)
   - `clkmail.<domain>` to `mail.<id>.clerk.services` (email sending)
   - `clk._domainkey.<domain>` and `clk2._domainkey.<domain>` to Clerk DKIM hosts
   Before adding anything, GET the current gratitude.com records and check for conflicts (existing `clerk`, `accounts` or DKIM names). If gratitude.com sits behind Cloudflare, set these records to DNS only (no proxy).
3. **Verify:** `clerk deploy status --mode agent --wait` must exit 0 (DNS and SSL complete).
4. **Apply the instance settings** from the table above to prod (`clerk config patch --instance prod --dry-run`, then `--yes`). Confirm with `clerk config pull --instance prod`.
5. **Create the prod "Gratitude" organization** (`clerk api /organizations -X POST -d '{"name":"Gratitude"}' --instance prod --dry-run`, then `--yes`) and note its id.
6. **Vercel project settings:** register `agents.gratitude.com` as the project's production domain (not a bare `vercel alias`), and set production env: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` from `clerk env pull --instance prod --file <scratch file>`, `CLERK_DISABLE_AUTO_PROXY=1`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-in`, `CLERK_ORGANIZATION_ID=<prod org>`, `APP_URL=https://agents.gratitude.com`.
7. **Database:** take a Neon branch or backup, then apply `db/migrations/0002_clerk_identity.sql` to production (idempotent; adds nullable `clerk_user_id`, makes `password_hash` nullable). Do not use `drizzle-kit migrate`: production was built with `push` and has no migration history table.
8. **Dry run the user migration** against production: `node --env-file=<prod env file> scripts/migrate-users-to-clerk.mjs`. Read the table.
9. **Apply it:** `... --apply --confirm-db-host=<neon host>` (default `--mode=users` creates Clerk users silently; use `--mode=invitations` to email everyone instead).
10. **Admins enrol MFA** at `/account` on the deployed site, sign out, sign back in.
11. **Deploy** the branch to production after merge and smoke test: sign in with an emailed code, `/api/session` returns the right role, `/api/conversations` returns `401` JSON when signed out, disable a test user and confirm their next request fails, check the clerk-js script `src` on `/sign-in` is `https://clerk.<domain>/...` and not `/__clerk/...`.
12. After a stable week: remove the retired env vars and drop `users.password_hash`.

## Rollback

- **App:** promote the previous Vercel production deployment (instant rollback). It uses `JWT_SECRET` and `password_hash`, so keep both until the rollback window closes.
- **Database:** migration 0002 is backward compatible. The old code ignores `clerk_user_id`, and existing password hashes are untouched. Only people invited after cutover (no password) cannot use the old login.
- **Clerk:** the production instance can stay; nothing in the old app talks to it. Revoke or delete invitations if needed.
