import { UserProfile } from "@clerk/nextjs";
import AppShell from "@/components/AppShell";

// Account security: email address and two-step verification (authenticator app
// plus backup codes). Admins must turn on an authenticator app before admin
// actions work; see lib/auth.ts requireAdmin.
export default function AccountPage() {
  return (
    <AppShell title="Account" maxWidth="max-w-4xl">
      <div>
        <h1 className="font-display uppercase text-[26px] sm:text-[30px] leading-[1.05] text-white mb-2">
          Account
        </h1>
        <p className="mb-6 max-w-2xl text-[14px] text-white/50">
          Turn on two-step verification under Security. After you add an authenticator
          app, sign out and sign back in so the current session counts as verified.
        </p>
        <UserProfile
          path="/account"
          routing="path"
          appearance={{ variables: { colorPrimary: "#FE3184" } }}
        />
      </div>
    </AppShell>
  );
}
