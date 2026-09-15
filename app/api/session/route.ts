import { NextResponse } from "next/server";
import { getSession, resolveCurrentSession } from "@/lib/auth";
import { adminMfaRequired } from "@/lib/session-resolution";

export async function GET() {
  const session = await getSession();

  if (!session) {
    const { resolution } = await resolveCurrentSession();
    // 401: no Clerk session. 403: signed in to Clerk, but the portal account is
    // missing, disabled or conflicting, so signing in again will not help.
    const status = resolution.status === "signed_out" ? 401 : 403;
    return NextResponse.json(
      { authenticated: false, reason: resolution.status },
      { status }
    );
  }

  return NextResponse.json({
    authenticated: true,
    user: session,
    mfa: {
      requiredForRole: session.role === "admin" && adminMfaRequired(),
      verified: session.secondFactorVerified,
    },
  });
}
