import { cache } from "react";
import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type User } from "@/db/schema";
import { ensureWorkspaceMembership } from "@/lib/clerk-admin";
import {
  adminMfaRequired,
  resolvePortalUser,
  sessionHasSecondFactor,
  type PortalRole,
  type PortalUserRecord,
  type SessionResolution,
  type SessionResolutionDeps,
} from "@/lib/session-resolution";

/**
 * Session API for the portal. Identity comes from Clerk; authorization comes
 * from the `users` table on every call. The exported names and the core
 * SessionUser fields ({ userId, email, name, role }) are unchanged from the
 * pre-Clerk JWT implementation so existing route handlers keep working.
 */

export interface SessionUser {
  /** Portal users.id (uuid). Ownership columns reference this, not the Clerk id. */
  userId: string;
  email: string;
  name: string;
  role: PortalRole;
  clerkUserId: string;
  /** True when this Clerk session completed a second factor (TOTP or backup code). */
  secondFactorVerified: boolean;
}

function toRecord(user: User): PortalUserRecord {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    active: user.active,
    clerkUserId: user.clerkUserId,
  };
}

const dbDeps: SessionResolutionDeps = {
  async findByClerkUserId(clerkUserId) {
    const [row] = await db.select().from(users).where(eq(users.clerkUserId, clerkUserId)).limit(1);
    return row ? toRecord(row) : null;
  },
  async findByEmail(email) {
    const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return row ? toRecord(row) : null;
  },
  async bindClerkUserId(userId, clerkUserId) {
    const [row] = await db
      .update(users)
      .set({ clerkUserId, updatedAt: new Date() })
      .where(and(eq(users.id, userId), isNull(users.clerkUserId), eq(users.active, true)))
      .returning();
    return row ? toRecord(row) : null;
  },
  async loadClerkIdentity(clerkUserId) {
    try {
      const client = await clerkClient();
      const user = await client.users.getUser(clerkUserId);
      const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
      return {
        clerkUserId,
        primaryEmail: primary ? primary.emailAddress.trim().toLowerCase() : null,
        primaryEmailVerified: primary?.verification?.status === "verified",
      };
    } catch {
      return null;
    }
  },
  async onBound(user) {
    if (user.clerkUserId) {
      await ensureWorkspaceMembership(user.clerkUserId, user.role);
    }
  },
};

/** Resolve the current request once (deduplicated per server request). */
export const resolveCurrentSession = cache(
  async (): Promise<{
    resolution: SessionResolution;
    secondFactorVerified: boolean;
  }> => {
    const { userId, factorVerificationAge } = await auth();
    const resolution = await resolvePortalUser(userId, dbDeps);
    return {
      resolution,
      secondFactorVerified: sessionHasSecondFactor(factorVerificationAge),
    };
  }
);

export async function getSession(): Promise<SessionUser | null> {
  const { resolution, secondFactorVerified } = await resolveCurrentSession();

  if (resolution.status !== "ok" || !resolution.user.clerkUserId) {
    return null;
  }

  const { user } = resolution;
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    clerkUserId: user.clerkUserId!,
    secondFactorVerified,
  };
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
    readonly code: "unauthorized" | "forbidden" | "mfa_required"
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export async function requireSession() {
  const session = await getSession();

  if (!session) {
    throw new AuthError("Unauthorized", 401, "unauthorized");
  }

  return session;
}

/**
 * Admin gate. Role is read from the database on this request. Admins must also
 * have completed a second factor in this session unless ADMIN_MFA_REQUIRED=0.
 */
export async function requireAdmin() {
  const session = await requireSession();

  if (session.role !== "admin") {
    throw new AuthError("Forbidden", 403, "forbidden");
  }

  if (adminMfaRequired() && !session.secondFactorVerified) {
    throw new AuthError(
      "Two-step verification is required for admin actions",
      403,
      "mfa_required"
    );
  }

  return session;
}

/** Map an auth failure to an API-shaped JSON response. Unknown errors become 500. */
export function authErrorResponse(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error("[auth] unexpected error", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
