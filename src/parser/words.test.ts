// biome-ignore-all lint/suspicious/noTemplateCurlyInString: shell syntax in test strings
import { describe, expect, it } from "vitest";
import { tokenize } from "../tokenizer";
import { wordFromToken } from "./words";

/**
 * Unit tests for the word-conversion module: tokenizer word parts to AST
 * word parts. The behavioral quoting/expansion suites live in
 * words-quotes-comments.test.ts, expansions.test.ts and param-exp.test.ts.
 */
function firstWord(source: string) {
  const tokens = tokenize(source);
  const first = tokens[0];
  if (first?.type !== "word") {
    throw new Error(`no word token in ${JSON.stringify(source)}`);
  }
  return first;
}

describe("wordFromToken", () => {
  it("converts a literal word", () => {
    expect(wordFromToken(firstWord("foo"))).toMatchObject({
      type: "Word",
      parts: [{ type: "Literal", value: "foo" }],
    });
  });

  it("converts quoting into ordered parts with positions", () => {
    const word = wordFromToken(firstWord("a'b'c"));
    expect(word.parts.map((p) => p.type)).toEqual([
      "Literal",
      "SglQuoted",
      "Literal",
    ]);
    expect(word.parts[1]).toMatchObject({ type: "SglQuoted", value: "b" });
  });

  it("keeps positions from the token parts", () => {
    const word = wordFromToken(firstWord("abc"));
    expect(word.pos).toMatchObject({ offset: 0, line: 1, col: 1 });
    expect(word.end).toMatchObject({ offset: 3, line: 1, col: 4 });
  });
});

describe("convertWordPart", () => {
  it("converts a double-quoted part recursively", () => {
    const word = wordFromToken(firstWord('"a$x"'));
    const dbl = word.parts[0];
    expect(dbl).toMatchObject({ type: "DblQuoted" });
    if (dbl?.type !== "DblQuoted") throw new Error("not a DblQuoted");
    expect(dbl.parts.map((p) => p.type)).toEqual(["Literal", "ParamExp"]);
  });

  it("converts command substitutions into inner programs", () => {
    const word = wordFromToken(firstWord("$(foo; bar)"));
    const subst = word.parts[0];
    expect(subst).toMatchObject({ type: "CmdSubst" });
    if (subst?.type !== "CmdSubst") throw new Error("not a CmdSubst");
    expect(subst.stmts).toHaveLength(2);
    expect(subst.stmts.every((st) => st.command.type === "SimpleCommand")).toBe(
      true,
    );
  });

  it("converts backtick substitutions into CmdSubst", () => {
    const word = wordFromToken(firstWord("`foo`"));
    expect(word.parts[0]).toMatchObject({ type: "CmdSubst" });
  });

  it("converts process substitutions", () => {
    const word = wordFromToken(firstWord(">(foo)"));
    expect(word.parts[0]).toMatchObject({ type: "ProcSubst", op: ">" });
  });

  it("converts extglobs", () => {
    const word = wordFromToken(firstWord("?(foo)"));
    expect(word.parts[0]).toMatchObject({
      type: "ExtGlob",
      op: "?(",
      pattern: "foo",
    });
  });
});

describe("convertParamExp", () => {
  it("converts a short (unbraced) expansion", () => {
    const word = wordFromToken(firstWord("$x"));
    expect(word.parts[0]).toMatchObject({
      type: "ParamExp",
      short: true,
      param: { type: "Literal", value: "x" },
    });
  });

  it("converts length, index, slice and replace forms", () => {
    expect(wordFromToken(firstWord("${#x}")).parts[0]).toMatchObject({
      length: true,
    });
    expect(wordFromToken(firstWord("${x[1]}")).parts[0]).toMatchObject({
      index: { type: "Word" },
    });
    expect(wordFromToken(firstWord("${x:1:2}")).parts[0]).toMatchObject({
      slice: { offset: { type: "Word" }, length: { type: "Word" } },
    });
    expect(wordFromToken(firstWord("${x/a/b}")).parts[0]).toMatchObject({
      replace: { orig: { type: "Word" }, with: { type: "Word" } },
    });
  });

  it("converts expansion operators", () => {
    expect(wordFromToken(firstWord("${x:-y}")).parts[0]).toMatchObject({
      exp: { op: ":-", word: { type: "Word" } },
    });
  });

  it("marks exclusions", () => {
    expect(wordFromToken(firstWord("${!x}")).parts[0]).toMatchObject({
      excl: true,
    });
  });
});
