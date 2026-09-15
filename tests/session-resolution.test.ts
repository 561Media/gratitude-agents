import { describe, expect, it, vi } from "vitest";
import {
  resolvePortalUser,
  sessionHasSecondFactor,
  type ClerkIdentity,
  type PortalUserRecord,
  type SessionResolutionDeps,
} from "@/lib/session-resolution";

/** In-memory stand-in for the users table plus a mocked Clerk identity lookup. */
function makeDeps(rows: PortalUserRecord[], identities: Record<string, ClerkIdentity> = {}) {
  const table = rows.map((r) => ({ ...r }));
  const deps: SessionResolutionDeps = {
    findByClerkUserId: vi.fn(async (id: string) => table.find((r) => r.clerkUserId === id) ?? null),
    findByEmail: vi.fn(async (email: string) => table.find((r) => r.email === email) ?? null),
    bindClerkUserId: vi.fn(async (userId: string, clerkUserId: string) => {
      const row = table.find((r) => r.id === userId);
      if (!row || row.clerkUserId !== null || !row.active) return null;
      row.clerkUserId = clerkUserId;
      return { ...row };
    }),
    loadClerkIdentity: vi.fn(async (id: string) => identities[id] ?? null),
    onBound: vi.fn(async () => undefined),
  };
  return { table, deps };
}

const alice: PortalUserRecord = {
  id: "u-alice",
  email: "alice@gratitude.com",
  name: "Alice",
  role: "employee",
  active: true,
  clerkUserId: "user_alice",
};

describe("resolvePortalUser", () => {
  it("is signed out without a Clerk user id", async () => {
    const { deps } = makeDeps([alice]);
    expect(await resolvePortalUser(null, deps)).toEqual({ status: "signed_out" });
    expect(deps.findByClerkUserId).not.toHaveBeenCalled();
  });

  it("resolves a bound, active user from the database without calling Clerk", async () => {
    const { deps } = makeDeps([alice]);
    const result = await resolvePortalUser("user_alice", deps);
    expect(result).toEqual({ status: "ok", user: alice });
    expect(deps.loadClerkIdentity).not.toHaveBeenCalled();
  });

  it("revokes access on the next request once the row is disabled (P0.4)", async () => {
    const { table, deps } = makeDeps([alice]);
    expect((await resolvePortalUser("user_alice", deps)).status).toBe("ok");

    table[0].active = false; // admin disables the account; the Clerk token is still valid
    expect(await resolvePortalUser("user_alice", deps)).toEqual({ status: "disabled" });
  });

  it("uses the current database role, not a role captured at sign-in", async () => {
    const { table, deps } = makeDeps([{ ...alice, role: "admin" }]);
    const first = await resolvePortalUser("user_alice", deps);
    expect(first.status === "ok" && first.user.role).toBe("admin");

    table[0].role = "partner";
    const second = await resolvePortalUser("user_alice", deps);
    expect(second.status === "ok" && second.user.role).toBe("partner");
  });

  it("binds on first sign-in by verified primary email and mirrors membership", async () => {
    const invited = { ...alice, clerkUserId: null };
    const { table, deps } = makeDeps([invited], {
      user_new: { clerkUserId: "user_new", primaryEmail: "alice@gratitude.com", primaryEmailVerified: true },
    });

    const result = await resolvePortalUser("user_new", deps);
    expect(result.status).toBe("ok");
    expect(table[0].clerkUserId).toBe("user_new");
    expect(deps.onBound).toHaveBeenCalledTimes(1);

    // Subsequent requests take the fast path.
    await resolvePortalUser("user_new", deps);
    expect(deps.loadClerkIdentity).toHaveBeenCalledTimes(1);
  });

  it("does not bind on an unverified email", async () => {
    const { table, deps } = makeDeps([{ ...alice, clerkUserId: null }], {
      user_new: { clerkUserId: "user_new", primaryEmail: "alice@gratitude.com", primaryEmailVerified: false },
    });
    expect(await resolvePortalUser("user_new", deps)).toEqual({ status: "no_account" });
    expect(table[0].clerkUserId).toBeNull();
  });

  it("returns no_account when no portal row matches", async () => {
    const { deps } = makeDeps([], {
      user_x: { clerkUserId: "user_x", primaryEmail: "stranger@example.com", primaryEmailVerified: true },
    });
    expect(await resolvePortalUser("user_x", deps)).toEqual({ status: "no_account" });
  });

  it("returns no_account when Clerk cannot load the user", async () => {
    const { deps } = makeDeps([{ ...alice, clerkUserId: null }]);
    expect(await resolvePortalUser("user_missing", deps)).toEqual({ status: "no_account" });
  });

  it("never rebinds an email already bound to a different Clerk user", async () => {
    const { table, deps } = makeDeps([alice], {
      user_other: { clerkUserId: "user_other", primaryEmail: "alice@gratitude.com", primaryEmailVerified: true },
    });
    expect(await resolvePortalUser("user_other", deps)).toEqual({ status: "conflict" });
    expect(table[0].clerkUserId).toBe("user_alice");
    expect(deps.bindClerkUserId).not.toHaveBeenCalled();
  });

  it("does not bind a disabled row (revoked invitation or disabled account)", async () => {
    const { table, deps } = makeDeps([{ ...alice, clerkUserId: null, active: false }], {
      user_new: { clerkUserId: "user_new", primaryEmail: "alice@gratitude.com", primaryEmailVerified: true },
    });
    expect(await resolvePortalUser("user_new", deps)).toEqual({ status: "disabled" });
    expect(table[0].clerkUserId).toBeNull();
  });

  it("recovers when a concurrent request bound the same user first", async () => {
    const { table, deps } = makeDeps([{ ...alice, clerkUserId: null }], {
      user_new: { clerkUserId: "user_new", primaryEmail: "alice@gratitude.com", primaryEmailVerified: true },
    });
    deps.bindClerkUserId = vi.fn(async () => {
      table[0].clerkUserId = "user_new"; // the other request won
      return null;
    });
    const result = await resolvePortalUser("user_new", deps);
    expect(result.status).toBe("ok");
  });

  it("still signs the user in when org mirroring fails", async () => {
    const { deps } = makeDeps([{ ...alice, clerkUserId: null }], {
      user_new: { clerkUserId: "user_new", primaryEmail: "alice@gratitude.com", primaryEmailVerified: true },
    });
    deps.onBound = vi.fn(async () => {
      throw new Error("clerk down");
    });
    expect((await resolvePortalUser("user_new", deps)).status).toBe("ok");
  });
});

describe("sessionHasSecondFactor", () => {
  it("reads the second factor age from session claims", () => {
    expect(sessionHasSecondFactor(null)).toBe(false);
    expect(sessionHasSecondFactor(undefined)).toBe(false);
    expect(sessionHasSecondFactor([3, -1])).toBe(false);
    expect(sessionHasSecondFactor([3, 0])).toBe(true);
    expect(sessionHasSecondFactor([30, 12])).toBe(true);
  });
});
