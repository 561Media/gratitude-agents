/**
 * Real Word document (.docx) from Markdown: native headings, bullet and
 * numbered lists, tables, quotes, Inter body text, Anton title, logo header,
 * and page-numbered footer. Replaces the old HTML-saved-as-.doc export.
 */
import fs from "fs";
import path from "path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { removeEmDashes } from "./brand-fonts";
import { type Block, type Run, parseMarkdownBlocks, splitDocumentTitle } from "./markdown-blocks";

const PINK = "FE3184";
const INK = "1A1A1A";

function textRuns(runs: Run[], opts: { color?: string; size?: number; font?: string } = {}): TextRun[] {
  const out: TextRun[] = [];
  for (const run of runs) {
    const parts = removeEmDashes(run.text).split("\n");
    parts.forEach((part, i) => {
      out.push(
        new TextRun({
          text: part,
          bold: run.bold,
          break: i > 0 ? 1 : undefined,
          color: opts.color,
          size: opts.size,
          font: opts.font,
        })
      );
    });
  }
  return out;
}

function blockToChildren(block: Block, listInstance: { next: number }): (Paragraph | Table)[] {
  switch (block.type) {
    case "heading": {
      const level = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4][
        Math.min(block.depth, 4) - 1
      ];
      const display = block.depth <= 2;
      const runs = display ? block.runs.map((r) => ({ ...r, text: r.text.toUpperCase(), bold: false })) : block.runs;
      return [new Paragraph({ heading: level, children: textRuns(runs), keepNext: true })];
    }
    case "paragraph":
      return [new Paragraph({ children: textRuns(block.runs) })];
    case "list": {
      const instance = listInstance.next++;
      return block.items.map(
        (item) =>
          new Paragraph({
            children: textRuns(item.runs),
            ...(block.ordered
              ? { numbering: { reference: "gratitude-numbered", level: Math.min(item.depth, 3), instance } }
              : { bullet: { level: Math.min(item.depth, 3) } }),
            spacing: { after: 60 },
          })
      );
    }
    case "quote":
      return [
        new Paragraph({
          children: textRuns(block.runs, { color: "444444", size: 24 }),
          indent: { left: 360 },
          border: { left: { style: BorderStyle.SINGLE, size: 18, color: PINK, space: 12 } },
          spacing: { before: 120, after: 200 },
        }),
      ];
    case "rule":
      return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "DDDDDD", space: 1 } } })];
    case "code":
      return block.text.split("\n").map(
        (line) =>
          new Paragraph({
            children: [new TextRun({ text: removeEmDashes(line) || " ", size: 19, color: "333333" })],
            shading: { type: ShadingType.CLEAR, fill: "F3F3F3", color: "auto" },
            spacing: { after: 0 },
          })
      );
    case "table": {
      const cols = Math.max(block.header.length, ...block.rows.map((r) => r.length), 1);
      const cell = (runs: Run[] | undefined, header: boolean, shade?: string) =>
        new TableCell({
          children: [
            new Paragraph({
              children: textRuns(runs || [], header ? { color: "FFFFFF" } : {}),
              spacing: { after: 0 },
            }),
          ],
          shading: shade ? { type: ShadingType.CLEAR, fill: shade, color: "auto" } : undefined,
          margins: { top: 80, bottom: 80, left: 100, right: 100 },
        });
      const rows = [
        new TableRow({
          tableHeader: true,
          children: Array.from({ length: cols }, (_, c) =>
            cell(block.header[c]?.map((r) => ({ ...r, bold: true })), true, INK)
          ),
        }),
        ...block.rows.map(
          (row, i) =>
            new TableRow({
              children: Array.from({ length: cols }, (_, c) => cell(row[c], false, i % 2 === 1 ? "F6F6F6" : undefined)),
            })
        ),
      ];
      return [
        new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }),
        new Paragraph({ spacing: { after: 120 } }),
      ];
    }
  }
}

export async function generateDocx(title: string, markdown: string): Promise<Buffer> {
  const parsed = splitDocumentTitle(parseMarkdownBlocks(markdown), title);
  const listInstance = { next: 1 };

  const logoPath = path.join(process.cwd(), "logos", "gratitude-logo-color.png");
  const headerChildren = fs.existsSync(logoPath)
    ? [
        new Paragraph({
          children: [
            new ImageRun({
              type: "png",
              data: fs.readFileSync(logoPath),
              transformation: { width: 110, height: Math.round((110 * 159) / 800) },
            }),
          ],
        }),
      ]
    : [];

  const doc = new Document({
    creator: "Gratitude.com",
    title: removeEmDashes(parsed.title),
    styles: {
      default: {
        document: {
          run: { font: "Inter", size: 21, color: INK },
          paragraph: { spacing: { after: 160, line: 312 } },
        },
        heading1: {
          run: { font: "Anton", size: 36, color: "000000", bold: false },
          paragraph: { spacing: { before: 360, after: 120 } },
        },
        heading2: {
          run: { font: "Anton", size: 28, color: "000000", bold: false },
          paragraph: { spacing: { before: 280, after: 100 } },
        },
        heading3: {
          run: { font: "Inter", size: 25, color: PINK, bold: true },
          paragraph: { spacing: { before: 220, after: 80 } },
        },
        heading4: {
          run: { font: "Inter", size: 22, color: INK, bold: true },
          paragraph: { spacing: { before: 180, after: 60 } },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: "gratitude-numbered",
          levels: [0, 1, 2, 3].map((level) => ({
            level,
            format: level % 2 === 0 ? LevelFormat.DECIMAL : LevelFormat.LOWER_LETTER,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [
      {
        headers: { default: new Header({ children: headerChildren }) },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: "Gratitude.com  |  Page ", size: 16, color: "888888" }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "888888" }),
                ],
              }),
            ],
          }),
        },
        children: [
          new Paragraph({
            children: [new TextRun({ text: removeEmDashes(parsed.title).toUpperCase(), font: "Anton", size: 56, color: "000000" })],
            border: { bottom: { style: BorderStyle.SINGLE, size: 24, color: PINK, space: 8 } },
            spacing: { after: 320 },
          }),
          ...parsed.blocks.flatMap((b) => blockToChildren(b, listInstance)),
        ],
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
