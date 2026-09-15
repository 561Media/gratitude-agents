import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { authErrorResponse, requireAdmin } from "@/lib/auth";
import { clerkEffectDeps } from "@/lib/clerk-admin";
import { isPortalRole } from "@/lib/session-resolution";
import {
  applyClerkEffects,
  planClerkEffects,
  validateAdminChange,
  type ClerkEffect,
  type UserChange,
} from "@/lib/user-admin";

async function countActiveAdmins() {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.active, true)));
  return rows.length;
}

function effectWarning(failed: ClerkEffect[]) {
  if (failed.length === 0) return undefined;
  return `Saved. The account is blocked in the portal, but Clerk did not confirm: ${failed.join(", ")}. Retry, or check the user in the Clerk dashboard.`;
}

// GET /api/admin/users - list portal users
export async function GET() {
  try {
    await requireAdmin();
  } catch (error) {
    return authErrorResponse(error);
  }

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      active: users.active,
      clerkUserId: users.clerkUserId,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .orderBy(users.createdAt);

  return NextResponse.json(
    rows.map(({ clerkUserId, ...row }) => ({ ...row, clerkLinked: Boolean(clerkUserId) }))
  );
}

// PATCH /api/admin/users - change role, active flag or name. Revokes sessions
// on disable and role change (review finding P0.4).
export async function PATCH(request: Request) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return authErrorResponse(error);
  }

  const body = (await request.json().catch(() => null)) as {
    id?: unknown;
    role?: unknown;
    active?: unknown;
    name?: unknown;
  } | null;

  if (!body || typeof body.id !== "string") {
    return NextResponse.json({ error: "User id is required" }, { status: 400 });
  }
  if (body.role !== undefined && !isPortalRole(body.role)) {
    return NextResponse.json({ error: "Role must be admin, employee, or partner" }, { status: 400 });
  }
  if (body.active !== undefined && typeof body.active !== "boolean") {
    return NextResponse.json({ error: "active must be true or false" }, { status: 400 });
  }
  if (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim())) {
    return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
  }

  const [target] = await db.select().from(users).where(eq(users.id, body.id)).limit(1);
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const change: UserChange = {
    role: body.role as UserChange["role"],
    active: body.active as boolean | undefined,
  };

  const blocked = validateAdminChange({
    actorUserId: admin.userId,
    target,
    change,
    activeAdminCount: await countActiveAdmins(),
  });
  if (blocked) {
    return NextResponse.json({ error: blocked }, { status: 409 });
  }

  // Database first: this alone blocks the user on their next request.
  const updates: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (change.role !== undefined) updates.role = change.role;
  if (change.active !== undefined) updates.active = change.active;
  if (typeof body.name === "string") updates.name = body.name.trim();
  await db.update(users).set(updates).where(eq(users.id, target.id));

  // Then end live Clerk sessions so the browser is signed out as well.
  const effects = planClerkEffects(target, change);
  const { applied, failed } = target.clerkUserId
    ? await applyClerkEffects(target.clerkUserId, effects, change.role ?? target.role, clerkEffectDeps)
    : { applied: [] as ClerkEffect[], failed: [] as ClerkEffect[] };

  return NextResponse.json({ success: true, applied, warning: effectWarning(failed) });
}

// DELETE /api/admin/users - remove access. The row is kept (it owns
// conversations and files) but deactivated and unlinked; the Clerk user is deleted.
export async function DELETE(request: Request) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return authErrorResponse(error);
  }

  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  if (!body || typeof body.id !== "string") {
    return NextResponse.json({ error: "User id is required" }, { status: 400 });
  }

  const [target] = await db.select().from(users).where(eq(users.id, body.id)).limit(1);
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const blocked = validateAdminChange({
    actorUserId: admin.userId,
    target,
    change: { remove: true },
    activeAdminCount: await countActiveAdmins(),
  });
  if (blocked) {
    return NextResponse.json({ error: blocked }, { status: 409 });
  }

  await db
    .update(users)
    .set({ active: false, clerkUserId: null, updatedAt: new Date() })
    .where(eq(users.id, target.id));

  const effects = planClerkEffects(target, { remove: true });
  const { applied, failed } = target.clerkUserId
    ? await applyClerkEffects(target.clerkUserId, effects, target.role, clerkEffectDeps)
    : { applied: [] as ClerkEffect[], failed: [] as ClerkEffect[] };

  return NextResponse.json({ success: true, applied, warning: effectWarning(failed) });
}
