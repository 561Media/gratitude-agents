"use client";

import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { toast } from "./Toaster";
import { extractSlides } from "@/lib/slide-schema";

type ExportFormat = "md" | "docx" | "pdf" | "pptx" | "csv" | "xlsx";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  agentName?: string;
  conversationId?: string | null;
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-all"
      title={label || "Copy"}
    >
      {copied ? (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
          {label || "Copy"}
        </>
      )}
    </button>
  );
}

function DownloadButton({
  content,
  title,
  format,
}: {
  content: string;
  title: string;
  format: ExportFormat;
}) {
  async function handleDownload() {
    let res: Response;
    try {
      res = await fetch("/api/exports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, title, format }),
      });
    } catch {
      toast(`${format.toUpperCase()} export failed. Check your connection and try again.`);
      return;
    }

    if (!res.ok) {
      toast(`${format.toUpperCase()} export failed. Please try again.`);
      return;
    }

    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="([^"]+)"/);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = match?.[1] || `${title}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      onClick={handleDownload}
      className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-all"
      title="Download as file"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      {format.toUpperCase()}
    </button>
  );
}

function SaveButton({
  content,
  title,
  conversationId,
}: {
  content: string;
  title: string;
  conversationId?: string | null;
}) {
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);

    try {
      const res = await fetch("/api/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: "Saved from agent output",
          type: "generated",
          fileName: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "gratitude-output"}.md`,
          mimeType: "text/markdown; charset=utf-8",
          extension: "md",
          conversationId,
          textContent: content,
          tags: ["agent-output"],
        }),
      });
      toast(res.ok ? "Saved to your files." : "Save failed. Please try again.");
    } catch {
      toast("Save failed. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      onClick={handleSave}
      className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-all"
      title="Save to resource library"
      disabled={saving}
    >
      {saving ? "Saving..." : "Save"}
    </button>
  );
}

type ContentType = "document" | "spreadsheet" | "presentation";

function detectContentType(content: string): ContentType {
  // Slide JSON (presentation), every slide validated
  if (extractSlides(content)) return "presentation";

  // Check for CSV data
  const csvMatch = content.match(/```(?:csv)?\s*\n([\s\S]*?)\n```/);
  if (csvMatch) return "spreadsheet";

  // Check for unlabeled CSV-like content in a code block
  const codeMatch = content.match(/```\s*\n([\s\S]*?)\n```/);
  if (codeMatch) {
    const lines = codeMatch[1].trim().split("\n");
    if (lines.length > 2 && lines.every((l) => !l.trim() || l.split(",").length > 2)) {
      return "spreadsheet";
    }
  }

  return "document";
}

function MessageExportButtons({
  content,
  agentName,
  conversationId,
}: {
  content: string;
  agentName: string;
  conversationId?: string | null;
}) {
  const type = detectContentType(content);
  const title = type === "presentation" ? extractSlides(content)?.title || `${agentName} Presentation` : `${agentName} Output`;

  if (type === "presentation") {
    return (
      <>
        <DownloadButton content={content} title={title} format="pptx" />
        <DownloadButton content={content} title={title} format="pdf" />
        <SaveButton content={content} title={title} conversationId={conversationId} />
      </>
    );
  }

  if (type === "spreadsheet") {
    return (
      <>
        <DownloadButton content={content} title={title} format="csv" />
        <DownloadButton content={content} title={title} format="xlsx" />
        <SaveButton content={content} title={title} conversationId={conversationId} />
      </>
    );
  }

  // Document - standard text content
  return (
    <>
      <DownloadButton content={content} title={title} format="md" />
      <DownloadButton content={content} title={title} format="docx" />
      <DownloadButton content={content} title={title} format="pdf" />
      <SaveButton content={content} title={title} conversationId={conversationId} />
    </>
  );
}

function CsvDownloadButton({ text, fileName }: { text: string; fileName?: string }) {
  function handleDownload() {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName || `gratitude-export-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      onClick={handleDownload}
      className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-all"
      title="Download as CSV"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      CSV
    </button>
  );
}

function XlsxDownloadButton({ text, title }: { text: string; title?: string }) {
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await fetch("/api/exports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: text,
          title: title || "Gratitude Export",
          format: "xlsx",
        }),
      });
      if (!res.ok) {
        toast("Excel export failed. Please try again.");
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = match?.[1] || `gratitude-export-${Date.now()}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <button
      onClick={handleDownload}
      disabled={downloading}
      className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-brand-pink/70 hover:text-brand-pink hover:bg-brand-pink/[0.08] transition-all disabled:opacity-50"
      title="Download as branded Excel"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      {downloading ? "..." : "Excel"}
    </button>
  );
}

function CodeBlock({ children, className }: { children: string; className?: string }) {
  const language = className?.replace("language-", "") || "";
  const isCsv = language === "csv" || (!language && children.includes(",") && children.split("\n").length > 2 && children.split("\n").every((line) => !line.trim() || line.split(",").length > 1));

  return (
    <div className="relative group/code my-3 rounded-lg overflow-hidden border border-white/[0.06]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-white/[0.03] border-b border-white/[0.04]">
        <span className="text-[10px] font-medium uppercase tracking-wider text-white/25">
          {language || (isCsv ? "csv" : "code")}
        </span>
        <div className="flex items-center gap-1">
          {isCsv && (
            <>
              <CsvDownloadButton text={children} />
              <XlsxDownloadButton text={`\`\`\`csv\n${children}\n\`\`\``} />
            </>
          )}
          <CopyButton text={children} label="Copy code" />
        </div>
      </div>
      {/* Code */}
      <pre className="!m-0 !rounded-none !border-0 overflow-x-auto">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

export default function ChatMessage({
  role,
  content,
  isStreaming,
  agentName = "Gratitude Agent",
  conversationId,
}: ChatMessageProps) {
  if (role === "user") {
    return (
      <div className="flex justify-end group/msg">
        <div className="max-w-[75%] px-4 py-3 rounded-2xl rounded-br-md text-white/90 text-[15px] leading-relaxed bg-white/[0.06] border border-white/[0.07]">
          <div className="whitespace-pre-wrap">{content}</div>
        </div>
      </div>
    );
  }

  const components: Components = {
    code({ className, children, ...props }) {
      const isBlock = className?.startsWith("language-") ||
        (typeof children === "string" && children.includes("\n"));

      if (isBlock) {
        return (
          <CodeBlock className={className}>
            {String(children).replace(/\n$/, "")}
          </CodeBlock>
        );
      }

      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
    pre({ children }) {
      return <>{children}</>;
    },
    // Generated images embed as markdown; render them as clean bordered
    // previews that link to the full-size file
    img({ src, alt }) {
      if (!src || typeof src !== "string") return null;
      return (
        <a href={src.replace("?inline=1", "")} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt || "Generated image"}
            className="max-w-full rounded-xl border border-white/[0.08] my-2"
            loading="lazy"
          />
        </a>
      );
    },
  };

  return (
    <div className="flex justify-start group/msg">
      <div className="max-w-[85%] min-w-0">
        <div className="prose-chat text-[15px]">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {content}
          </ReactMarkdown>
        </div>

        {/* Action bar — context-aware formats; visible by default on touch devices, hover-reveal on desktop */}
        {content && !isStreaming && (
          <div className="flex items-center gap-1 mt-2 opacity-100 md:opacity-0 md:group-hover/msg:opacity-100 transition-opacity duration-200">
            <CopyButton text={content} label="Copy" />
            <MessageExportButtons content={content} agentName={agentName} conversationId={conversationId} />
          </div>
        )}
      </div>
    </div>
  );
}
