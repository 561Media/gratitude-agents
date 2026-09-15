/**
 * Markdown -> semantic document blocks, shared by the PDF and DOCX exporters.
 * Parsed with remark (GFM) so headings, nested lists, tables, and inline bold
 * come through as structure instead of literal "#" and "**" characters.
 */
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

export interface Run {
  text: string;
  bold?: boolean;
}

export type Block =
  | { type: "heading"; depth: number; runs: Run[] }
  | { type: "paragraph"; runs: Run[] }
  | { type: "list"; ordered: boolean; items: { runs: Run[]; depth: number; index: number }[] }
  | { type: "quote"; runs: Run[] }
  | { type: "rule" }
  | { type: "code"; text: string }
  | { type: "table"; header: Run[][]; rows: Run[][][] };

// Minimal mdast node shape (avoids a direct @types/mdast dependency)
interface MdNode {
  type: string;
  value?: string;
  depth?: number;
  ordered?: boolean;
  start?: number | null;
  alt?: string;
  children?: MdNode[];
}

function inlineRuns(node: MdNode, bold = false): Run[] {
  switch (node.type) {
    case "text":
    case "inlineCode":
      return node.value ? [{ text: node.value, bold }] : [];
    case "strong":
      return (node.children || []).flatMap((c) => inlineRuns(c, true));
    case "break":
      return [{ text: "\n", bold }];
    case "image":
      return node.alt ? [{ text: node.alt, bold }] : [];
    case "html":
      return [];
    default:
      return (node.children || []).flatMap((c) => inlineRuns(c, bold));
  }
}

function mergeRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    const prev = out[out.length - 1];
    if (prev && !!prev.bold === !!r.bold) prev.text += r.text;
    else out.push({ ...r });
  }
  return out.filter((r) => r.text.length > 0);
}

function collectList(node: MdNode, depth: number, into: { runs: Run[]; depth: number; index: number }[]) {
  let index = node.start ?? 1;
  for (const item of node.children || []) {
    const nested: MdNode[] = [];
    const runs: Run[] = [];
    for (const child of item.children || []) {
      if (child.type === "list") nested.push(child);
      else {
        if (runs.length > 0) runs.push({ text: " " });
        runs.push(...inlineRuns(child));
      }
    }
    into.push({ runs: mergeRuns(runs), depth, index });
    index++;
    for (const n of nested) collectList(n, depth + 1, into);
  }
}

function toBlocks(nodes: MdNode[], out: Block[]) {
  for (const node of nodes) {
    switch (node.type) {
      case "heading":
        out.push({ type: "heading", depth: node.depth || 1, runs: mergeRuns(inlineRuns(node)) });
        break;
      case "paragraph": {
        const runs = mergeRuns(inlineRuns(node));
        if (runs.some((r) => r.text.trim())) out.push({ type: "paragraph", runs });
        break;
      }
      case "list": {
        const items: { runs: Run[]; depth: number; index: number }[] = [];
        collectList(node, 0, items);
        out.push({ type: "list", ordered: !!node.ordered, items });
        break;
      }
      case "blockquote": {
        const runs: Run[] = [];
        for (const child of node.children || []) {
          if (runs.length > 0) runs.push({ text: "\n" });
          runs.push(...inlineRuns(child));
        }
        out.push({ type: "quote", runs: mergeRuns(runs) });
        break;
      }
      case "thematicBreak":
        out.push({ type: "rule" });
        break;
      case "code":
        out.push({ type: "code", text: node.value || "" });
        break;
      case "table": {
        const rows = (node.children || []).map((row) =>
          (row.children || []).map((cell) => mergeRuns(inlineRuns(cell)))
        );
        if (rows.length > 0) out.push({ type: "table", header: rows[0], rows: rows.slice(1) });
        break;
      }
      default:
        if (node.children) toBlocks(node.children, out);
    }
  }
}

export function parseMarkdownBlocks(markdown: string): Block[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as unknown as MdNode;
  const blocks: Block[] = [];
  toBlocks(tree.children || [], blocks);
  return blocks;
}

export function runsText(runs: Run[]): string {
  return runs.map((r) => r.text).join("");
}

/**
 * Pull a document title out of the blocks: a leading H1 becomes the title and
 * is removed from the body so it is not printed twice.
 */
export function splitDocumentTitle(blocks: Block[], fallback: string): { title: string; blocks: Block[] } {
  const firstIdx = blocks.findIndex((b) => b.type !== "rule");
  const first = blocks[firstIdx];
  if (first && first.type === "heading" && first.depth === 1) {
    return { title: runsText(first.runs).trim() || fallback, blocks: blocks.filter((_, i) => i !== firstIdx) };
  }
  return { title: fallback, blocks };
}
