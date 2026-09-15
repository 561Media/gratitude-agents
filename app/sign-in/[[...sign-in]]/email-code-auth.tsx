"use client";

import { useAuth, useSignIn, useSignUp } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Email-code sign-in for the Gratitude portal, ported from the 561 house
 * reference (lynnco-hub app/sign-in/[[...sign-in]]/email-code-auth.tsx).
 *
 * Differences from LynnCo, on purpose:
 * - No self-service sign-up. The Clerk instance is invitation-only
 *   (sign_up_mode "restricted"), so an unknown email gets a plain "ask for an
 *   invitation" answer instead of falling through to sign-up.
 * - Invitation links (?__clerk_ticket=...) are accepted here: the ticket proves
 *   the email, so the account is created without a code.
 * - A second-factor step (authenticator app or backup code) for accounts that
 *   have MFA turned on. Admins must, see lib/auth.ts requireAdmin.
 *
 * Built on the Clerk "future" custom-flow API exposed by @clerk/nextjs 7.x.
 */

type Step = "email" | "code" | "second_factor" | "ticket";

type LooseClerkError = {
  code?: string;
  message?: string;
  longMessage?: string;
  errors?: { code?: string; message?: string; longMessage?: string }[];
} | null;

function errorCode(err: LooseClerkError): string | undefined {
  return err?.code ?? err?.errors?.[0]?.code;
}

function errorMessage(err: LooseClerkError, fallback: string): string {
  const first = err?.errors?.[0];
  return first?.longMessage ?? first?.message ?? err?.longMessage ?? err?.message ?? fallback;
}

const NOT_INVITED =
  "This email is not set up for the Gratitude portal. Access is by invitation, so ask your portal admin to invite you.";

/** Only same-origin paths are honoured; redirect_url is attacker-controllable. */
function resolveDestination(): string {
  const target = new URLSearchParams(window.location.search).get("redirect_url");
  if (!target) return "/chat";
  try {
    const url = new URL(target, window.location.origin);
    if (url.origin !== window.location.origin) return "/chat";
    if (url.pathname.startsWith("/sign-in")) return "/chat";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/chat";
  }
}

const inputClasses =
  "w-full px-3.5 py-3 rounded-lg text-[15px] text-white bg-white/[0.05] border border-white/[0.12] placeholder:text-white/30 transition-[border-color,box-shadow] duration-200 focus:outline-none focus:border-brand-pink/60 focus:shadow-[0_0_0_3px_rgba(254,49,132,0.15)] disabled:opacity-60";

const primaryButtonClasses =
  "w-full mt-2 py-3 px-6 rounded-full font-semibold text-white text-[15px] transition-[transform,opacity] duration-200 disabled:opacity-40 disabled:cursor-not-allowed hover:-translate-y-0.5 active:translate-y-0";

const primaryButtonStyle = {
  background: "linear-gradient(135deg, #FE3184 0%, #FF6B35 50%, #ec7211 100%)",
  boxShadow: "0 10px 40px rgba(254, 49, 132, 0.28)",
};

const linkButtonClasses =
  "text-[13px] text-white/55 underline-offset-4 hover:text-white hover:underline disabled:opacity-40";

