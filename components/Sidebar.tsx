"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import { toast } from "./Toaster";

interface Conversation {
  id: string;
  agentId: string;
  title: string;
  updatedAt: string;
}

interface SidebarProps {
  conversationId?: string | null;
  onSelectConversation?: (id: string) => void;
  onNewChat?: () => void;
  onDeleteConversation?: (id: string) => void;
  /** When false (non-chat pages), the conversation list is hidden and the
      "New conversation" button links to /chat. Chat behavior is unchanged. */
  showConversations?: boolean;
}

interface SessionResponse {
  user: {
    name: string;
    role: "admin" | "employee" | "partner";
  };
}

export default function Sidebar({
  conversationId = null,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  showConversations = true,
}: SidebarProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [search, setSearch] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const { signOut } = useClerk();

  const loadConversations = () =>
    fetch("/api/conversations")
      .then(async (r) => {
        if (!r.ok) throw new Error(`status ${r.status}`);
        const data = await r.json();
        if (Array.isArray(data)) setConversations(data);
      })
      .catch(() => {
        // Expired sessions get redirected to the login page by middleware,
        // which makes r.json() fail - tell the user instead of rendering
        // a silently empty list
        toast("Couldn't load conversations. Try refreshing or signing in again.");
      });

  useEffect(() => {
    fetch("/api/session").then(async (res) => {
      if (res.ok) {
        setSession(await res.json());
      } else if (res.status === 403) {
        // Signed in to Clerk, but the portal account is disabled or missing.
        router.replace("/no-access");
      } else if (res.status === 401) {
        router.replace("/sign-in");
      }
    });
    if (showConversations) void loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (showConversations && conversationId) {
      void loadConversations();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  const filtered = conversations.filter((c) => {
    if (!search.trim()) return true;
    return c.title?.toLowerCase().includes(search.toLowerCase());
  });

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  const weekStart = new Date(todayStart.getTime() - 7 * 86400000);

  const groups: { label: string; items: Conversation[] }[] = [];
  const today: Conversation[] = [];
  const yesterday: Conversation[] = [];
  const thisWeek: Conversation[] = [];
  const older: Conversation[] = [];

  for (const c of filtered) {
    const d = new Date(c.updatedAt);
    if (d >= todayStart) today.push(c);
    else if (d >= yesterdayStart) yesterday.push(c);
    else if (d >= weekStart) thisWeek.push(c);
    else older.push(c);
  }

  if (today.length) groups.push({ label: "Today", items: today });
  if (yesterday.length) groups.push({ label: "Yesterday", items: yesterday });
  if (thisWeek.length) groups.push({ label: "This week", items: thisWeek });
  if (older.length) groups.push({ label: "Older", items: older });

  function handleDelete(id: string) {
    setConfirmDeleteId(id);
  }

  function confirmDelete() {
    if (!confirmDeleteId) return;
    setConversations((prev) => prev.filter((c) => c.id !== confirmDeleteId));
    onDeleteConversation?.(confirmDeleteId);
    setConfirmDeleteId(null);
  }

  async function handleLogout() {
    // Ends the Clerk session server-side (revoked, not just a cleared cookie).
    await signOut({ redirectUrl: "/sign-in" });
  }

  const isAdmin = session?.user.role === "admin";

  return (
    <div className="w-64 h-screen bg-dark-900 border-r border-white/[0.06] flex flex-col shrink-0">
      {/* Header */}
      <div className="p-4 pb-3">
        <div className="flex items-center justify-between mb-4">
          <Image
            src="/gratitude-white.svg"
            alt="Gratitude"
            width={110}
            height={22}
          />
          {session && (
            <span className="text-[10px] text-white/30 uppercase tracking-wider">
              {session.user.role}
            </span>
          )}
        </div>

        {onNewChat ? (
          <button
            onClick={onNewChat}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-[13px] font-medium text-white/80 bg-white/[0.04] border border-white/[0.08] transition-colors hover:bg-white/[0.07] hover:border-white/[0.14] hover:text-white active:scale-[0.99]"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            New conversation
          </button>
        ) : (
          <Link
            href="/chat"
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-[13px] font-medium text-white/80 bg-white/[0.04] border border-white/[0.08] transition-colors hover:bg-white/[0.07] hover:border-white/[0.14] hover:text-white active:scale-[0.99]"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            New conversation
          </Link>
        )}
      </div>

      {/* Navigation */}
      <nav className="px-3 pb-3 space-y-0.5">
        {[
          {
            href: "/chat",
            label: "Chat",
            match: "/chat",
            icon: <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />,
          },
          {
            href: "/knowledgebase",
            label: "Knowledge base",
            match: "/knowledgebase",
            icon: <><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" /><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" /></>,
          },
          {
            href: "/resources",
            label: "Files",
            match: "/resources",
            icon: <><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" /><polyline points="13 2 13 9 20 9" /></>,
          },
          {
            href: "/guide",
            label: "Guide",
            match: "/guide",
            icon: <><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></>,
          },
          ...(isAdmin
            ? [
                {
                  href: "/admin",
                  label: "Admin",
                  match: "/admin",
                  icon: <><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></>,
                },
              ]
            : []),
        ].map((nav) => {
          const active = pathname === nav.match || pathname?.startsWith(nav.match + "/");
          return (
            <Link
              key={nav.href}
              href={nav.href}
              className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] transition-colors ${
                active
                  ? "text-white bg-white/[0.06]"
                  : "text-white/45 hover:text-white/80 hover:bg-white/[0.04]"
              }`}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`shrink-0 ${active ? "text-white/90" : "text-white/35"}`}
              >
                {nav.icon}
              </svg>
              {nav.label}
            </Link>
          );
        })}
      </nav>

      <div className="mx-3 border-t border-white/[0.06]" />

      {/* Search */}
      {showConversations && conversations.length > 5 && (
        <div className="px-3 pt-3 pb-1">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations"
            className="w-full rounded-md bg-white/[0.03] border border-white/[0.06] px-3 py-1.5 text-[12px] text-white/70 placeholder:text-white/25 focus:outline-none focus:border-white/[0.14] transition-colors"
          />
        </div>
      )}

      {/* Conversations */}
      {!showConversations ? (
        <div className="flex-1" />
      ) : (
      <div className="flex-1 overflow-y-auto px-2 pt-2">
        {groups.length === 0 ? (
          <div className="px-3 py-10">
            {conversations.length === 0 ? (
              <>
                <p className="text-[12px] text-white/40">No conversations yet</p>
                <p className="text-[11px] text-white/20 mt-1 leading-relaxed">
                  Everything you start with Gratitude is saved here.
                </p>
              </>
            ) : (
              <p className="text-[12px] text-white/30">No matches for that search</p>
            )}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-3">
              <div className="px-3 py-1.5 text-[10px] font-medium tracking-wider uppercase text-white/20">
                {group.label}
              </div>
              {group.items.map((conv) => (
                <div key={conv.id} className="group/conv relative">
                  <button
                    onClick={() => onSelectConversation?.(conv.id)}
                    className={`w-full text-left px-3 py-2 pr-8 rounded-lg text-[13px] transition-all ${
                      conversationId === conv.id
                        ? "bg-white/[0.08] text-white/90"
                        : "text-white/50 hover:bg-white/[0.04] hover:text-white/70"
                    }`}
                  >
                    <div className="line-clamp-1">{conv.title || "Untitled"}</div>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(conv.id);
                    }}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-md opacity-0 group-hover/conv:opacity-100 text-white/20 hover:text-red-400 hover:bg-red-400/10 transition-all"
                    title="Delete conversation"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
      )}

      {/* Footer */}
      <div className="p-3 border-t border-white/[0.06]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full bg-white/[0.06] flex items-center justify-center shrink-0">
              <span className="text-[11px] text-white/50 font-medium">
                {session?.user.name?.charAt(0).toUpperCase() || "?"}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-[12px] text-white/60 truncate">{session?.user.name}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="text-[10px] text-white/25 hover:text-white/50 transition-colors shrink-0 ml-2"
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Delete confirmation */}
      {confirmDeleteId && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div
            className="mx-4 w-full max-w-xs p-5 rounded-2xl"
            style={{
              background: "linear-gradient(180deg, #1a1a1a 0%, #0d0d0d 100%)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <p className="text-[14px] text-white/80 font-medium mb-1">Delete conversation?</p>
            <p className="text-[12px] text-white/40 mb-5">This can&apos;t be undone.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="flex-1 py-2 rounded-lg text-[12px] font-medium text-white/60 border border-white/[0.1] hover:bg-white/[0.05] transition-all"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 py-2 rounded-lg text-[12px] font-medium text-white bg-red-500/80 hover:bg-red-500 transition-all"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
