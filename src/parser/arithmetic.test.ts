import { describe, expect, it } from "vitest";
import type {
  ArithCmd,
  ArithExp,
  BinaryArithm,
  CStyleLoop,
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
});

describe("arithmetic in C-style for loop", () => {
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
});
