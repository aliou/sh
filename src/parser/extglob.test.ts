import { describe, expect, it } from "vitest";
import type { ExtGlob, SimpleCommand } from "../ast";
import { parse } from "../parse";

function firstWordParts(src: string) {
  const { ast } = parse(src);
  const cmd = ast.body[0]?.command as SimpleCommand;
  return cmd.words?.[1]?.parts ?? [];
}

describe("extended glob patterns", () => {
  it("parses ?(pattern)", () => {
    const parts = firstWordParts("ls ?(foo)");
    expect(parts).toMatchAst([{ type: "ExtGlob", op: "?(", pattern: "foo" }]);
  });

  it("parses *(pattern)", () => {
    const parts = firstWordParts("ls *(foo)");
    expect(parts).toMatchAst([{ type: "ExtGlob", op: "*(", pattern: "foo" }]);
  });

  it("parses +(pattern)", () => {
    const parts = firstWordParts("ls +(foo)");
    expect(parts).toMatchAst([{ type: "ExtGlob", op: "+(", pattern: "foo" }]);
  });

  it("parses @(pattern)", () => {
    const parts = firstWordParts("ls @(foo)");
    expect(parts).toMatchAst([{ type: "ExtGlob", op: "@(", pattern: "foo" }]);
  });

  it("parses !(pattern)", () => {
    const parts = firstWordParts("ls !(foo)");
    expect(parts).toMatchAst([{ type: "ExtGlob", op: "!(", pattern: "foo" }]);
  });

  it("parses alternations inside the pattern", () => {
    const parts = firstWordParts("ls @(foo|bar|baz)");
    expect(parts).toMatchAst([
      { type: "ExtGlob", op: "@(", pattern: "foo|bar|baz" },
    ]);
  });

  it("handles nested parens inside the pattern", () => {
    const parts = firstWordParts("ls @(foo|@(bar|baz))");
    expect(parts).toMatchAst([
      { type: "ExtGlob", op: "@(", pattern: "foo|@(bar|baz)" },
    ]);
  });

  it("attaches a literal prefix and suffix", () => {
    const parts = firstWordParts("ls a@(b|c)d");
    expect(parts).toMatchAst([
      { type: "Literal", value: "a" },
      { type: "ExtGlob", op: "@(", pattern: "b|c" },
      { type: "Literal", value: "d" },
    ]);
  });

  it("treats a bare ? followed by space as a literal", () => {
    const { ast } = parse("ls ?");
    const cmd = ast.body[0]?.command as SimpleCommand;
    expect(cmd.words?.[1]?.parts).toMatchAst([{ type: "Literal", value: "?" }]);
  });

  it("attaches positions to the ExtGlob node", () => {
    const parts = firstWordParts("ls @(foo)");
    const eg = parts[0] as ExtGlob;
    expect(eg.pos).toMatchObject({ offset: 3 });
    expect(eg.end).toMatchObject({ offset: 9 });
  });
});
