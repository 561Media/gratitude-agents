// CSV formula injection defence. Spreadsheet apps execute cells that begin
// with = + - @ (or a tab/CR) as formulas. Model output can be steered by
// retrieved content, so exported CSV is treated as untrusted: dangerous cells
// get a leading apostrophe, which spreadsheets display as plain text.

const LEADING_CONTROL = /^[\t\r]/;
const FORMULA_START = /^\s*[=+\-@]/;
// Plain numbers such as -12, +3.5, -1,200.00 or -4% are data, not formulas
const PLAIN_NUMBER = /^\s*[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?%?\s*$/;

export function neutralizeCell(value: string): string {
  if (LEADING_CONTROL.test(value)) return `'${value}`;
  if (FORMULA_START.test(value) && !PLAIN_NUMBER.test(value)) return `'${value}`;
  return value;
}

interface Field {
  value: string;
  quoted: boolean;
}

function parseCsv(input: string): Field[][] {
  const rows: Field[][] = [];
  let row: Field[] = [];
  let value = "";
  let quoted = false;
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push({ value, quoted });
    value = "";
    quoted = false;
  };

  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          value += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      value += ch;
      i++;
      continue;
    }
    if (ch === '"' && value === "" && !quoted) {
      inQuotes = true;
      quoted = true;
      i++;
      continue;
    }
    if (ch === ",") {
      endField();
      i++;
      continue;
    }
    if (ch === "\n" || (ch === "\r" && input[i + 1] === "\n")) {
      endField();
      rows.push(row);
      row = [];
      i += ch === "\r" ? 2 : 1;
      continue;
    }
    value += ch;
    i++;
  }
  endField();
  rows.push(row);
  return rows;
}

function serializeField(field: Field): string {
  const v = neutralizeCell(field.value);
  if (field.quoted || /[",\r\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

export function neutralizeCsv(csv: string): string {
  const newline = csv.includes("\r\n") ? "\r\n" : "\n";
  const endsWithNewline = /\r?\n$/.test(csv);
  const body = endsWithNewline ? csv.replace(/\r?\n$/, "") : csv;
  const out = parseCsv(body)
    .map((row) => row.map(serializeField).join(","))
    .join(newline);
  return endsWithNewline ? out + newline : out;
}
