import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { buildExportPayload, type DocumentFormat } from "@/lib/exporters";
import { generatePptx, parseSlideContent } from "@/lib/slides";
import { normalizeSlide, type SlideData } from "@/lib/slide-schema";
import { generateXlsx } from "@/lib/spreadsheet";
import { neutralizeCsv } from "@/lib/csv-safety";
import {
  EXPORT_MAX_CONTENT_CHARS,
  consumeBudgets,
  rateLimitResponse,
} from "@/lib/rate-limit";

// Exports render fonts and brand graphics server-side
export const runtime = "nodejs";

const VALID_FORMATS = ["md", "doc", "docx", "pdf", "pptx", "csv", "xlsx"];
const MAX_TITLE_CHARS = 300;
const MAX_SLIDES = 100;

export async function POST(request: Request) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const format = body.format as string;
    const title = String(body.title || "Gratitude Output").slice(0, MAX_TITLE_CHARS);
    const content = String(body.content || "");

    if (!format || !VALID_FORMATS.includes(format)) {
      return NextResponse.json({ error: "Invalid format" }, { status: 400 });
    }

    if (content.length > EXPORT_MAX_CONTENT_CHARS()) {
      return NextResponse.json({ error: "Content is too long to export." }, { status: 413 });
    }

    if (body.slides !== undefined && (!Array.isArray(body.slides) || body.slides.length > MAX_SLIDES)) {
      return NextResponse.json({ error: "Invalid slides" }, { status: 400 });
    }

    const limited = await consumeBudgets(session.userId, ["export_hour"]);
    if (limited) return rateLimitResponse(limited);

    const safeFileName =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "gratitude-export";

    // CSV export - raw data, with spreadsheet formula injection neutralized
    if (format === "csv") {
      const csvMatch = content.match(/```(?:csv)?\s*\n([\s\S]*?)\n```/);
      const csvContent = neutralizeCsv(csvMatch ? csvMatch[1] : content);

      return new NextResponse(csvContent, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${safeFileName}.csv"`,
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    // XLSX export - branded Excel
    if (format === "xlsx") {
      const buffer = await generateXlsx(content, title);

      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${safeFileName}.xlsx"`,
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    // PPTX export
    if (format === "pptx") {
      let presentationData = parseSlideContent(content, title);
      if (Array.isArray(body.slides)) {
        const slides = (body.slides as unknown[]).map(normalizeSlide).filter((s): s is SlideData => !!s);
        if (slides.length > 0) presentationData = { title, slides };
      }

      const buffer = await generatePptx(presentationData);

      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "Content-Disposition": `attachment; filename="${safeFileName}.pptx"`,
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    // MD, DOCX (doc is an alias), PDF (deck or document). The old HTML .doc
    // export (and its title escaping) is gone: DOCX and PDF are built with
    // docx/pdfkit, which never interpret the title or content as markup.
    const payload = await buildExportPayload(format as DocumentFormat, title, content);
    const responseBody = typeof payload.body === "string" ? payload.body : new Uint8Array(payload.body);

    return new NextResponse(responseBody, {
      headers: {
        "Content-Type": payload.mimeType,
        // payload.fileName is sanitized to [a-z0-9-] and carries the real
        // extension (doc requests download as .docx)
        "Content-Disposition": `attachment; filename="${payload.fileName}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Export failed", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
