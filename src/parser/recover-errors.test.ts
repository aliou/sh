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

describe("recoverErrors mode: inner programs", () => {
  it("reports inner-program errors at real outer positions", () => {
    // The `&&` sits at offset 8 / col 9 of the outer source, not at the
    // inner program's relative offset 4.
    const { errors } = parse("x=$(foo &&)", { recoverErrors: true });
    expect(errors?.[0]?.message).toBe("`&&` must be followed by a statement");
    expect(errors?.[0]?.pos).toMatchObject({ offset: 8, line: 1, col: 9 });
  });

  it("rebases inner errors across lines", () => {
    const source = "echo ok\nx=$(y &&)";
    // `&&` is on line 2, col 7 of the outer source (offset 14).
    const { errors } = parse(source, { recoverErrors: true });
    expect(errors?.[0]?.pos).toMatchObject({ offset: 14, line: 2, col: 7 });
  });
});
