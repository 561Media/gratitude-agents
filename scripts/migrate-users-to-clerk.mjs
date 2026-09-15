#!/usr/bin/env node
/**
 * scripts/migrate-users-to-clerk.mjs
 *
 * ONE-TIME production cutover helper for the Clerk migration.
 * DO NOT RUN until docs/auth.md "Production cutover" says to. Michael runs it.
 *
 * Default is a DRY RUN: it reads the users table and Clerk, prints the plan,
 * and writes nothing anywhere. Writes happen only with BOTH:
 *   --apply  and  --confirm-db-host=<the hostname inside DATABASE_URL>
 *
 * For every ACTIVE portal user that has no clerk_user_id yet:
 *   --mode=users (default)  Find or create the Clerk user by email (no password,
 *                           no email is sent), add them to the Gratitude org,
 *                           write clerk_user_id back to the users row. They then
 *                           sign in at /sign-in with an emailed code.
 *   --mode=invitations      Send a Clerk invitation email instead. The app binds
 *                           clerk_user_id on their first sign-in.
 * Active users already bound only get their org membership checked.
 * Disabled users are skipped and listed.
 *
 * Optional, for an empty database only:
 *   --create-admin=<email> --name="Full Name"   insert an active admin row first
 *
 * Other flags: --only=<email> to process a single user.
 *
 * Env: DATABASE_URL, CLERK_SECRET_KEY, CLERK_ORGANIZATION_ID (recommended),
 *      APP_URL (required for --mode=invitations, e.g. https://agents.gratitude.com)
 *
 * Usage:
 *   node --env-file=.env.cutover scripts/migrate-users-to-clerk.mjs
 *   node --env-file=.env.cutover scripts/migrate-users-to-clerk.mjs --apply --confirm-db-host=ep-example.us-east-1.aws.neon.tech
 */
import { neon, neonConfig } from "@neondatabase/serverless";

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, ...rest] = arg.slice(2).split("=");
    out[key] = rest.length ? rest.join("=") : true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const apply = args.apply === true;
const mode = args.mode || "users";
const only = typeof args.only === "string" ? args.only.trim().toLowerCase() : null;

