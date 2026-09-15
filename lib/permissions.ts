import type {
  Conversation,
  KnowledgebaseEntry,
  Resource,
} from "@/db/schema";
import type { SessionUser } from "@/lib/auth";
import { sql, type SQL } from "drizzle-orm";

export function isPrivilegedUser(user: SessionUser) {
  return user.role === "admin" || user.role === "employee";
}

export function canEditUsers(user: SessionUser) {
  return user.role === "admin";
}

export function canAccessConversation(user: SessionUser, conversation: Conversation) {
  if (isPrivilegedUser(user)) {
    return true;
  }

  if (conversation.ownerId && conversation.ownerId === user.userId) {
    return true;
  }

  return conversation.visibility === "partner";
}

// Appending messages is a write - only the owner (or an admin) may continue a
// conversation. canAccessConversation is a VIEW check and must not gate writes:
// it returns true for any privileged user on any conversation, and for any
// partner on any partner-visible conversation.
export function canWriteConversation(user: SessionUser, conversation: Conversation) {
  return user.role === "admin" || conversation.ownerId === user.userId;
}

export function canDeleteConversation(user: SessionUser, conversation: Conversation) {
  return user.role === "admin" || conversation.ownerId === user.userId;
}

export function canViewKnowledgeEntry(user: SessionUser, entry: KnowledgebaseEntry) {
  if (isPrivilegedUser(user)) {
    return true;
  }

  if (entry.ownerId && entry.ownerId === user.userId) {
    return true;
  }

  return entry.visibility === "partner" && entry.status === "approved";
}

export function canEditKnowledgeEntry(user: SessionUser, entry: KnowledgebaseEntry) {
  if (isPrivilegedUser(user)) {
    return true;
  }

  return entry.ownerId === user.userId && entry.status !== "approved";
}

export function canPublishKnowledgeEntry(user: SessionUser) {
  return isPrivilegedUser(user);
}

export function canViewResource(user: SessionUser, resource: Resource) {
  if (isPrivilegedUser(user)) {
    return true;
  }

  if (resource.ownerId === user.userId) {
    return true;
  }

  return resource.visibility === "partner" && resource.status === "published";
}

/**
 * SQL form of canViewResource, for queries against the `resources` table.
 * Keep the two in lockstep: anything a prompt may mention (titles,
 * descriptions, links) must be downloadable by the same user.
 */
export function resourceAccessSql(user: SessionUser): SQL {
  if (isPrivilegedUser(user)) {
    return sql`TRUE`;
  }
  return sql`(owner_id = ${user.userId} OR (visibility = 'partner' AND status = 'published'))`;
}

export function canEditResource(user: SessionUser, resource: Resource) {
  if (isPrivilegedUser(user)) {
    return true;
  }

  return resource.ownerId === user.userId && resource.status !== "published";
}

export function canPublishResource(user: SessionUser) {
  return isPrivilegedUser(user);
}

export function defaultVisibilityForRole(user: SessionUser) {
  return isPrivilegedUser(user) ? "internal" : "private";
}
