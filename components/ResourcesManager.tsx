"use client";

import { useEffect, useState } from "react";
import { PortalUploadError, uploadFileToPortal } from "@/lib/client-upload";
import { toast } from "./Toaster";
import ConfirmDialog from "./ConfirmDialog";

// Example categories let the team submit reference material (images, decks,
// ads) that future work draws from. Stored as tags so no schema change needed.
type ExampleKind = "example:image" | "example:deck" | "example:ad";
type ResourceKind = "file" | ExampleKind;

const KIND_OPTIONS: { value: ResourceKind; label: string }[] = [
  { value: "file", label: "General file" },
  { value: "example:image", label: "Example - Image" },
  { value: "example:deck", label: "Example - Deck" },
  { value: "example:ad", label: "Example - Ad" },
];

const KIND_LABELS: Record<string, string> = {
  "example:image": "Image example",
  "example:deck": "Deck example",
  "example:ad": "Ad example",
};

const KIND_ACCEPT: Record<ResourceKind, string> = {
  file: ".md,.markdown,.txt,.doc,.docx,.pdf,.png,.jpg,.jpeg,.webp,.gif,.svg,.ppt,.pptx,.xls,.xlsx,.csv",
  "example:image": ".png,.jpg,.jpeg,.webp,.gif,.svg",
  "example:deck": ".pdf,.ppt,.pptx,.key",
  "example:ad": ".png,.jpg,.jpeg,.webp,.gif,.mp4,.mov,.pdf",
};

// Files upload browser -> Vercel Blob directly (not through the serverless
// function), so the cap is generous. Matches the token route's limit.
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

interface ResourceItem {
  id: string;
  title: string;
  description: string | null;
  fileName: string | null;
  mimeType: string | null;
  visibility: "private" | "internal" | "partner";
  status: "draft" | "published";
  type: "upload" | "generated" | "link";
  tags: string[];
  updatedAt: string;
}

interface SessionResponse {
  user: {
    role: "admin" | "employee" | "partner";
  };
}

