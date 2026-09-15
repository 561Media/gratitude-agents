import { describe, expect, it, vi } from "vitest";
import {
  applyClerkEffects,
  planClerkEffects,
  validateAdminChange,
  type ClerkEffectDeps,
} from "@/lib/user-admin";

const linked = { active: true, role: "employee" as const, clerkUserId: "user_1" };

describe("planClerkEffects (revocation, P0.4)", () => {
  it("revokes sessions and bans when an account is disabled", () => {
    expect(planClerkEffects(linked, { active: false })).toEqual(["revoke_sessions", "ban"]);
  });

  it("unbans when an account is re-enabled", () => {
    expect(planClerkEffects({ ...linked, active: false }, { active: true })).toEqual(["unban"]);
  });

  it("revokes sessions and syncs the org role on a role change", () => {
    expect(planClerkEffects(linked, { role: "admin" })).toEqual(["revoke_sessions", "sync_workspace_role"]);
  });

  it("does nothing when nothing actually changes", () => {
    expect(planClerkEffects(linked, { role: "employee", active: true })).toEqual([]);
  });

  it("deletes the Clerk user on removal", () => {
    expect(planClerkEffects(linked, { remove: true })).toEqual(["revoke_sessions", "delete_user"]);
  });

  it("has nothing to revoke for a user who never signed in", () => {
    expect(planClerkEffects({ ...linked, clerkUserId: null }, { active: false })).toEqual([]);
  });
});

describe("applyClerkEffects", () => {
  function deps(): ClerkEffectDeps {
    return {
      revokeSessions: vi.fn(async () => 2),
      ban: vi.fn(async () => undefined),
      unban: vi.fn(async () => undefined),
      deleteUser: vi.fn(async () => undefined),
      syncWorkspaceRole: vi.fn(async () => undefined),
    };
  }

  it("calls Clerk for every planned effect", async () => {
    const d = deps();
    const result = await applyClerkEffects("user_1", ["revoke_sessions", "ban"], "employee", d);
    expect(d.revokeSessions).toHaveBeenCalledWith("user_1");
    expect(d.ban).toHaveBeenCalledWith("user_1");
    expect(result).toEqual({ applied: ["revoke_sessions", "ban"], failed: [] });
  });

  it("reports failures without stopping the remaining effects", async () => {
    const d = deps();
    d.revokeSessions = vi.fn(async () => {
      throw new Error("clerk down");
    });
    const result = await applyClerkEffects("user_1", ["revoke_sessions", "sync_workspace_role"], "admin", d);
    expect(d.syncWorkspaceRole).toHaveBeenCalledWith("user_1", "admin");
    expect(result).toEqual({ applied: ["sync_workspace_role"], failed: ["revoke_sessions"] });
  });
});

describe("validateAdminChange", () => {
  const admin = { id: "u-admin", role: "admin" as const, active: true };

  it("blocks an admin from disabling, demoting or removing themselves", () => {
    for (const change of [{ active: false }, { role: "employee" as const }, { remove: true }]) {
      expect(
        validateAdminChange({ actorUserId: "u-admin", target: admin, change, activeAdminCount: 3 })
      ).toMatch(/your own/);
    }
  });

  it("keeps at least one active admin", () => {
    expect(
      validateAdminChange({ actorUserId: "u-other", target: admin, change: { active: false }, activeAdminCount: 1 })
    ).toMatch(/at least one active admin/);
  });

  it("allows ordinary changes", () => {
    expect(
      validateAdminChange({ actorUserId: "u-other", target: admin, change: { active: false }, activeAdminCount: 2 })
    ).toBeNull();
    expect(
      validateAdminChange({
        actorUserId: "u-admin",
        target: { id: "u-2", role: "partner", active: true },
        change: { role: "employee" },
        activeAdminCount: 1,
      })
    ).toBeNull();
  });
});
