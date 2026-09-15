import { describe, expect, it } from "vitest";
import { neutralizeCell, neutralizeCsv } from "@/lib/csv-safety";

describe("neutralizeCell", () => {
  it.each(["=SUM(A1:A2)", "+cmd|' /C calc'!A0", "-2+3", "@SUM(1)", "\tfoo", "\rbar", "  =1+1"])(
    "prefixes formula-like cell %j",
    (value) => {
      expect(neutralizeCell(value)).toBe(`'${value}`);
    }
  );

  it.each(["-12", "+3.5", "-1,200.00", "-4%", "hello", "a=b", ""])(
    "leaves plain value %j alone",
    (value) => {
      expect(neutralizeCell(value)).toBe(value);
    }
  );
});

describe("neutralizeCsv", () => {
  it("neutralizes unquoted and quoted cells and preserves structure", () => {
    const input = 'name,total,note\nAcme,-5,=HYPERLINK("http://x")\n"Beta, Inc","@evil","ok ""quoted"""\n';
    const out = neutralizeCsv(input);
    expect(out).toBe(
      'name,total,note\nAcme,-5,"\'=HYPERLINK(""http://x"")"\n"Beta, Inc","\'@evil","ok ""quoted"""\n'
    );
  });

  it("keeps CRLF line endings", () => {
    expect(neutralizeCsv("a,b\r\n=1,2\r\n")).toBe("a,b\r\n'=1,2\r\n");
  });

  it("handles newlines inside quoted cells", () => {
    expect(neutralizeCsv('"line1\n=line2",x')).toBe('"line1\n=line2",x');
  });
});
