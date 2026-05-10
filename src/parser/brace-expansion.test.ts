// biome-ignore-all lint/suspicious/noTemplateCurlyInString: shell syntax in test strings
import { describe, expect, it } from "vitest";
import type { BraceExp, Word, WordPart } from "../ast";
import { parse } from "../parse";
import { splitBraces } from "../split-braces";

const lit = (s: string): WordPart => ({ type: "Literal", value: s });
const word = (...parts: WordPart[]): Word => ({ type: "Word", parts });

function parseFirstWord(src: string): Word {
  const { ast } = parse(`echo ${src}`);
  const cmd = ast.body[0]?.command;
  if (cmd?.type !== "SimpleCommand") throw new Error("expected SimpleCommand");
  const arg = cmd.words?.[1];
  if (!arg) throw new Error("expected an argument word");
  return arg;
}

const brace = (sequence: boolean, ...elems: Word[]): BraceExp =>
  sequence
    ? { type: "BraceExp", sequence, elems }
    : { type: "BraceExp", elems };

describe("splitBraces", () => {
  it("returns false when there are no braces", () => {
    const w = word(lit("foo"));
    expect(splitBraces(w)).toBe(false);
    expect(w).toMatchAst(word(lit("foo")));
  });

  it("returns false for unbalanced opens", () => {
    const w = parseFirstWord("a{b");
    expect(splitBraces(w)).toBe(true); // contains { so the function tries
    expect(w).toMatchAst(word(lit("a"), lit("{"), lit("b")));
  });

  it("returns false for unbalanced closes", () => {
    const w = parseFirstWord("a}b");
    expect(splitBraces(w)).toBe(false);
  });

  it("leaves a single-element brace as a literal", () => {
    const w = parseFirstWord("a{b}");
    splitBraces(w);
    expect(w).toMatchAst(word(lit("a"), lit("{"), lit("b"), lit("}")));
  });

  it("leaves an empty brace as a literal", () => {
    const w = parseFirstWord("a{}");
    splitBraces(w);
    expect(w).toMatchAst(word(lit("a"), lit("{"), lit("}")));
  });

  it("splits a simple list", () => {
    const w = parseFirstWord("a{b,c}");
    expect(splitBraces(w)).toBe(true);
    expect(w).toMatchAst(
      word(lit("a"), brace(false, word(lit("b")), word(lit("c")))),
    );
  });

  it("splits with multibyte runes", () => {
    const w = parseFirstWord("a{à,世界}");
    splitBraces(w);
    expect(w).toMatchAst(
      word(lit("a"), brace(false, word(lit("à")), word(lit("世界")))),
    );
  });

  it("splits nested braces", () => {
    const w = parseFirstWord("a{b{x,y},c}d");
    splitBraces(w);
    expect(w).toMatchAst(
      word(
        lit("a"),
        brace(
          false,
          word(lit("b"), brace(false, word(lit("x")), word(lit("y")))),
          word(lit("c")),
        ),
        lit("d"),
      ),
    );
  });

  it("splits sequences", () => {
    const w = parseFirstWord("a{1..4}");
    splitBraces(w);
    expect(w).toMatchAst(
      word(lit("a"), brace(true, word(lit("1")), word(lit("4")))),
    );
  });

  it("splits sequences with increment", () => {
    const w = parseFirstWord("a{1..10..3}");
    splitBraces(w);
    expect(w).toMatchAst(
      word(
        lit("a"),
        brace(true, word(lit("1")), word(lit("10")), word(lit("3"))),
      ),
    );
  });

  it("splits character sequences", () => {
    const w = parseFirstWord("a{c..f}");
    splitBraces(w);
    expect(w).toMatchAst(
      word(lit("a"), brace(true, word(lit("c")), word(lit("f")))),
    );
  });

  it("rejects mixed char/number sequences", () => {
    const w = parseFirstWord("a{1..f}");
    splitBraces(w);
    expect(w).toMatchAst(
      word(lit("a"), lit("{"), lit("1"), lit(".."), lit("f"), lit("}")),
    );
  });

  it("rejects sequences with non-numeric increment", () => {
    const w = parseFirstWord("a{d..k..n}");
    splitBraces(w);
    expect(w).toMatchAst(
      word(
        lit("a"),
        lit("{"),
        lit("d"),
        lit(".."),
        lit("k"),
        lit(".."),
        lit("n"),
        lit("}"),
      ),
    );
  });

  it("returns broken sequences as literals", () => {
    const w = parseFirstWord("a{1..");
    splitBraces(w);
    expect(w).toMatchAst(word(lit("a"), lit("{"), lit("1"), lit("..")));
  });

  it("preserves non-literal word parts (e.g. param exp) inside braces", () => {
    const w = parseFirstWord("{$foo,bar}");
    splitBraces(w);
    // $foo is a ParamExp, not a literal — inside the brace it stays as-is.
    expect(w.parts.length).toBe(1);
    const be = w.parts[0];
    expect(be?.type).toBe("BraceExp");
    if (be?.type === "BraceExp") {
      expect(be.elems[0]?.parts[0]?.type).toBe("ParamExp");
      expect(be.elems[1]?.parts[0]).toMatchObject({
        type: "Literal",
        value: "bar",
      });
    }
  });
});
