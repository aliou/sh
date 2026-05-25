import { describe, expect, it } from "vitest";
import type {
  ArithCmd,
  ArithExp,
  BinaryArithm,
  CStyleLoop,
  ParamExp,
  SimpleCommand,
} from "../ast";
import { parse } from "../parse";

function arithOf(src: string): ArithCmd {
  const { ast } = parse(src);
  const cmd = ast.body[0]?.command;
  if (cmd?.type !== "ArithCmd")
    throw new Error(`expected ArithCmd, got ${cmd?.type}`);
  return cmd;
}

function arithExpOf(src: string): ArithExp {
  const { ast } = parse(src);
  const cmd = ast.body[0]?.command as SimpleCommand;
  const part = cmd.words?.[1]?.parts[0];
  if (part?.type !== "ArithExp")
    throw new Error(`expected ArithExp, got ${part?.type}`);
  return part;
}

const litArith = (value: string) => ({ type: "ArithLit", value });
const variable = (name: string) => ({
  type: "ParamExp",
  short: true,
  param: { type: "Literal", value: name },
});

describe("arithmetic AST in (( ))", () => {
  it("parses a literal", () => {
    expect(arithOf("(( 42 )).x").x).toMatchAst(litArith("42"));
  });

  it("accepts an empty arithmetic command", () => {
    // mvdan/sh has file tests for empty C-style arithmetic clauses, and Bash
    // itself accepts an empty arithmetic command.
    expect(() => parse("(( ))")).not.toThrow();
  });

  it("parses a variable", () => {
    expect(arithOf("(( i ))").x).toMatchAst(variable("i"));
  });

  it("parses binary +", () => {
    expect(arithOf("(( 1 + 2 ))").x).toMatchAst({
      type: "BinaryArithm",
      op: "+",
      x: litArith("1"),
      y: litArith("2"),
    });
  });

  it("respects * over +", () => {
    expect(arithOf("(( 1 + 2 * 3 ))").x).toMatchAst({
      type: "BinaryArithm",
      op: "+",
      x: litArith("1"),
      y: {
        type: "BinaryArithm",
        op: "*",
        x: litArith("2"),
        y: litArith("3"),
      },
    });
  });

  it("parses parens", () => {
    expect(arithOf("(( (1 + 2) * 3 ))").x).toMatchAst({
      type: "BinaryArithm",
      op: "*",
      x: {
        type: "ParenArithm",
        x: {
          type: "BinaryArithm",
          op: "+",
          x: litArith("1"),
          y: litArith("2"),
        },
      },
      y: litArith("3"),
    });
  });

  it("parses unary -", () => {
    expect(arithOf("(( -1 ))").x).toMatchAst({
      type: "UnaryArithm",
      op: "-",
      x: litArith("1"),
    });
  });

  it("parses pre-increment", () => {
    expect(arithOf("(( ++i ))").x).toMatchAst({
      type: "UnaryArithm",
      op: "++",
      x: variable("i"),
    });
  });

  it("parses post-increment", () => {
    expect(arithOf("(( i++ ))").x).toMatchAst({
      type: "UnaryArithm",
      op: "++",
      post: true,
      x: variable("i"),
    });
  });

  it("parses comparison", () => {
    expect(arithOf("(( a < b ))").x).toMatchAst({
      type: "BinaryArithm",
      op: "<",
      x: variable("a"),
      y: variable("b"),
    });
  });

  it("parses assignment as right-associative", () => {
    expect(arithOf("(( a = b = 1 ))").x).toMatchAst({
      type: "BinaryArithm",
      op: "=",
      x: variable("a"),
      y: {
        type: "BinaryArithm",
        op: "=",
        x: variable("b"),
        y: litArith("1"),
      },
    });
  });

  it("parses ternary", () => {
    expect(arithOf("(( a ? b : c ))").x).toMatchAst({
      type: "BinaryArithm",
      op: "?",
      x: variable("a"),
      y: {
        type: "BinaryArithm",
        op: ":",
        x: variable("b"),
        y: variable("c"),
      },
    });
  });

  it("parses comma operator", () => {
    const x = arithOf("(( a , b ))").x as BinaryArithm;
    expect(x.op).toBe(",");
  });

  it("spans binary arithmetic expressions from left to right operand", () => {
    const x = arithOf("((1+2))").x as BinaryArithm;
    expect(x.pos).toEqual({ offset: 2, line: 1, col: 3 });
    expect(x.end).toEqual({ offset: 5, line: 1, col: 6 });
  });

  it("spans postfix arithmetic expressions from operand to operator end", () => {
    const x = arithOf("((i++))").x;
    if (!x) throw new Error("expected arithmetic expression");
    expect(x.type).toBe("UnaryArithm");
    expect(x.pos).toEqual({ offset: 2, line: 1, col: 3 });
    expect(x.end).toEqual({ offset: 5, line: 1, col: 6 });
  });
});

describe("arithmetic AST in $(( ))", () => {
  it("parses a single variable expansion", () => {
    expect(arithExpOf("echo $(( i + 1 ))").x).toMatchAst({
      type: "BinaryArithm",
      op: "+",
      x: variable("i"),
      y: litArith("1"),
    });
  });

  it("parses special parameters in arithmetic expansions", () => {
    const x = arithExpOf("echo $(( $? + 0 ))").x as BinaryArithm;
    expect(x.op).toBe("+");
    expect((x.x as ParamExp).param).toMatchAst({
      type: "Literal",
      value: "?",
    });
  });
});

describe("arithmetic in C-style for loop", () => {
  it("accepts empty init/cond/post like mvdan/sh and Bash", () => {
    // Inspired by mvdan/sh syntax/filetests_test.go cases for
    // `for (( ; ; ))` and `for ((;;))`.
    expect(() => parse("for (( ; ; )); do foo; done")).not.toThrow();
    expect(() => parse("for ((;;)); do foo; done")).not.toThrow();
  });

  it("parses init/cond/post", () => {
    const { ast } = parse("for (( i = 0; i < 10; i++ )); do :; done");
    const cmd = ast.body[0]?.command as CStyleLoop;
    expect(cmd.type).toBe("CStyleLoop");
    expect(cmd.init).toMatchAst({
      type: "BinaryArithm",
      op: "=",
      x: variable("i"),
      y: litArith("0"),
    });
    expect(cmd.cond).toMatchAst({
      type: "BinaryArithm",
      op: "<",
      x: variable("i"),
      y: litArith("10"),
    });
    expect(cmd.post).toMatchAst({
      type: "UnaryArithm",
      op: "++",
      post: true,
      x: variable("i"),
    });
  });

  it("anchors cond and post positions at their own C-style loop segments", () => {
    const src = "for ((i=0;j;k++)); do :; done";
    const { ast } = parse(src);
    const cmd = ast.body[0]?.command as CStyleLoop;
    expect(cmd.cond?.pos).toEqual({
      offset: src.indexOf("j"),
      line: 1,
      col: 11,
    });
    expect(cmd.post?.pos).toEqual({
      offset: src.indexOf("k++"),
      line: 1,
      col: 13,
    });
  });
});
