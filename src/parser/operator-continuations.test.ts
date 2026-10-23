import { describe, expect, it } from "vitest";
import { parse } from "../parse";

/**
 * Operator continuation positions (`&&`, `||`, `|`) and separator
 * strictness, cross-checked against `bash -n` (aliou/sh#25). The cases
 * split into three groups:
 *
 * 1. linebreak positions bash accepts — comments and blank lines after
 *    an operator, after `!`, and after a function's `()`;
 * 2. stray-separator positions bash rejects — doubled `;`, `;` after a
 *    newline, `;` after `&`;
 * 3. error-surface assertions — missing continuations name the operator
 *    and are anchored at its position.
 */
describe("linebreak positions (bash parity)", () => {
  it.each([
    "! # c\nfoo", // '!' followed by comment + newline
    "x() # c\n{ foo; }", // function declaration split across a comment line
    "x()\n{ foo; }", // ... and across a plain newline
  ])("parses %s", (src) => {
    expect(() => parse(src)).not.toThrow();
  });

  it.each([
    "foo; ; bar", // two literal semicolons
    "foo\n; bar", // ';' after a newline
    "foo # c\n; bar", // ';' after a comment and newline
    "foo;;bar", // ';;' outside case
    "foo & ; bar", // ';' after '&'
    "if foo; then\n; bar; fi", // stray ';' where newline was intended
    "if; then bar; fi", // stray ';' where a condition was expected
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
    // Message names the operator instead of the deep "Expected a command word":
    expect(() => parse("foo && # c")).toThrowError(/&&.*followed by/);
    expect(() => parse("foo && ; bar")).toThrowError(/&&.*followed by/);
    expect(() => parse("foo || # c")).toThrowError(/\|\|.*followed by/);
    expect(() => parse("foo | # c")).toThrowError(/\|.*followed by/);

    // recoverErrors points at the operator (offset 4), not the
    // statement start:
    const { errors } = parse("foo && # c", { recoverErrors: true });
    expect(errors?.[0]?.pos).toMatchObject({ offset: 4, line: 1, col: 5 });
  });

  it("reports the failing operator's own position in a chain", () => {
    const { errors } = parse("foo && bar || # c", { recoverErrors: true });
    expect(errors?.[0]?.message).toBe("`||` must be followed by a statement");
    // The `||` sits at offset 11.
    expect(errors?.[0]?.pos).toMatchObject({ offset: 11, line: 1, col: 12 });
  });

  it("keeps deep errors after a partial continuation", () => {
    // The continuation started (a `(` was consumed), so the failure is
    // the subshell's, not the operator's.
    expect(() => parse("foo && ( )")).toThrowError(
      /must be followed by a statement list/,
    );
    expect(() => parse("foo && if x; then")).toThrowError(
      /Unexpected end of input/,
    );
  });

  it("keeps non-continuation bad-word errors unchanged", () => {
    // No operator precedes these, so they keep the deep message.
    expect(() => parse("&& foo")).toThrowError("Expected a command word");
    expect(() => parse("; foo")).toThrowError("Expected a command word");
  });

  it("parses a comment and blank lines after an operator", () => {
    const { ast } = parse("foo && # c\n\nbar");
    expect(ast.body).toHaveLength(1);
    expect(ast.body[0]?.command.type).toBe("Logical");
  });
});
