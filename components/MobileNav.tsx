"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** id of the sidebar element; the menu button's aria-controls points here. */
export const SIDEBAR_ID = "app-sidebar";

const DESKTOP_QUERY = "(min-width: 768px)"; // Tailwind md

export interface MobileNavState {
  open: boolean;
  openNav: () => void;
  /** Closes the drawer and returns focus to the menu button. */
  closeNav: () => void;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
}

/**
 * Open/closed state for the off-canvas sidebar used below the md breakpoint.
 * The page owns it so the menu button (in the page's top bar) and the
 * sidebar (the drawer) share one source of truth.
 */
export function useMobileNav(): MobileNavState {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const openNav = useCallback(() => setOpen(true), []);
  const closeNav = useCallback(() => {
    setOpen(false);
    // Wait for the drawer to become non-interactive before moving focus back
    requestAnimationFrame(() => buttonRef.current?.focus());
  }, []);

  // Growing past the breakpoint turns the drawer back into the static
  // sidebar; drop the open state so it does not reappear as a modal later
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => {
      if (mq.matches) setOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return { open, openNav, closeNav, buttonRef };
}

/** True at md and up. False during SSR and the first client render. */
export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return desktop;
}

/** Hamburger button shown in the slim top bar below md. */
export function MenuButton({ nav }: { nav: MobileNavState }) {
  return (
    <button
      ref={nav.buttonRef}
      type="button"
      onClick={nav.openNav}
      aria-expanded={nav.open}
      aria-controls={SIDEBAR_ID}
      aria-label="Open menu"
      className="md:hidden -ml-2 w-10 h-10 shrink-0 flex items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-pink/70 transition-colors"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
        <line x1="4" y1="7" x2="20" y2="7" />
        <line x1="4" y1="12" x2="20" y2="12" />
        <line x1="4" y1="17" x2="20" y2="17" />
      </svg>
    </button>
  );
}
