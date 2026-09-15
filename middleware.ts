import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Closed by default: every route needs a Clerk session except the ones named
 * here. This is the optimistic check only. Whether the person may use the
 * portal (active account, current role) is decided per request in lib/auth.ts
 * against the database.
 */
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  // Old bookmarks; the page just redirects to /sign-in.
  "/login",
  "/no-access",
  "/api/health",
  // Clerk may serve clerk-js and its Frontend API same-origin through /__clerk.
  // Gating it redirects the script itself to /sign-in and nobody can sign in.
  // House rule, see docs/auth.md.
  "/__clerk(.*)",
]);

const isApiRoute = createRouteMatcher(["/api(.*)"]);

export default clerkMiddleware(
  async (auth, req) => {
    if (isPublicRoute(req)) return;

    const { userId, redirectToSignIn } = await auth();
    if (userId) return;

    // APIs answer in JSON. An HTML redirect makes fetch() callers parse a page.
    if (isApiRoute(req)) {
      return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
    }

    return redirectToSignIn({ returnBackUrl: req.url });
  },
  { signInUrl: "/sign-in", signUpUrl: "/sign-in" }
);

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
