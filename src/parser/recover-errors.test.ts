import { describe, expect, it } from "vitest";
import { parse } from "../parse";

function posAt(source: string, offset: number) {
  const before = source.slice(0, offset);
  const lines = before.split("\n");
  return {
    offset,
    line: lines.length,
    col: (lines[lines.length - 1] ?? "").length + 1,
  };
}

describe("recoverErrors mode", () => {
  it("returns a body and an errors array on a clean parse", () => {
    const result = parse("foo; bar", { recoverErrors: true });
    expect(result.errors ?? []).toEqual([]);
    expect(result.ast.body).toHaveLength(2);
  });

  it("collects an error and continues past the bad statement", () => {
    // `if` without `fi` would normally throw; with recoverErrors we expect
    // the error to be recorded and remaining statements to still parse.
    const result = parse("foo\nif", { recoverErrors: true });
    expect((result.errors ?? []).length).toBeGreaterThanOrEqual(1);
    expect(result.errors?.[0]?.message).toMatch(/end of input|fi|then/i);
  });

  it("does not throw on unclosed quotes", () => {
    expect(() =>
      parse("echo 'unterminated", { recoverErrors: true }),
    ).not.toThrow();
    const result = parse("echo 'unterminated", { recoverErrors: true });
    expect((result.errors ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("sets fallback program end to the real multiline source end", () => {
    const source = "echo ok\nunterminated '";
    const result = parse(source, { recoverErrors: true });
    expect(result.ast.end).toEqual(posAt(source, source.length));
  });

  it("still throws by default (recoverErrors not set)", () => {
    expect(() => parse("echo 'unterminated")).toThrow();
  });

  it("attaches a position to each collected error", () => {
    const result = parse("if", { recoverErrors: true });
    expect(result.errors?.[0]?.pos).toBeDefined();
    expect(result.errors?.[0]?.pos.line).toBeGreaterThan(0);
  });
});
