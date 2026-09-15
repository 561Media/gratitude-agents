import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { authErrorResponse, requireAdmin } from "@/lib/auth";
import {
  clerkErrorMessage,
  createPortalInvitation,
  invitationRedirectUrl,
  listPendingInvitations,
  revokePortalInvitation,
} from "@/lib/clerk-admin";
import { isPortalRole, normalizeEmail } from "@/lib/session-resolution";

// GET /api/admin/invitations - pending Clerk invitations
export async function GET() {
  try {
    await requireAdmin();
  } catch (error) {
    return authErrorResponse(error);
  }

  try {
    return NextResponse.json(await listPendingInvitations());
  } catch (error) {
    return NextResponse.json(
      { error: clerkErrorMessage(error, "Could not load invitations from Clerk") },
      { status: 502 }
    );
  }
}

// POST /api/admin/invitations - invite someone. The portal row carries the role;
// it is bound to the Clerk user when they accept and sign in.
export async function POST(request: Request) {
  try {
    await requireAdmin();
  } catch (error) {
    return authErrorResponse(error);
  }

  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
    name?: unknown;
    role?: unknown;
  } | null;

  const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (!isPortalRole(body?.role)) {
    return NextResponse.json({ error: "Role must be admin, employee, or partner" }, { status: 400 });
  }
  const role = body.role;

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing?.clerkUserId) {
    return NextResponse.json(
      {
        error: existing.active
          ? "This person already has access."
          : "This person already has an account. Enable it instead of inviting again.",
      },
      { status: 409 }
    );
  }

  let invitation;
  try {
    invitation = await createPortalInvitation({
      email,
      role,
      redirectUrl: invitationRedirectUrl(request),
    });
  } catch (error) {
    return NextResponse.json(
      { error: clerkErrorMessage(error, "Clerk could not create the invitation") },
      { status: 502 }
    );
  }

  try {
    if (existing) {
      await db
        .update(users)
        .set({ name, role, active: true, updatedAt: new Date() })
        .where(eq(users.id, existing.id));
    } else {
      await db.insert(users).values({ email, name, role, active: true });
    }
  } catch (error) {
    // Do not leave a live invitation without the row that authorizes it.
    await revokePortalInvitation(invitation.id).catch(() => undefined);
    console.error("[invitations] database write failed", error);
    return NextResponse.json({ error: "Could not save the invited user" }, { status: 500 });
  }

  return NextResponse.json(invitation, { status: 201 });
}
