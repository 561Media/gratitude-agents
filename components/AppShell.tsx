"use client";

import Sidebar from "./Sidebar";
import { MenuButton, useMobileNav } from "./MobileNav";

/**
 * Shared page shell: the same left sidebar the chat uses (conversation list
 * hidden), a slim header matching the chat header, and a scrollable content
 * column. Every non-chat page renders inside this so the portal feels like
 * one product. Below md the sidebar is an off-canvas drawer opened from the
 * menu button in the header.
 */
export default function AppShell({
  title,
  maxWidth = "max-w-6xl",
  children,
}: {
  /** Label shown in the slim top bar, matching the chat header. */
  title: string;
  /** Tailwind max-width class for the content column. */
  maxWidth?: string;
  children: React.ReactNode;
}) {
  const nav = useMobileNav();

  return (
    <div className="flex h-dvh overflow-hidden bg-dark-950">
      <Sidebar showConversations={false} mobileOpen={nav.open} onMobileClose={nav.closeNav} />

      <div className="flex-1 flex flex-col h-dvh min-w-0">
        <header className="shrink-0 h-[52px] px-3 sm:px-6 gap-2 border-b border-white/[0.06] bg-dark-900/50 flex items-center">
          <MenuButton nav={nav} />
          <h2 className="text-[13px] font-medium text-white/85 truncate">{title}</h2>
        </header>

        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <div
            className={`${maxWidth} mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-8`}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