export default function ResourcesManager() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "published">("all");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"private" | "internal" | "partner">("internal");
  const [tags, setTags] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [kind, setKind] = useState<ResourceKind>("file");
  const [kindFilter, setKindFilter] = useState<"all" | ExampleKind>("all");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function loadResources() {
    const [sessionRes, resourcesRes] = await Promise.all([
      fetch("/api/session"),
      fetch("/api/resources"),
    ]);

    if (sessionRes.ok) {
      const sessionData = await sessionRes.json();
      setSession(sessionData);
      if (sessionData.user.role === "partner") {
        setVisibility("private");
      }
    }

    if (resourcesRes.ok) {
      setResources(await resourcesRes.json());
    }
  }

  useEffect(() => {
    void loadResources();
  }, []);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (files.length === 0 && !title.trim()) return;

    // Fold the example category into tags so filtering works with no schema change
    const tagString = [tags, kind !== "file" ? kind : ""]
      .filter(Boolean)
      .join(",");

    const oversized = files.find((f) => f.size > MAX_UPLOAD_BYTES);
    if (oversized) {
      toast(`"${oversized.name}" is over the 100MB upload limit.`);
      return;
    }

    setSaving(true);

    try {
      if (files.length > 0) {
        let failed = 0;
        for (const f of files) {
          try {
            // Upload straight to private Vercel Blob (bypasses the serverless
            // body limit); the server verifies the object, then records it
            await uploadFileToPortal(f, "resource", {
              // Multi-file: title applies to a single file, otherwise use filenames
              title:
                files.length === 1
                  ? title || f.name
                  : title
                    ? `${title} - ${f.name}`
                    : f.name,
              description,
              visibility,
              tags: tagString.split(",").map((t) => t.trim()).filter(Boolean),
            });
          } catch (err) {
            failed++;
            toast(err instanceof PortalUploadError ? err.message : `Upload failed for "${f.name}".`);
          }
        }
        if (failed === 0) {
          toast(
            files.length === 1
              ? "File uploaded."
              : `${files.length} files uploaded.`
          );
        }
      } else {
        const formData = new FormData();
        formData.set("title", title);
        formData.set("description", description);
        formData.set("visibility", visibility);
        formData.set("tags", tagString);

        const res = await fetch("/api/resources", { method: "POST", body: formData });
        if (!res.ok) {
          toast("Upload failed. Please try again.");
        }
      }

      setTitle("");
      setDescription("");
      setTags("");
      setFiles([]);
      await loadResources();
    } catch {
      toast("Upload failed. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish(resource: ResourceItem) {
    await fetch(`/api/resources/${resource.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "published",
        visibility: resource.visibility === "private" ? "partner" : resource.visibility,
      }),
    });
    await loadResources();
  }

  // Two-step delete via non-blocking dialog. window.confirm() froze the main
  // thread for the dialog's lifetime and was flagged as a 1.3s INP violation.
  function handleDelete(id: string) {
    setConfirmDeleteId(id);
  }

  async function confirmDelete() {
    const id = confirmDeleteId;
    setConfirmDeleteId(null);
    if (!id) return;
    const res = await fetch(`/api/resources/${id}`, { method: "DELETE" });
    if (!res.ok) toast("Delete failed. Please try again.");
    await loadResources();
  }

  const canPublish = session?.user.role === "admin" || session?.user.role === "employee";
  const filteredResources = resources.filter((resource) => {
    const matchesQuery = !query.trim()
      || resource.title.toLowerCase().includes(query.toLowerCase())
      || resource.description?.toLowerCase().includes(query.toLowerCase())
      || resource.tags?.some((tag) => tag.toLowerCase().includes(query.toLowerCase()));
    const matchesStatus = statusFilter === "all" || resource.status === statusFilter;
    const matchesKind = kindFilter === "all" || resource.tags?.includes(kindFilter);
    return matchesQuery && matchesStatus && matchesKind;
  });

  return (
    <div className="space-y-8">
      <form
        onSubmit={handleUpload}
        className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-4"
      >
        <div>
          <h2 className="text-[14px] font-medium text-white/85 mb-1">Add a file</h2>
          <p className="text-[13px] text-white/40 leading-relaxed">
            Upload files or examples of images, decks, and ads you want future work to learn from. Pick a kind, add a few tags, and the team can find them here.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Resource title"
            className="px-3.5 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/80 placeholder:text-white/25 focus:outline-none focus:border-white/[0.14] transition-colors"
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as ResourceKind)}
            className="px-3.5 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/80 placeholder:text-white/25 focus:outline-none focus:border-white/[0.14] transition-colors"
            title="What kind of upload is this?"
          >
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as "private" | "internal" | "partner")}
            className="px-3.5 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/80 placeholder:text-white/25 focus:outline-none focus:border-white/[0.14] transition-colors"
          >
            {/* Partners can only upload private files (server enforces this) -
                don't show options that would silently be overridden */}
            <option value="private">Private</option>
            {session?.user.role !== "partner" && (
              <>
                <option value="internal">Internal</option>
                <option value="partner">Partner</option>
              </>
            )}
          </select>
        </div>

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What is this file for?"
          rows={3}
          className="w-full px-3.5 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/80 placeholder:text-white/25 focus:outline-none focus:border-white/[0.14] transition-colors"
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="proposal, sponsor, deck"
            className="px-3.5 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/80 placeholder:text-white/25 focus:outline-none focus:border-white/[0.14] transition-colors"
          />
          <input
            type="file"
            multiple
            accept={KIND_ACCEPT[kind]}
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
            className="px-3.5 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/50 file:mr-3 file:rounded-md file:border-0 file:bg-white/[0.06] file:px-2.5 file:py-1 file:text-[12px] file:text-white/70 focus:outline-none focus:border-white/[0.14] transition-colors"
          />
        </div>

        {files.length > 1 && (
          <p className="text-[12px] text-white/35">
            {files.length} files selected. Each uploads as its own resource (100MB max per file).
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="px-5 py-2.5 rounded-full text-[13px] font-semibold text-white transition-all duration-200 disabled:opacity-40 hover:-translate-y-0.5 active:translate-y-0"
          style={{
            background: "linear-gradient(135deg, #FE3184 0%, #FF6B35 50%, #ec7211 100%)",
            boxShadow: "0 4px 20px rgba(254, 49, 132, 0.2)",
          }}
        >
          {saving
            ? "Uploading..."
            : files.length > 1
              ? `Upload ${files.length} Files`
              : "Add Resource"}
        </button>
      </form>

      <div className="rounded-xl border border-white/[0.06] p-5 bg-white/[0.02]">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 justify-between">
          <div>
            <h3 className="text-[14px] font-medium text-white/85">Browse saved files</h3>
            <p className="text-[13px] text-white/40 mt-1">
              Search by title, description, or tags. Publish only the files that should be visible beyond the creator.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search files"
              className="px-3.5 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/80 placeholder:text-white/25 focus:outline-none focus:border-white/[0.14] transition-colors"
            />
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as "all" | ExampleKind)}
              className="px-3.5 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/80 placeholder:text-white/25 focus:outline-none focus:border-white/[0.14] transition-colors"
            >
              <option value="all">All kinds</option>
              <option value="example:image">Image examples</option>
              <option value="example:deck">Deck examples</option>
              <option value="example:ad">Ad examples</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "all" | "draft" | "published")}
              className="px-3.5 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/80 placeholder:text-white/25 focus:outline-none focus:border-white/[0.14] transition-colors"
            >
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select>
          </div>
        </div>
      </div>

      {filteredResources.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/[0.1] p-10 text-center bg-white/[0.01]">
          <h3 className="text-[14px] font-medium text-white/75 mb-1.5">No files to show</h3>
          <p className="text-[13px] text-white/35 max-w-xl mx-auto leading-relaxed">
            Upload a file, save an agent output from chat, or widen your filters to see more documents in the shared library.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filteredResources.map((resource) => (
          <div
            key={resource.id}
            className="rounded-xl border border-white/[0.06] p-5 bg-white/[0.02] transition-colors hover:border-white/[0.1]"
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <h3 className="text-[14px] font-medium text-white/90">{resource.title}</h3>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <span className="text-[10px] uppercase tracking-wider text-white/30 border border-white/[0.06] rounded-md px-1.5 py-0.5">
                    {resource.type}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-white/30 border border-white/[0.06] rounded-md px-1.5 py-0.5">
                    {resource.status}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-white/30 border border-white/[0.06] rounded-md px-1.5 py-0.5">
                    {resource.visibility}
                  </span>
                </div>
              </div>
              <a
                href={`/api/resources/${resource.id}/download`}
                className="flex items-center gap-1.5 shrink-0 text-[12px] text-white/45 hover:text-white transition-colors"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download
              </a>
            </div>

            {resource.description && (
              <p className="text-[13px] text-white/45 leading-relaxed mb-4">{resource.description}</p>
            )}

            <div className="flex flex-wrap gap-1.5 mb-4">
              {resource.tags?.map((tag) => (
                <span
                  key={tag}
                  className={`text-[11px] px-2 py-0.5 rounded-md border ${
                    KIND_LABELS[tag]
                      ? "border-brand-pink/20 text-brand-pink/70 bg-brand-pink/[0.05]"
                      : "border-white/[0.06] text-white/40"
                  }`}
                >
                  {KIND_LABELS[tag] || tag}
                </span>
              ))}
            </div>

            <div className="flex items-center justify-between text-[12px] text-white/30">
              <span className="truncate">{resource.fileName || resource.mimeType || "Stored output"}</span>
              <span className="shrink-0 ml-3">{new Date(resource.updatedAt).toLocaleDateString()}</span>
            </div>

            <div className="flex gap-2 mt-4">
              {canPublish && resource.status !== "published" && (
                <button
                  onClick={() => void handlePublish(resource)}
                  className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-brand-pink/25 text-brand-pink/80 hover:bg-brand-pink/[0.06] hover:text-brand-pink transition-colors"
                >
                  Publish
                </button>
              )}
              <button
                onClick={() => void handleDelete(resource.id)}
                className="px-3 py-1.5 rounded-lg text-[12px] border border-white/[0.06] text-white/40 hover:text-red-400 hover:border-red-400/20 hover:bg-red-400/[0.05] transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete this file?"
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
