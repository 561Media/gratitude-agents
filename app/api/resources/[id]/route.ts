import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { resources } from "@/db/schema";
import { getSession } from "@/lib/auth";
import {
  canEditResource,
  canPublishResource,
  canViewResource,
  defaultVisibilityForRole,
} from "@/lib/permissions";
import { deleteStoredBlob } from "@/lib/blob-store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const [resource] = await db.select().from(resources).where(eq(resources.id, id));

  if (!resource) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!canViewResource(session, resource)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(resource);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const [resource] = await db.select().from(resources).where(eq(resources.id, id));

  if (!resource) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!canEditResource(session, resource)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const [updated] = await db
    .update(resources)
    .set({
      ...(body.title && { title: body.title }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.textContent !== undefined && { textContent: body.textContent }),
      ...(body.tags && { tags: body.tags }),
      ...(body.fileName && { fileName: body.fileName }),
      ...(body.mimeType && { mimeType: body.mimeType }),
      ...(body.extension && { extension: body.extension }),
      ...(body.visibility && {
        visibility: canPublishResource(session)
          ? body.visibility
          : defaultVisibilityForRole(session),
      }),
      ...(body.status &&
        canPublishResource(session) && { status: body.status }),
      updatedAt: new Date(),
    })
    .where(eq(resources.id, id))
    .returning();

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const [resource] = await db.select().from(resources).where(eq(resources.id, id));

  if (!resource) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!canEditResource(session, resource)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.delete(resources).where(eq(resources.id, id));

  // Remove the stored object too. Row first: a leftover private object is
  // unreachable, while a row pointing at a deleted object is a broken file.
  if (resource.blobUrl) {
    await deleteStoredBlob(resource.blobUrl);
  }

  return NextResponse.json({ success: true });
}