export function EmailCodeAuth() {
  const router = useRouter();
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const ready = !!signIn && !!signUp;
  const { isLoaded: authLoaded, isSignedIn } = useAuth();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ticketHandled = useRef(false);

  function goHome() {
    router.push(resolveDestination());
  }

  // Invitation links land here with a ticket. Accept it once Clerk has loaded.
  useEffect(() => {
    if (!signIn || !signUp || ticketHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const ticket = params.get("__clerk_ticket");
    if (!ticket) return;
    ticketHandled.current = true;

    const flow = params.get("__clerk_status") === "sign_in" ? "signin" : "signup";
    setStep("ticket");

    void (async () => {
      try {
        if (flow === "signin") {
          const res = await signIn.ticket({ ticket });
          if (res.error) throw res.error;
          if (signIn.status === "needs_second_factor") {
            setStep("second_factor");
            return;
          }
          const done = await signIn.finalize({ navigate: goHome });
          if (done.error) throw done.error;
        } else {
          const res = await signUp.ticket({ ticket });
          if (res.error) throw res.error;
          const done = await signUp.finalize({ navigate: goHome });
          if (done.error) throw done.error;
        }
      } catch (err) {
        const failure = errorCode(err as LooseClerkError);
        setStep("email");
        setError(
          failure === "session_exists"
            ? "You are already signed in. Sign out first to accept this invitation."
            : errorMessage(
                err as LooseClerkError,
                "This invitation link has expired or was already used. Ask your admin to resend it."
              )
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signIn, signUp]);

  // Returning visitors whose short-lived session token expired land here from
  // middleware even though Clerk still has a live session. Once clerk-js has
  // refreshed it, send them on instead of showing an email form they do not
  // need. Invitation links are handled by the ticket effect above.
  useEffect(() => {
    if (!authLoaded || !isSignedIn) return;
    if (new URLSearchParams(window.location.search).get("__clerk_ticket")) return;
    router.replace(resolveDestination());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoaded, isSignedIn]);

  function resetMessages() {
    setError(null);
    setNotice(null);
  }

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!signIn || busy) return;
    resetMessages();

    const identifier = email.trim();
    if (!identifier || !identifier.includes("@")) {
      setError("Enter your email address.");
      return;
    }

    setBusy(true);
    try {
      const created = await signIn.create({ identifier });
      if (created.error) {
        const failure = errorCode(created.error as LooseClerkError);
        if (failure === "session_exists" || failure === "identifier_already_signed_in") {
          goHome();
          return;
        }
        if (failure === "form_identifier_not_found" || failure === "not_allowed_access") {
          setNotice(NOT_INVITED);
          return;
        }
        setError(errorMessage(created.error as LooseClerkError, NOT_INVITED));
        return;
      }

      const sent = await signIn.emailCode.sendCode();
      if (sent.error) {
        setError(
          errorMessage(
            sent.error as LooseClerkError,
            "We could not send a code just now. Try again in a moment."
          )
        );
        return;
      }
      setCode("");
      setStep("code");
    } catch {
      setError("We could not send a code just now. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!signIn) return;
    const done = await signIn.finalize({ navigate: goHome });
    if (done.error) {
      setError("That did not finish signing in. Send a new code and try again.");
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!signIn || busy) return;
    resetMessages();

    const entered = code.trim();
    if (!/^\d{6}$/.test(entered)) {
      setError("Enter the 6-digit code we emailed you.");
      return;
    }

    setBusy(true);
    try {
      const verified = await signIn.emailCode.verifyCode({ code: entered });
      if (verified.error) {
        const failure = errorCode(verified.error as LooseClerkError);
        if (failure === "form_code_incorrect" || failure === "verification_failed") {
          setError("That code is not right. Check it and try again, or send a new one.");
        } else if (failure === "verification_expired") {
          setError("That code has expired. Send a new one and try again.");
        } else {
          setError(
            errorMessage(verified.error as LooseClerkError, "We could not verify that code. Send a new one.")
          );
        }
        return;
      }

      if (signIn.status === "needs_second_factor") {
        setCode("");
        setStep("second_factor");
        return;
      }

      await finish();
    } catch {
      setError("We could not verify that code. Send a new one.");
    } finally {
      setBusy(false);
    }
  }

  async function submitSecondFactor(e: React.FormEvent) {
    e.preventDefault();
    if (!signIn || busy) return;
    resetMessages();

    const entered = code.trim();
    if (!entered) {
      setError(useBackupCode ? "Enter one of your backup codes." : "Enter the code from your authenticator app.");
      return;
    }

    setBusy(true);
    try {
      const verified = useBackupCode
        ? await signIn.mfa.verifyBackupCode({ code: entered })
        : await signIn.mfa.verifyTOTP({ code: entered });
      if (verified.error) {
        setError(
          errorMessage(verified.error as LooseClerkError, "That code is not right. Try again.")
        );
        return;
      }
      await finish();
    } catch {
      setError("That code is not right. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!signIn || busy) return;
    resetMessages();
    setBusy(true);
    try {
      const sent = await signIn.emailCode.sendCode();
      if (sent.error) {
        setError("We could not send a new code. Go back and re-enter your email.");
        return;
      }
      setNotice("A new code is on its way.");
    } catch {
      setError("We could not send a new code. Go back and re-enter your email.");
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setStep("email");
    setCode("");
    setUseBackupCode(false);
    resetMessages();
  }

  const messages = (
    <>
      {error && (
        <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-300" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-[13px] text-white/75" role="status">
          {notice}
        </p>
      )}
    </>
  );

  if (step === "ticket") {
    return (
      <div className="space-y-4" aria-live="polite">
        <p className="text-[15px] text-white/70">Accepting your invitation.</p>
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/10 border-t-white/70" />
        <div id="clerk-captcha" />
      </div>
    );
  }

  if (step === "second_factor") {
    return (
      <form className="space-y-4" onSubmit={submitSecondFactor} noValidate>
        <p className="text-[14px] leading-relaxed text-white/65">
          {useBackupCode
            ? "Enter one of the backup codes you saved when you set up two-step verification."
            : "Open your authenticator app and enter the 6-digit code for Gratitude."}
        </p>
        <div className="space-y-1.5">
          <label htmlFor="eca-mfa" className="block text-[12px] font-medium text-white/55">
            {useBackupCode ? "Backup code" : "Authenticator code"}
          </label>
          <input
            id="eca-mfa"
            className={inputClasses}
            type="text"
            inputMode={useBackupCode ? "text" : "numeric"}
            autoComplete="one-time-code"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.trim())}
            disabled={busy}
          />
        </div>
        {messages}
        <button type="submit" className={primaryButtonClasses} style={primaryButtonStyle} disabled={busy || !ready}>
          {busy ? "Verifying" : "Verify and sign in"}
        </button>
        <div className="flex flex-wrap justify-between gap-3 pt-1">
          <button
            type="button"
            className={linkButtonClasses}
            onClick={() => {
              setUseBackupCode(!useBackupCode);
              setCode("");
              resetMessages();
            }}
            disabled={busy}
          >
            {useBackupCode ? "Use authenticator app" : "Use a backup code"}
          </button>
          <button type="button" className={linkButtonClasses} onClick={startOver} disabled={busy}>
            Start over
          </button>
        </div>
      </form>
    );
  }

  if (step === "code") {
    return (
      <form className="space-y-4" onSubmit={submitCode} noValidate>
        <p className="text-[14px] leading-relaxed text-white/65">
          We emailed a 6-digit code to <strong className="text-white">{email.trim()}</strong>.
          Enter it below to finish signing in.
        </p>
        <div className="space-y-1.5">
          <label htmlFor="eca-code" className="block text-[12px] font-medium text-white/55">
            Verification code
          </label>
          <input
            id="eca-code"
            className={`${inputClasses} tracking-[0.35em] text-center text-[20px]`}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            disabled={busy}
          />
          <p className="text-[12px] text-white/40">The code is good for a few minutes.</p>
        </div>
        {messages}
        <button type="submit" className={primaryButtonClasses} style={primaryButtonStyle} disabled={busy || !ready}>
          {busy ? "Verifying" : "Sign in"}
        </button>
        <div className="flex flex-wrap justify-between gap-3 pt-1">
          <button type="button" className={linkButtonClasses} onClick={resend} disabled={busy || !ready}>
            Resend code
          </button>
          <button type="button" className={linkButtonClasses} onClick={startOver} disabled={busy}>
            Use a different email
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className="space-y-4" onSubmit={submitEmail} noValidate>
      <div className="space-y-1.5">
        <label htmlFor="eca-email" className="block text-[12px] font-medium text-white/55">
          Work email
        </label>
        <input
          id="eca-email"
          className={inputClasses}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@gratitude.com"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
        />
      </div>
      {messages}
      <button type="submit" className={primaryButtonClasses} style={primaryButtonStyle} disabled={busy || !ready}>
        {busy ? "Sending" : ready ? "Email me a code" : "Loading"}
      </button>
      {/* Clerk mounts its bot check here when it needs one. */}
      <div id="clerk-captcha" />
    </form>
  );
}
