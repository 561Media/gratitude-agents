import type { PortalRole, PortalUserRecord } from "@/lib/session-resolution";

/**
 * Pure planning for admin user changes (review finding P0.4). The route writes
 * the database first, which blocks the user on their next request by itself;
 * these Clerk effects then end the live sessions so the browser is signed out
 * too. Kept free of Clerk imports for unit tests (tests/user-admin.test.ts).
 */

export type ClerkEffect =
  | "revoke_sessions"
  | "ban"
  | "unban"
  | "sync_workspace_role"
  | "delete_user";

export interface UserChange {
  active?: boolean;
  role?: PortalRole;
  remove?: boolean;
}

export interface ClerkEffectDeps {
  revokeSessions(clerkUserId: string): Promise<unknown>;
  ban(clerkUserId: string): Promise<unknown>;
  unban(clerkUserId: string): Promise<unknown>;
  deleteUser(clerkUserId: string): Promise<unknown>;
  syncWorkspaceRole(clerkUserId: string, role: PortalRole): Promise<unknown>;
}

export function planClerkEffects(
  current: Pick<PortalUserRecord, "active" | "role" | "clerkUserId">,
  change: UserChange
): ClerkEffect[] {
  // Not yet signed in (invited or migrated without a Clerk user): nothing to revoke.
  if (!current.clerkUserId) return [];

  if (change.remove) return ["revoke_sessions", "delete_user"];

  const disabling = change.active === false && current.active;
  const enabling = change.active === true && !current.active;
  const roleChanged = change.role !== undefined && change.role !== current.role;

  const effects: ClerkEffect[] = [];
  if (disabling || roleChanged) effects.push("revoke_sessions");
  if (disabling) effects.push("ban");
  if (enabling) effects.push("unban");
  if (roleChanged) effects.push("sync_workspace_role");
  return effects;
}

export async function applyClerkEffects(
  clerkUserId: string,
  effects: ClerkEffect[],
  role: PortalRole,
  deps: ClerkEffectDeps
) {
  const applied: ClerkEffect[] = [];
  const failed: ClerkEffect[] = [];

  for (const effect of effects) {
    try {
      switch (effect) {
        case "revoke_sessions":
          await deps.revokeSessions(clerkUserId);
          break;
        case "ban":
          await deps.ban(clerkUserId);
          break;
        case "unban":
          await deps.unban(clerkUserId);
          break;
        case "delete_user":
          await deps.deleteUser(clerkUserId);
          break;
        case "sync_workspace_role":
          await deps.syncWorkspaceRole(clerkUserId, role);
          break;
      }
      applied.push(effect);
    } catch {
      failed.push(effect);
    }
  }

  return { applied, failed };
}

/**
 * Guard rails: an admin cannot lock themselves out, and the workspace always
 * keeps at least one active admin. Returns an error message, or null when allowed.
 */
export function validateAdminChange(params: {
  actorUserId: string;
  target: Pick<PortalUserRecord, "id" | "role" | "active">;
  change: UserChange;
  activeAdminCount: number;
}): string | null {
  const { actorUserId, target, change, activeAdminCount } = params;

  const removesAdminAccess =
    target.role === "admin" &&
    target.active &&
    (change.remove === true ||
      change.active === false ||
      (change.role !== undefined && change.role !== "admin"));

  if (target.id === actorUserId && removesAdminAccess) {
    return "You cannot disable, demote or remove your own admin account.";
  }

  if (removesAdminAccess && activeAdminCount <= 1) {
    return "The workspace needs at least one active admin.";
  }

  return null;
}
