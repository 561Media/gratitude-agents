import {
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
  jsonb,
  pgEnum,
  integer,
  vector,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", [
  "admin",
  "employee",
  "partner",
]);

export const recordVisibilityEnum = pgEnum("record_visibility", [
  "private",
  "internal",
  "partner",
]);

export const knowledgeCategoryEnum = pgEnum("knowledge_category", [
  "campaign_result",
  "sponsor_info",
  "content_insight",
  "strategy_learning",
  "design_pattern",
  "general",
]);

export const knowledgeStatusEnum = pgEnum("knowledge_status", [
  "draft",
  "review",
  "approved",
]);

export const resourceTypeEnum = pgEnum("resource_type", [
  "upload",
  "generated",
  "link",
]);

export const resourceStatusEnum = pgEnum("resource_status", [
  "draft",
  "published",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  // Legacy bcrypt hash from the pre-Clerk login. Nullable since the Clerk
  // migration (0002); nothing reads it. Drop it once production cutover is done.
  passwordHash: text("password_hash"),
  // Clerk user id (user_...). Bound on first sign-in by verified email, or by
  // scripts/migrate-users-to-clerk.mjs. Authorization still comes from `role`
  // and `active` on this row, never from Clerk claims.
  clerkUserId: text("clerk_user_id").unique(),
  role: userRoleEnum("role").default("partner").notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").references(() => users.id, {
    onDelete: "set null",
  }),
  agentId: text("agent_id").notNull(),
  title: text("title"),
  visibility: recordVisibilityEnum("visibility").default("private").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  enriched: boolean("enriched").default(false).notNull(),
  // Watermark: how many messages have been through enrichment. Replaces the
  // once-ever `enriched` boolean so long conversations keep contributing.
  enrichedThrough: integer("enriched_through").default(0).notNull(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .references(() => conversations.id, { onDelete: "cascade" })
    .notNull(),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const knowledgebaseEntries = pgTable("knowledgebase_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").references(() => conversations.id, {
    onDelete: "set null",
  }),
  ownerId: uuid("owner_id").references(() => users.id, {
    onDelete: "set null",
  }),
  agentId: text("agent_id").notNull(),
  category: knowledgeCategoryEnum("category").notNull(),
  status: knowledgeStatusEnum("status").default("draft").notNull(),
  visibility: recordVisibilityEnum("visibility").default("internal").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  tags: jsonb("tags").$type<string[]>().default([]),
  sourceType: text("source_type").default("manual").notNull(),
  sourceResourceId: uuid("source_resource_id"),
  // Semantic retrieval (Gemini text-embedding-004, 768 dims)
  embedding: vector("embedding", { dimensions: 768 }),
  // Freshness: campaign results and sponsor info age out; evergreen entries stay null
  expiresAt: timestamp("expires_at"),
  // Quality signals: how often this entry has been injected into prompts
  usageCount: integer("usage_count").default(0).notNull(),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const resources = pgTable("resources", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  conversationId: uuid("conversation_id").references(() => conversations.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  description: text("description"),
  type: resourceTypeEnum("type").default("upload").notNull(),
  status: resourceStatusEnum("status").default("draft").notNull(),
  visibility: recordVisibilityEnum("visibility").default("internal").notNull(),
  fileName: text("file_name"),
  mimeType: text("mime_type"),
  extension: text("extension"),
  sizeBytes: integer("size_bytes"),
  externalUrl: text("external_url"),
  textContent: text("text_content"),
  binaryContentBase64: text("binary_content_base64"),
  // Vercel Blob URL - new files/images store here; binaryContentBase64 remains
  // only as a legacy fallback for rows created before the blob migration
  blobUrl: text("blob_url"),
  tags: jsonb("tags").$type<string[]>().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Server-owned upload intents. The server picks the object key
// (uploads/<userId>/<intentId>/<name>), the Blob client token is bound to the
// intent, and a resource row may only be created from an intent the same user
// owns. One intent = one file = one resource.
export const blobUploadStatusEnum = pgEnum("blob_upload_status", [
  "pending",
  "uploaded",
  "linked",
  "rejected",
]);

export const blobUploads = pgTable(
  "blob_uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    purpose: text("purpose", { enum: ["resource", "chat"] }).notNull(),
    pathname: text("pathname").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    maxBytes: integer("max_bytes").notNull(),
    status: blobUploadStatusEnum("status").default("pending").notNull(),
    blobUrl: text("blob_url"),
    resourceId: uuid("resource_id").references(() => resources.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("blob_uploads_user_idx").on(t.userId, t.createdAt)]
);

// Fixed-window per-user counters for abuse budgets (lib/rate-limit.ts)
export const usageCounters = pgTable(
  "usage_counters",
  {
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    bucket: text("bucket").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").default(0).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.bucket, t.windowStart] })]
);

export type User = typeof users.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type KnowledgebaseEntry = typeof knowledgebaseEntries.$inferSelect;
export type Resource = typeof resources.$inferSelect;
export type BlobUpload = typeof blobUploads.$inferSelect;
