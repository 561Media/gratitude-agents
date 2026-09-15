import Image from "next/image";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { EmailCodeAuth } from "./email-code-auth";

export const metadata = {
  title: "Sign in | Gratitude",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Already signed in: Clerk refuses a second sign-in, so send them in. An
  // invitation link is the exception; let the form explain that case.
  const params = await searchParams;
  const { userId } = await auth();
  if (userId && !params.__clerk_ticket) redirect("/chat");

  return (
    <main className="relative min-h-screen overflow-hidden bg-dark-950 text-white">
      <div className="absolute inset-0 bg-grid opacity-25 pointer-events-none" aria-hidden />
      <div
        className="absolute -top-40 -left-32 h-[520px] w-[520px] rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(circle, rgba(254, 49, 132, 0.22) 0%, transparent 70%)",
          filter: "blur(90px)",
        }}
        aria-hidden
      />
      <div
        className="absolute -bottom-48 right-[-10%] h-[520px] w-[520px] rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(circle, rgba(236, 114, 17, 0.16) 0%, transparent 70%)",
          filter: "blur(90px)",
        }}
        aria-hidden
      />

      <div className="relative z-10 mx-auto grid min-h-screen w-full max-w-6xl grid-cols-1 items-center gap-12 px-6 py-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-20 lg:px-12">
        <section className="max-w-xl">
          <Image
            src="/gratitude-white.svg"
            alt="Gratitude"
            width={176}
            height={35}
            priority
            className="h-auto w-[150px] sm:w-[176px]"
          />

          <h1 className="mt-10 font-display uppercase leading-[0.95] tracking-[-0.01em] text-[44px] sm:text-[64px] lg:text-[76px]">
            Your agents
            <br />
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage: "linear-gradient(100deg, #FE3184 0%, #FF6B35 55%, #ec7211 100%)",
              }}
            >
              are waiting.
            </span>
          </h1>

          <div
            className="mt-7 h-[3px] w-20 rounded-full"
            style={{ background: "linear-gradient(90deg, #FE3184, #ec7211)" }}
            aria-hidden
          />

          <p className="mt-7 max-w-md text-[16px] leading-relaxed text-white/65">
            The Gratitude team workspace for marketing and design agents. Enter your
            work email and we will send you a six-digit sign-in code. There is no
            password to remember.
          </p>
          <p className="mt-4 max-w-md text-[13px] leading-relaxed text-white/40">
            Access is by invitation only. If you should be here and cannot get in,
            ask your Gratitude portal admin to invite you.
          </p>
        </section>

        <section
          className="w-full max-w-md justify-self-center rounded-2xl p-7 sm:p-9 lg:justify-self-end"
          style={{
            background: "linear-gradient(180deg, rgba(26, 26, 26, 0.92) 0%, rgba(10, 10, 10, 0.92) 100%)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            boxShadow: "0 24px 70px rgba(0, 0, 0, 0.5)",
          }}
        >
          <h2 className="font-display uppercase text-[26px] leading-none tracking-[0.01em]">
            Sign in
          </h2>
          <div className="mt-6">
            <EmailCodeAuth />
          </div>
        </section>
      </div>
    </main>
  );
}
