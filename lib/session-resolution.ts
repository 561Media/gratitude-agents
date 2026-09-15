/**
 * Pure session-resolution logic, kept free of Clerk and database imports so it
 * can be unit tested with plain mocks (see tests/session-resolution.test.ts).
 *
 * Clerk proves WHO the person is. The portal's own `users` table decides
 * WHETHER they may use the portal and WITH WHICH ROLE. Every protected request
 * goes through resolvePortalUser, so disabling a user or changing their role in
 * the database takes effect on the very next request, regardless of how long
 * the Clerk session token has left to live.
 */

export type PortalRole = "admin" | "employee" | "partner";

export const PORTAL_ROLES: readonly PortalRole[] = ["admin", "employee", "partner"];

export function isPortalRole(value: unknown): value is PortalRole {
  return typeof value === "string" && (PORTAL_ROLES as readonly string[]).includes(value);
}

export interface PortalUserRecord {
  id: string;
  email: string;
  name: string;
  role: PortalRole;
  active: boolean;
  clerkUserId: string | null;
}

export interface ClerkIdentity {
  clerkUserId: string;
  /** Primary email address, lower-cased. Null when the user has none. */
  primaryEmail: string | null;
  /** True only when Clerk has verified the primary email address. */
  primaryEmailVerified: boolean;
}

export interface SessionResolutionDeps {
  findByClerkUserId(clerkUserId: string): Promise<PortalUserRecord | null>;
  findByEmail(email: string): Promise<PortalUserRecord | null>;
  /**
   * Bind a Clerk user id to a portal user. Must be conditional: only succeed
   * when the row is still unbound (clerk_user_id IS NULL) and active. Returns
   * the bound row, or null when the condition no longer holds.
   */
  bindClerkUserId(userId: string, clerkUserId: string): Promise<PortalUserRecord | null>;
  /** Fetch the identity from Clerk. Only called on first sign-in (fallback path). */
  loadClerkIdentity(clerkUserId: string): Promise<ClerkIdentity | null>;
  /** Side effect after a first-time bind (e.g. add to the Gratitude org). Must not throw. */
  onBound?(user: PortalUserRecord): Promise<void>;
}

export type SessionResolution =
  | { status: "ok"; user: PortalUserRecord }
  /** No Clerk session at all. */
  | { status: "signed_out" }
  /** Signed in to Clerk, but no portal user matches (never invited, or invitation revoked). */
  | { status: "no_account" }
  /** Portal user exists but has been disabled by an admin. */
  | { status: "disabled" }
  /** The matching email is already bound to a different Clerk user. Never rebind silently. */
  | { status: "conflict" };

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function resolvePortalUser(
  clerkUserId: string | null | undefined,
  deps: SessionResolutionDeps
): Promise<SessionResolution> {
  if (!clerkUserId) {
    return { status: "signed_out" };
  }

  // Fast path: already bound. This is every request after the first sign-in.
  const bound = await deps.findByClerkUserId(clerkUserId);
  if (bound) {
    return bound.active ? { status: "ok", user: bound } : { status: "disabled" };
  }

  // First sign-in: match on the verified primary email, then bind.
  const identity = await deps.loadClerkIdentity(clerkUserId);
  if (!identity || !identity.primaryEmail || !identity.primaryEmailVerified) {
    return { status: "no_account" };
  }

  const byEmail = await deps.findByEmail(normalizeEmail(identity.primaryEmail));
  if (!byEmail) {
    return { status: "no_account" };
  }

  if (byEmail.clerkUserId && byEmail.clerkUserId !== clerkUserId) {
    return { status: "conflict" };
  }

  if (!byEmail.active) {
    return { status: "disabled" };
  }

  const justBound = await deps.bindClerkUserId(byEmail.id, clerkUserId);
  if (!justBound) {
    // Lost a race with a concurrent request, or the row changed underneath us.
    // Re-read by Clerk id: if the other request bound it to us, that is fine.
    const reread = await deps.findByClerkUserId(clerkUserId);
    if (reread) {
      return reread.active ? { status: "ok", user: reread } : { status: "disabled" };
    }
    return { status: "conflict" };
  }

  if (deps.onBound) {
    try {
      await deps.onBound(justBound);
    } catch {
      // Org mirroring is best effort; the database row is the authority.
    }
  }

  return { status: "ok", user: justBound };
}

/**
 * Whether this session has completed a second factor. Clerk puts
 * factorVerificationAge = [firstFactorMinutes, secondFactorMinutes] in the
 * session claims; the second value is -1 when no second factor was verified.
 */
export function sessionHasSecondFactor(
  factorVerificationAge: readonly [number, number] | null | undefined
) {
  return Array.isArray(factorVerificationAge) && factorVerificationAge[1] >= 0;
}

export function adminMfaRequired() {
  return process.env.ADMIN_MFA_REQUIRED !== "0";
}
