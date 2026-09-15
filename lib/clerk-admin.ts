import { clerkClient } from "@clerk/nextjs/server";
import { isPortalRole, type PortalRole } from "@/lib/session-resolution";
import type { ClerkEffectDeps } from "@/lib/user-admin";

/**
 * Server-only wrappers around the Clerk Backend API for user administration.
 * Nothing here decides authorization; the portal `users` table does.
 */

/** The single "Gratitude" workspace organization. Optional: mirroring is skipped when unset. */
export function workspaceOrgId() {
  return process.env.CLERK_ORGANIZATION_ID || null;
}

/** Where invitation links land. APP_URL pins it in production (e.g. https://agents.gratitude.com). */
export function invitationRedirectUrl(request: Request) {
  const base = process.env.APP_URL || new URL(request.url).origin;
  return `${base.replace(/\/$/, "")}/sign-in`;
}

export function orgRoleFor(role: PortalRole) {
  return role === "admin" ? "org:admin" : "org:member";
}

type LooseClerkError = {
  errors?: { code?: string; message?: string; longMessage?: string }[];
  message?: string;
};

export function clerkErrorCode(error: unknown) {
  return (error as LooseClerkError)?.errors?.[0]?.code;
}

export function clerkErrorMessage(error: unknown, fallback: string) {
  const first = (error as LooseClerkError)?.errors?.[0];
  return first?.longMessage || first?.message || fallback;
}

/** Revoke every active Clerk session for a user. Returns how many were revoked. */
export async function revokeAllSessions(clerkUserId: string) {
  const client = await clerkClient();
  let revoked = 0;

  for (let page = 0; page < 20; page++) {
    const { data } = await client.sessions.getSessionList({
      userId: clerkUserId,
      status: "active",
      limit: 100,
    });

    if (data.length === 0) break;

    for (const session of data) {
      await client.sessions.revokeSession(session.id);
      revoked++;
    }

    if (data.length < 100) break;
  }

  return revoked;
}

export async function ensureWorkspaceMembership(clerkUserId: string, role: PortalRole) {
  const organizationId = workspaceOrgId();
  if (!organizationId) return;

  const client = await clerkClient();
  try {
    await client.organizations.createOrganizationMembership({
      organizationId,
      userId: clerkUserId,
      role: orgRoleFor(role),
    });
  } catch (error) {
    // Already a member: make sure the mirrored role is current instead.
    try {
      await client.organizations.updateOrganizationMembership({
        organizationId,
        userId: clerkUserId,
        role: orgRoleFor(role),
      });
    } catch {
      console.warn(
        "[clerk-admin] workspace membership sync failed",
        clerkErrorCode(error) ?? "unknown"
      );
    }
  }
}

export const clerkEffectDeps: ClerkEffectDeps = {
  revokeSessions: (clerkUserId) => revokeAllSessions(clerkUserId),
  async ban(clerkUserId) {
    const client = await clerkClient();
    await client.users.banUser(clerkUserId);
  },
  async unban(clerkUserId) {
    const client = await clerkClient();
    await client.users.unbanUser(clerkUserId);
  },
  async deleteUser(clerkUserId) {
    const client = await clerkClient();
    await client.users.deleteUser(clerkUserId);
  },
  syncWorkspaceRole: (clerkUserId, role) => ensureWorkspaceMembership(clerkUserId, role),
};

export interface PortalInvitation {
  id: string;
  emailAddress: string;
  role: PortalRole | null;
  status: string;
  createdAt: number;
  expiresAt: number | null;
}

function toPortalInvitation(invitation: {
  id: string;
  emailAddress: string;
  publicMetadata: Record<string, unknown> | null;
  status: string;
  createdAt: number;
  expiresAt?: number | null;
}): PortalInvitation {
  const role = invitation.publicMetadata?.portalRole;
  return {
    id: invitation.id,
    emailAddress: invitation.emailAddress,
    role: isPortalRole(role) ? role : null,
    status: invitation.status,
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt ?? null,
  };
}

export async function createPortalInvitation(params: {
  email: string;
  role: PortalRole;
  redirectUrl: string;
  ignoreExisting?: boolean;
}) {
  const client = await clerkClient();
  const invitation = await client.invitations.createInvitation({
    emailAddress: params.email,
    redirectUrl: params.redirectUrl,
    publicMetadata: { portalRole: params.role },
    notify: true,
    ignoreExisting: params.ignoreExisting ?? false,
    expiresInDays: 7,
  });
  return toPortalInvitation(invitation);
}

export async function listPendingInvitations() {
  const client = await clerkClient();
  const { data } = await client.invitations.getInvitationList({
    status: "pending",
    limit: 100,
  });
  return data.map(toPortalInvitation);
}

export async function revokePortalInvitation(invitationId: string) {
  const client = await clerkClient();
  return toPortalInvitation(await client.invitations.revokeInvitation(invitationId));
}

/** Clerk has no "resend": revoke the pending invitation and issue a fresh one. */
export async function resendPortalInvitation(invitationId: string, redirectUrl: string) {
  const revoked = await revokePortalInvitation(invitationId);
  return createPortalInvitation({
    email: revoked.emailAddress,
    role: revoked.role ?? "partner",
    redirectUrl,
    ignoreExisting: true,
  });
}
