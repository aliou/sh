import { describe, expect, it } from "vitest";
import { parse } from "../parse";

describe("linebreak positions (bash parity)", () => {
  it.each(["! # c\nfoo", "x() # c\n{ foo; }", "x()\n{ foo; }"])(
    "parses %s",
    (src) => {
      expect(() => parse(src)).not.toThrow();
    },
  );

  it.each([
    "foo; ; bar",
    "foo\n; bar",
    "foo # c\n; bar",
    "foo;;bar",
    "foo & ; bar",
    "if foo; then\n; bar; fi",
    "if; then bar; fi",
  ])("rejects %s like bash does", (src) => {
    expect(() => parse(src)).toThrow();
  });

  it.each([
    "foo;\nbar",
    "foo\nbar",
    "foo # c\nbar",
    "foo &\nbar",
    "{ foo; bar; }",
    "{ foo\nbar; }",
  ])("still parses %s", (src) => {
    expect(() => parse(src)).not.toThrow();
  });
});

describe("operator continuation failures", () => {
  it("anchors continuation failures at the operator", () => {
    expect(() => parse("foo && # c")).toThrowError(/&&.*followed by/);
    expect(() => parse("foo && ; bar")).toThrowError(/&&.*followed by/);
    expect(() => parse("foo || # c")).toThrowError(/\|\|.*followed by/);
    expect(() => parse("foo | # c")).toThrowError(/\|.*followed by/);

    const { errors } = parse("foo && # c", { recoverErrors: true });
    expect(errors?.[0]?.pos).toMatchObject({ offset: 4, line: 1, col: 5 });
  });

  it("reports the failing operator's own position in a chain", () => {
    const { errors } = parse("foo && bar || # c", { recoverErrors: true });
    expect(errors?.[0]?.message).toBe("`||` must be followed by a statement");
    expect(errors?.[0]?.pos).toMatchObject({ offset: 11, line: 1, col: 12 });
  });

  it("keeps deep errors after a partial continuation", () => {
    expect(() => parse("foo && ( )")).toThrowError(
      /must be followed by a statement list/,
    );
    expect(() => parse("foo && if x; then")).toThrowError(
      /Unexpected end of input/,
    );
  });

  it("keeps non-continuation bad-word errors unchanged", () => {
    expect(() => parse("&& foo")).toThrowError("Expected a command word");
    expect(() => parse("; foo")).toThrowError("Expected a command word");
  });

  it("parses a comment and blank lines after an operator", () => {
    const { ast } = parse("foo && # c\n\nbar");
    expect(ast.body).toHaveLength(1);
    expect(ast.body[0]?.command.type).toBe("Logical");
  });
});
