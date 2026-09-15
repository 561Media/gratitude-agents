"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";

type Role = "admin" | "employee" | "partner";

interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  clerkLinked: boolean;
  createdAt: string;
}

interface Invitation {
  id: string;
  emailAddress: string;
  role: Role | null;
  status: string;
  createdAt: number;
  expiresAt: number | null;
}

const ROLES: Role[] = ["admin", "employee", "partner"];

const fieldClasses =
  "w-full px-3.5 py-2.5 rounded-lg text-[13px] text-white/85 placeholder:text-white/25 bg-white/[0.03] border border-white/[0.08] focus:outline-none focus:border-white/[0.18] transition-colors";

function titleCase(role: string) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

async function readJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export default function AdminPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<Role>("employee");

  const loadData = useCallback(async () => {
    const [usersRes, invitesRes] = await Promise.all([
      fetch("/api/admin/users"),
      fetch("/api/admin/invitations"),
    ]);

    for (const res of [usersRes, invitesRes]) {
      if (res.status === 403) {
        const data = await readJson(res.clone());
        if (data.code === "mfa_required") {
          setMfaRequired(true);
          return;
        }
      }
    }

    if (usersRes.ok) {
      setUsers(await usersRes.json());
    } else {
      setError((await readJson(usersRes)).error || "Could not load users.");
    }

    if (invitesRes.ok) {
      setInvitations(await invitesRes.json());
    } else {
      setError((await readJson(invitesRes)).error || "Could not load invitations.");
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const sessionRes = await fetch("/api/session");
      if (sessionRes.status === 401) {
        router.push("/sign-in");
        return;
      }
      if (!sessionRes.ok) {
        router.push("/no-access");
        return;
      }
      const session = await sessionRes.json();
      if (session.user.role !== "admin") {
        router.push("/chat");
        return;
      }
      setCurrentUserId(session.user.userId);
      await loadData();
      setReady(true);
    })();
  }, [router, loadData]);

  function report(data: { error?: string; warning?: string }, fallback: string, ok: boolean) {
    if (!ok) {
      setError(data.error || fallback);
      return;
    }
    setError("");
    setNotice(data.warning || "");
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setBusyId("invite");
    setError("");
    setNotice("");

    const res = await fetch("/api/admin/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, email: newEmail, role: newRole }),
    });
    const data = await readJson(res);
    report(data, "Could not send the invitation.", res.ok);

    if (res.ok) {
      setNotice(`Invitation sent to ${data.emailAddress}.`);
      setNewName("");
      setNewEmail("");
      setNewRole("employee");
      setShowForm(false);
      await loadData();
    }
    setBusyId(null);
  }

  async function patchUser(user: User, body: Partial<Pick<User, "role" | "active">>) {
    setBusyId(user.id);
    setError("");
    setNotice("");

    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: user.id, ...body }),
    });
    const data = await readJson(res);
    report(data, "Could not update the user.", res.ok);

    if (res.ok) {
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, ...body } : u)));
    }
    setBusyId(null);
  }

  async function removeUser(user: User) {
    if (!window.confirm(`Remove ${user.email}? They are signed out and can no longer sign in. Their conversations and files are kept.`)) {
      return;
    }
    setBusyId(user.id);
    setError("");
    setNotice("");

    const res = await fetch("/api/admin/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: user.id }),
    });
    const data = await readJson(res);
    report(data, "Could not remove the user.", res.ok);

    if (res.ok) {
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, active: false, clerkLinked: false } : u))
      );
    }
    setBusyId(null);
  }

  async function invitationAction(invitation: Invitation, method: "POST" | "DELETE") {
    setBusyId(invitation.id);
    setError("");
    setNotice("");

    const res = await fetch(`/api/admin/invitations/${invitation.id}`, { method });
    const data = await readJson(res);
    report(data, method === "POST" ? "Could not resend the invitation." : "Could not revoke the invitation.", res.ok);

    if (res.ok) {
      setNotice(
        method === "POST"
          ? `Invitation resent to ${invitation.emailAddress}.`
          : `Invitation for ${invitation.emailAddress} revoked.`
      );
      await loadData();
    }
    setBusyId(null);
  }

  if (!ready && !mfaRequired) {
    return (
      <AppShell title="Admin" maxWidth="max-w-4xl">
        <div className="flex items-center justify-center h-64">
          <div className="w-5 h-5 border-2 border-white/[0.1] border-t-white/60 rounded-full animate-spin" />
        </div>
      </AppShell>
    );
  }

  if (mfaRequired) {
    return (
      <AppShell title="Admin" maxWidth="max-w-4xl">
        <h1 className="font-display uppercase text-[26px] sm:text-[30px] leading-[1.05] text-white mb-4">
          Admin
        </h1>
        <div className="max-w-2xl rounded-xl border border-brand-pink/30 bg-brand-pink/[0.06] p-5">
          <h2 className="text-[15px] font-semibold text-white">Two-step verification required</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-white/65">
            Admin actions need an authenticator app on your account. Turn it on under
            Security on your account page, then sign out and sign back in so this
            session is verified.
          </p>
          <Link
            href="/account/security"
            className="mt-4 inline-block rounded-full px-5 py-2.5 text-[13px] font-semibold text-white"
            style={{ background: "linear-gradient(135deg, #FE3184 0%, #FF6B35 50%, #ec7211 100%)" }}
          >
            Set up two-step verification
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Admin" maxWidth="max-w-4xl">
      <div>
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="font-display uppercase text-[26px] sm:text-[30px] leading-[1.05] tracking-[-0.01em] text-white mb-2">
              Admin
            </h1>
            <p className="text-[14px] text-white/45">
              {users.filter((u) => u.active).length} active of {users.length} user
              {users.length !== 1 ? "s" : ""}
              {invitations.length > 0 ? `, ${invitations.length} pending invitation${invitations.length !== 1 ? "s" : ""}` : ""}
            </p>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium text-white/80 bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.07] hover:text-white transition-colors"
          >
            {showForm ? "Cancel" : "Invite someone"}
          </button>
        </div>

        {error && (
          <div role="alert" className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-[13px] text-red-300">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="mb-4 px-4 py-3 rounded-lg bg-white/[0.04] border border-white/[0.1] text-[13px] text-white/75">
            {notice}
          </div>
        )}

        {showForm && (
          <form onSubmit={handleInvite} className="mb-8 p-5 rounded-xl border border-white/[0.06] bg-white/[0.02]">
            <p className="mb-4 text-[13px] text-white/50">
              They get an email with a link. Accepting it signs them in; after that they
              sign in with an emailed code. No password is ever set.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <label htmlFor="invite-name" className="block text-[12px] font-medium text-white/50 mb-1.5">Name</label>
                <input id="invite-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Full name" required className={fieldClasses} />
              </div>
              <div>
                <label htmlFor="invite-email" className="block text-[12px] font-medium text-white/50 mb-1.5">Email</label>
                <input id="invite-email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="name@gratitude.com" required className={fieldClasses} />
              </div>
              <div>
                <label htmlFor="invite-role" className="block text-[12px] font-medium text-white/50 mb-1.5">Role</label>
                <select id="invite-role" value={newRole} onChange={(e) => setNewRole(e.target.value as Role)} className={fieldClasses}>
                  {ROLES.map((r) => (
                    <option key={r} value={r} className="bg-dark-900 text-white">{titleCase(r)}</option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="submit"
              disabled={busyId === "invite" || !newName || !newEmail}
              className="px-5 py-2.5 rounded-full text-[13px] font-semibold text-white disabled:opacity-40 transition-transform duration-200 hover:-translate-y-0.5"
              style={{ background: "linear-gradient(135deg, #FE3184 0%, #FF6B35 50%, #ec7211 100%)" }}
            >
              {busyId === "invite" ? "Sending" : "Send invitation"}
            </button>
          </form>
        )}

        {invitations.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-[12px] font-medium uppercase tracking-wider text-white/40">Pending invitations</h2>
            <div className="rounded-xl border border-white/[0.06] overflow-x-auto bg-white/[0.01]">
              <table className="w-full min-w-[520px]">
                <tbody>
                  {invitations.map((inv) => (
                    <tr key={inv.id} className="border-b border-white/[0.04] last:border-0">
                      <td className="px-5 py-3.5 text-[13px] text-white/80">{inv.emailAddress}</td>
                      <td className="px-5 py-3.5 text-[12px] text-white/50">{inv.role ? titleCase(inv.role) : "No role"}</td>
                      <td className="px-5 py-3.5 text-[12px] text-white/40">
                        Sent {new Date(inv.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        <button onClick={() => invitationAction(inv, "POST")} disabled={busyId === inv.id} className="mr-4 text-[12px] text-white/55 hover:text-white disabled:opacity-40">
                          Resend
                        </button>
                        <button onClick={() => invitationAction(inv, "DELETE")} disabled={busyId === inv.id} className="text-[12px] text-red-300/80 hover:text-red-300 disabled:opacity-40">
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <h2 className="mb-3 text-[12px] font-medium uppercase tracking-wider text-white/40">Users</h2>
        <div className="rounded-xl border border-white/[0.06] overflow-x-auto bg-white/[0.01]">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="text-left px-5 py-3 text-[10px] uppercase tracking-wider text-white/30 font-medium">User</th>
                <th className="text-left px-5 py-3 text-[10px] uppercase tracking-wider text-white/30 font-medium">Role</th>
                <th className="text-left px-5 py-3 text-[10px] uppercase tracking-wider text-white/30 font-medium">Status</th>
                <th className="text-right px-5 py-3 text-[10px] uppercase tracking-wider text-white/30 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isSelf = user.id === currentUserId;
                const status = !user.active ? "Disabled" : user.clerkLinked ? "Active" : "Invited";
                return (
                  <tr key={user.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="text-[13px] text-white/80 font-medium">
                        {user.name}
                        {isSelf && <span className="ml-2 text-[11px] text-white/35">(you)</span>}
                      </div>
                      <div className="text-[11px] text-white/35 mt-0.5">{user.email}</div>
                    </td>
                    <td className="px-5 py-3.5">
                      <select
                        value={user.role}
                        disabled={busyId === user.id}
                        onChange={(e) => patchUser(user, { role: e.target.value as Role })}
                        aria-label={`Role for ${user.email}`}
                        className="px-2 py-1 rounded-md text-[12px] bg-white/[0.04] border border-white/[0.08] text-white/70 focus:outline-none disabled:opacity-50"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r} className="bg-dark-900 text-white">{titleCase(r)}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${
                          status === "Active"
                            ? "bg-green-500/10 text-green-400 border-green-500/20"
                            : status === "Invited"
                              ? "bg-white/[0.05] text-white/60 border-white/[0.12]"
                              : "bg-red-500/10 text-red-400 border-red-500/20"
                        }`}
                      >
                        {status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                      <button
                        onClick={() => patchUser(user, { active: !user.active })}
                        disabled={busyId === user.id}
                        className="mr-4 text-[12px] text-white/55 hover:text-white disabled:opacity-40"
                      >
                        {user.active ? "Disable" : "Enable"}
                      </button>
                      <button
                        onClick={() => removeUser(user)}
                        disabled={busyId === user.id || (!user.active && !user.clerkLinked)}
                        className="text-[12px] text-red-300/80 hover:text-red-300 disabled:opacity-30"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
