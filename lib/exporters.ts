import { removeEmDashes } from "./brand-fonts";
import { generateDeckPdf } from "./deck-pdf";
import { generateDocumentPdf } from "./doc-pdf";
import { generateDocx } from "./docx-export";
import { extractSlides } from "./slide-schema";

export type DocumentFormat = "md" | "doc" | "docx" | "pdf";

function sanitizeFileName(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "gratitude-output"
  );
}

export async function buildExportPayload(format: DocumentFormat, title: string, content: string) {
  const safeFileName = sanitizeFileName(title);

  if (format === "md") {
    return {
      fileName: `${safeFileName}.md`,
      mimeType: "text/markdown; charset=utf-8",
      body: removeEmDashes(`# ${title}\n\n${content}`) as string | Buffer,
    };
  }

  if (format === "doc" || format === "docx") {
    return {
      fileName: `${safeFileName}.docx`,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      body: await generateDocx(title, content),
    };
  }

  // A deck exports as slides (one landscape page per slide, same layout as
  // PPTX), never as raw JSON text
  const deck = extractSlides(content);
  if (deck) {
    return {
      fileName: `${sanitizeFileName(deck.title || title)}.pdf`,
      mimeType: "application/pdf",
      body: await generateDeckPdf(deck),
    };
  }

  return {
    fileName: `${safeFileName}.pdf`,
    mimeType: "application/pdf",
    body: await generateDocumentPdf(title, content),
  };
}
