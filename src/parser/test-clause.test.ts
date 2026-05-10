import { describe, expect, it } from "vitest";
import type { TestClause } from "../ast";
import { parse } from "../parse";

function testOf(src: string): TestClause {
  const { ast } = parse(src);
  const cmd = ast.body[0]?.command;
  if (cmd?.type !== "TestClause")
    throw new Error(`expected TestClause, got ${cmd?.type}`);
  return cmd;
}

const litWord = (value: string) => ({
  type: "Word",
  parts: [{ type: "Literal", value }],
});

describe("TestClause structured AST", () => {
  it("a single word leaf", () => {
    expect(testOf("[[ foo ]]").x).toMatchAst(litWord("foo"));
  });

  it("binary equality", () => {
    expect(testOf("[[ a == b ]]").x).toMatchAst({
      type: "BinaryTest",
      op: "==",
      x: litWord("a"),
      y: litWord("b"),
    });
  });

  it("binary !=", () => {
    expect(testOf("[[ a != b ]]").x).toMatchAst({
      type: "BinaryTest",
      op: "!=",
      x: litWord("a"),
      y: litWord("b"),
    });
  });

  it("binary regex =~", () => {
    expect(testOf("[[ foo =~ bar ]]").x).toMatchAst({
      type: "BinaryTest",
      op: "=~",
      x: litWord("foo"),
      y: litWord("bar"),
    });
  });

  it("unary file test -e", () => {
    expect(testOf("[[ -e file ]]").x).toMatchAst({
      type: "UnaryTest",
      op: "-e",
      x: litWord("file"),
    });
  });

  it("unary string -z", () => {
    expect(testOf("[[ -z $foo ]]").x).toMatchAst({
      type: "UnaryTest",
      op: "-z",
      x: {
        type: "Word",
        parts: [
          {
            type: "ParamExp",
            short: true,
            param: { type: "Literal", value: "foo" },
          },
        ],
      },
    });
  });

  it("negation !", () => {
    expect(testOf("[[ ! a ]]").x).toMatchAst({
      type: "UnaryTest",
      op: "!",
      x: litWord("a"),
    });
  });

  it("&& has higher precedence than ||", () => {
    expect(testOf("[[ a || b && c ]]").x).toMatchAst({
      type: "BinaryTest",
      op: "||",
      x: litWord("a"),
      y: {
        type: "BinaryTest",
        op: "&&",
        x: litWord("b"),
        y: litWord("c"),
      },
    });
  });

  it("parens override precedence", () => {
    expect(testOf("[[ (a || b) && c ]]").x).toMatchAst({
      type: "BinaryTest",
      op: "&&",
      x: {
        type: "ParenTest",
        x: {
          type: "BinaryTest",
          op: "||",
          x: litWord("a"),
          y: litWord("b"),
        },
      },
      y: litWord("c"),
    });
  });

  it("file comparison -ef", () => {
    expect(testOf("[[ a -ef b ]]").x).toMatchAst({
      type: "BinaryTest",
      op: "-ef",
      x: litWord("a"),
      y: litWord("b"),
    });
  });
});