function fail(message) {
  console.error(`\nERROR: ${message}\n`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
const secretKey = process.env.CLERK_SECRET_KEY;
const orgId = process.env.CLERK_ORGANIZATION_ID || null;
const appUrl = process.env.APP_URL || null;

if (!databaseUrl) fail("DATABASE_URL is not set");
if (!secretKey) fail("CLERK_SECRET_KEY is not set");
if (!["users", "invitations"].includes(mode)) fail("--mode must be users or invitations");
if (mode === "invitations" && !appUrl) fail("APP_URL is required for --mode=invitations");

// Local development only (see docs/auth.md): talk to a local Neon HTTP proxy.
if (process.env.NEON_LOCAL_HTTP_ENDPOINT) {
  neonConfig.fetchEndpoint = process.env.NEON_LOCAL_HTTP_ENDPOINT;
}

const dbHost = new URL(databaseUrl).hostname;
if (apply && args["confirm-db-host"] !== dbHost) {
  fail(`--apply needs --confirm-db-host=${dbHost} (the host in DATABASE_URL). Refusing to write.`);
}

const sql = neon(databaseUrl);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function clerk(path, { method = "GET", body } = {}) {
  await sleep(120); // stay well under Backend API rate limits
  const res = await fetch(`https://api.clerk.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const first = data?.errors?.[0];
    const error = new Error(first?.long_message || first?.message || `Clerk HTTP ${res.status}`);
    error.status = res.status;
    error.code = first?.code;
    throw error;
  }
  return data;
}

const orgRoleFor = (role) => (role === "admin" ? "org:admin" : "org:member");

async function ensureMembership(clerkUserId, role) {
  if (!orgId) return "skipped (no CLERK_ORGANIZATION_ID)";
  try {
    await clerk(`/organizations/${orgId}/memberships`, {
      method: "POST",
      body: { user_id: clerkUserId, role: orgRoleFor(role) },
    });
    return "added";
  } catch (error) {
    if (error.code === "already_a_member_in_organization") {
      await clerk(`/organizations/${orgId}/memberships/${clerkUserId}`, {
        method: "PATCH",
        body: { role: orgRoleFor(role) },
      });
      return "role synced";
    }
    throw error;
  }
}

async function main() {
  console.log("Clerk user migration");
  console.log(`  mode:        ${apply ? "APPLY (writes enabled)" : "DRY RUN (no writes)"}`);
  console.log(`  strategy:    ${mode}`);
  console.log(`  database:    ${dbHost}`);
  console.log(`  clerk key:   ${secretKey.startsWith("sk_live_") ? "PRODUCTION (sk_live)" : "development (sk_test)"}`);
  console.log(`  org:         ${orgId ?? "not set, membership mirroring skipped"}`);
  if (only) console.log(`  only:        ${only}`);

  const [column] = await sql`
    select 1 as ok from information_schema.columns
    where table_name = 'users' and column_name = 'clerk_user_id'`;
  if (!column) {
    fail("users.clerk_user_id does not exist. Apply db/migrations/0002_clerk_identity.sql first.");
  }

  if (typeof args["create-admin"] === "string") {
    const email = args["create-admin"].trim().toLowerCase();
    const name = typeof args.name === "string" ? args.name.trim() : "";
    if (!name) fail("--create-admin needs --name=\"Full Name\"");
    const [existing] = await sql`select id from users where email = ${email}`;
    if (existing) {
      console.log(`\ncreate-admin: ${email} already exists, left unchanged`);
    } else if (apply) {
      await sql`insert into users (email, name, role, active) values (${email}, ${name}, 'admin', true)`;
      console.log(`\ncreate-admin: inserted ${email} as admin`);
    } else {
      console.log(`\ncreate-admin: would insert ${email} as admin`);
    }
  }

  const rows = await sql`
    select id, email, name, role, active, clerk_user_id
    from users order by created_at`;
  const selected = only ? rows.filter((r) => r.email === only) : rows;

  const results = [];
  for (const user of selected) {
    const row = { email: user.email, role: user.role, action: "", detail: "" };
    results.push(row);

    if (!user.active) {
      row.action = "skip";
      row.detail = "disabled";
      continue;
    }

    try {
      if (user.clerk_user_id) {
        row.action = "check membership";
        row.detail = apply ? await ensureMembership(user.clerk_user_id, user.role) : "would ensure org membership";
        continue;
      }

      if (mode === "invitations") {
        row.action = "invite";
        if (apply) {
          const invitation = await clerk("/invitations", {
            method: "POST",
            body: {
              email_address: user.email,
              redirect_url: `${appUrl.replace(/\/$/, "")}/sign-in`,
              public_metadata: { portalRole: user.role },
              notify: true,
              expires_in_days: 7,
            },
          });
          row.detail = `sent ${invitation.id}`;
        } else {
          row.detail = "would send invitation email";
        }
        continue;
      }

      const found = await clerk(`/users?email_address=${encodeURIComponent(user.email)}&limit=2`);
      const existing = Array.isArray(found) ? found[0] : null;
      row.action = existing ? "link existing Clerk user" : "create Clerk user";

      if (!apply) {
        row.detail = existing ? `would bind ${existing.id}` : "would create, bind, add to org";
        continue;
      }

      const clerkUser =
        existing ??
        (await clerk("/users", {
          method: "POST",
          body: {
            email_address: [user.email],
            skip_password_requirement: true,
            public_metadata: { portalRole: user.role },
          },
        }));

      const bound = await sql`
        update users set clerk_user_id = ${clerkUser.id}, updated_at = now()
        where id = ${user.id} and clerk_user_id is null
        returning id`;
      if (bound.length === 0) {
        row.detail = `Clerk ${clerkUser.id} ready, but the row changed; not bound`;
        continue;
      }
      row.detail = `bound ${clerkUser.id}, org ${await ensureMembership(clerkUser.id, user.role)}`;
    } catch (error) {
      row.action = row.action || "error";
      row.detail = `FAILED: ${error.message}${error.code ? ` (${error.code})` : ""}`;
    }
  }

  console.log("");
  console.table(results);
  const failures = results.filter((r) => r.detail.startsWith("FAILED")).length;
  console.log(`\n${results.length} users, ${failures} failures. ${apply ? "Writes applied." : "Nothing was written."}`);
  if (failures) process.exitCode = 2;
}

main().catch((error) => fail(error.stack || error.message));
