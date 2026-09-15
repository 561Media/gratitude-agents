import { redirect } from "next/navigation";

// The password login was replaced by Clerk email-code sign-in. Keep old links working.
export default function LoginPage() {
  redirect("/sign-in");
}
