import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Public liveness check. Reveals nothing about users or configuration.
export function GET() {
  return NextResponse.json({ ok: true });
}
