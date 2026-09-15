import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { authErrorResponse, requireAdmin } from "@/lib/auth";
import {
  clerkErrorMessage,
  invitationRedirectUrl,
  resendPortalInvitation,
  revokePortalInvitation,
} from "@/lib/clerk-admin";
import { normalizeEmail } from "@/lib/session-resolution";

type Params = { params: Promise<{ id: string }> };

// POST /api/admin/invitations/:id - resend (revoke and reissue)
export async function POST(request: Request, { params }: Params) {
  try {
    await requireAdmin();
  } catch (error) {
    return authErrorResponse(error);
  }

  const { id } = await params;
  try {
    const invitation = await resendPortalInvitation(id, invitationRedirectUrl(request));
    return NextResponse.json(invitation);
  } catch (error) {
    return NextResponse.json(
      { error: clerkErrorMessage(error, "Clerk could not resend the invitation") },
      { status: 502 }
    );
  }
}

// DELETE /api/admin/invitations/:id - revoke. Also deactivates the unaccepted
// portal row, so the email can no longer bind on a later sign-in.
export async function DELETE(_request: Request, { params }: Params) {
  try {
    await requireAdmin();
  } catch (error) {
    return authErrorResponse(error);
  }

  const { id } = await params;
  let revoked;
  try {
    revoked = await revokePortalInvitation(id);
  } catch (error) {
    return NextResponse.json(
      { error: clerkErrorMessage(error, "Clerk could not revoke the invitation") },
      { status: 502 }
    );
  }

  await db
    .update(users)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(users.email, normalizeEmail(revoked.emailAddress)), isNull(users.clerkUserId)));

  return NextResponse.json({ success: true });
}
