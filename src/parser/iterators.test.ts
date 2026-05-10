import { describe, expect, it } from "vitest";
import type { SimpleCommand } from "../ast";
import { parseStmtsSeq, parseWordsSeq } from "../seq";

describe("parseStmtsSeq", () => {
  it("yields statements in order", () => {
    const stmts = [...parseStmtsSeq("foo; bar; baz")];
    expect(stmts).toHaveLength(3);
    const names = stmts.map((s) => {
      const cmd = s.command as SimpleCommand;
      const part = cmd.words?.[0]?.parts[0];
      return part?.type === "Literal" ? part.value : null;
    });
    expect(names).toEqual(["foo", "bar", "baz"]);
  });

  it("handles a single statement", () => {
    const stmts = [...parseStmtsSeq("hello world")];
    expect(stmts).toHaveLength(1);
  });

  it("handles empty input", () => {
    expect([...parseStmtsSeq("")]).toHaveLength(0);
    expect([...parseStmtsSeq("\n\n")]).toHaveLength(0);
  });

  it("can be consumed lazily (only the parser consumes work as the caller advances)", () => {
    let count = 0;
    for (const _ of parseStmtsSeq("a; b; c; d; e")) {
      count++;
      if (count === 2) break;
    }
    expect(count).toBe(2);
  });
});

describe("parseWordsSeq", () => {
  it("yields each whitespace-separated word", () => {
    const words = [...parseWordsSeq("foo bar 'baz qux' $var")];
    expect(words).toHaveLength(4);
    expect(words[0]?.parts[0]).toMatchObject({ type: "Literal", value: "foo" });
    expect(words[2]?.parts[0]).toMatchObject({
      type: "SglQuoted",
      value: "baz qux",
    });
    expect(words[3]?.parts[0]?.type).toBe("ParamExp");
  });

  it("handles empty input", () => {
    expect([...parseWordsSeq("")]).toHaveLength(0);
  });

  it("ignores trailing newlines", () => {
    expect([...parseWordsSeq("foo\n")]).toHaveLength(1);
  });
});
