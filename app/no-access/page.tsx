import Image from "next/image";
import { SignOutButton } from "@clerk/nextjs";

export const metadata = {
  title: "No access | Gratitude",
};

// Reached when someone is signed in to Clerk but their portal account is
// missing, disabled or already linked to a different sign-in.
export default function NoAccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-dark-950 px-6 text-white">
      <div className="w-full max-w-md">
        <Image src="/gratitude-white.svg" alt="Gratitude" width={150} height={30} priority />
        <h1 className="mt-10 font-display uppercase text-[40px] leading-[0.95]">
          No access
        </h1>
        <p className="mt-5 text-[15px] leading-relaxed text-white/65">
          This account is not active in the Gratitude portal. It may have been disabled,
          or the invitation was never accepted. Ask your portal admin to check your access.
        </p>
        <SignOutButton redirectUrl="/sign-in">
          <button
            type="button"
            className="mt-8 rounded-full px-6 py-3 text-[14px] font-semibold text-white"
            style={{ background: "linear-gradient(135deg, #FE3184 0%, #FF6B35 50%, #ec7211 100%)" }}
          >
            Sign out and use another email
          </button>
        </SignOutButton>
      </div>
    </main>
  );
}
