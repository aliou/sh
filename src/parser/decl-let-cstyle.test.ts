import { assert, describe, expect, it } from "vitest";
import { parse } from "../parse";
import {
  arrayElem,
  arrayExpr,
  assign,
  cStyleLoop,
  declClause,
  letClause,
  program,
  redirect,
  simple,
  stmt,
  word,
} from "../test-helpers/ast-builders";

describe("parse (phase 22: decl clause)", () => {
  it.each([
    {
      input: "export FOO=bar",
      variant: "export" as const,
      assigns: [assign("FOO", "bar")],
    },
    {
      input: "local x=1",
      variant: "local" as const,
      assigns: [assign("x", "1")],
    },
    {
      input: "nameref ref=target",
      variant: "nameref" as const,
      assigns: [assign("ref", "target")],
    },
  ])("parses $variant with assignment", ({
    input,
    variant,
    assigns: assignList,
  }) => {
    expect(parse(input)).toMatchAst({
      ast: program(stmt(declClause(variant, { assigns: assignList }))),
    });
  });

  it("parses export with multiple names", () => {
    expect(parse("export FOO BAR")).toMatchAst({
      ast: program(
        stmt(declClause("export", { args: [word("FOO"), word("BAR")] })),
      ),
    });
  });

  it.each([
    {
      input: "declare -r FOO=bar",
      variant: "declare" as const,
      flag: "-r",
      assignVal: assign("FOO", "bar"),
    },
    {
      input: "typeset -i count=0",
      variant: "typeset" as const,
      flag: "-i",
      assignVal: assign("count", "0"),
    },
  ])("parses $variant with flag and assignment", ({
    input,
    variant,
    flag,
    assignVal,
  }) => {
    expect(parse(input)).toMatchAst({
      ast: program(
        stmt(
          declClause(variant, {
            args: [word(flag)],
            assigns: [assignVal],
          }),
        ),
      ),
    });
  });

  it("parses readonly with names", () => {
    expect(parse("readonly X Y")).toMatchAst({
      ast: program(
        stmt(declClause("readonly", { args: [word("X"), word("Y")] })),
      ),
    });
  });

  it("parses export with redirect", () => {
    expect(parse("export FOO=bar 2>/dev/null")).toMatchAst({
      ast: program(
        stmt(
          declClause("export", {
            assigns: [assign("FOO", "bar")],
            redirects: [redirect(">", "/dev/null", "2")],
          }),
        ),
      ),
    });
  });

  it("parses declare -a with array", () => {
    expect(parse("declare -a arr=(a b c)")).toMatchAst({
      ast: program(
        stmt(
          declClause("declare", {
            args: [word("-a")],
            assigns: [
              assign("arr", undefined, {
                array: arrayExpr(
                  arrayElem("a"),
                  arrayElem("b"),
                  arrayElem("c"),
                ),
              }),
            ],
          }),
        ),
      ),
    });
  });

  it("allows brace patterns in declaration variable names", () => {
    // mvdan/sh v3.13.0: declarations like `local {a,b}_c=1` should parse
    // rather than erroring on an invalid variable name. The braced name is
    // kept as an argument word so it can be expanded later.
    expect(parse("declare {a,b}_c=value")).toMatchAst({
      ast: program(
        stmt(
          declClause("declare", {
            args: [word("{a,b}_c=value")],
          }),
        ),
      ),
    });
  });
});

describe("parse (phase 23: append assignment)", () => {
  it("parses append assignment", () => {
    expect(parse("PATH+=/usr/local/bin echo hi")).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("echo"), word("hi")],
          assignments: [assign("PATH", "/usr/local/bin", { append: true })],
        }),
      ),
    });
  });

  it("parses standalone append assignment", () => {
    expect(parse("arr+=value")).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          assignments: [assign("arr", "value", { append: true })],
        }),
      ),
    });
  });
});

describe("parse (phase 24: array expressions)", () => {
  it("parses simple array assignment", () => {
    expect(parse("arr=(a b c)")).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          assignments: [
            assign("arr", undefined, {
              array: arrayExpr(arrayElem("a"), arrayElem("b"), arrayElem("c")),
            }),
          ],
        }),
      ),
    });
  });

  it("parses indexed array assignment", () => {
    expect(parse("arr=([0]=x [1]=y)")).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          assignments: [
            assign("arr", undefined, {
              array: arrayExpr(arrayElem("x", "0"), arrayElem("y", "1")),
            }),
          ],
        }),
      ),
    });
  });

  it("parses associative array assignment", () => {
    expect(parse("arr=([key]=val [other]=thing)")).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          assignments: [
            assign("arr", undefined, {
              array: arrayExpr(
                arrayElem("val", "key"),
                arrayElem("thing", "other"),
              ),
            }),
          ],
        }),
      ),
    });
  });

  it("parses empty array", () => {
    expect(parse("arr=()")).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          assignments: [assign("arr", undefined, { array: arrayExpr() })],
        }),
      ),
    });
  });

  it("parses append array", () => {
    expect(parse("arr+=(x y)")).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          assignments: [
            assign("arr", undefined, {
              append: true,
              array: arrayExpr(arrayElem("x"), arrayElem("y")),
            }),
          ],
        }),
      ),
    });
  });
});

describe("parse (phase 25: c-style for loop)", () => {
  it("parses c-style for loop", () => {
    const result = parse("for ((i=0; i<10; i++)); do echo $i; done");
    const first = result.ast.body[0];
    assert(first, "expected at least one statement");
    const command = first.command;
    assert(command.type === "CStyleLoop", "expected CStyleLoop");
    expect(command.init).toMatchAst({
      type: "BinaryArithm",
      op: "=",
      x: {
        type: "ParamExp",
        short: true,
        param: { type: "Literal", value: "i" },
      },
      y: { type: "ArithLit", value: "0" },
    });
    expect(command.cond).toMatchAst({
      type: "BinaryArithm",
      op: "<",
      x: {
        type: "ParamExp",
        short: true,
        param: { type: "Literal", value: "i" },
      },
      y: { type: "ArithLit", value: "10" },
    });
    expect(command.post).toMatchAst({
      type: "UnaryArithm",
      op: "++",
      post: true,
      x: {
        type: "ParamExp",
        short: true,
        param: { type: "Literal", value: "i" },
      },
    });
    expect(command.body).toHaveLength(1);
  });

  it("parses c-style for loop with empty parts", () => {
    expect(parse("for ((;;)); do echo loop; done")).toMatchAst({
      ast: program(stmt(cStyleLoop([stmt(simple("echo", "loop"))]))),
    });
  });

  it("parses c-style for loop with only condition", () => {
    const result = parse("for (( ; i<5; )); do echo $i; done");
    const first = result.ast.body[0];
    assert(first, "expected at least one statement");
    const command = first.command;
    assert(command.type === "CStyleLoop", "expected CStyleLoop");
    expect(command.init).toBeUndefined();
    expect(command.cond).toMatchAst({
      type: "BinaryArithm",
      op: "<",
      x: {
        type: "ParamExp",
        short: true,
        param: { type: "Literal", value: "i" },
      },
      y: { type: "ArithLit", value: "5" },
    });
    expect(command.post).toBeUndefined();
    expect(command.body).toHaveLength(1);
  });
});

describe("parse (phase 26: let clause)", () => {
  it("parses let with single expression", () => {
    expect(parse("let i++")).toMatchAst({
      ast: program(stmt(letClause([word("i++")]))),
    });
  });

  it("parses let with multiple expressions", () => {
    expect(parse("let i++ j=2")).toMatchAst({
      ast: program(stmt(letClause([word("i++"), word("j=2")]))),
    });
  });

  it("parses let with redirect", () => {
    expect(parse("let x=1 2>/dev/null")).toMatchAst({
      ast: program(
        stmt(letClause([word("x=1")], [redirect(">", "/dev/null", "2")])),
      ),
    });
  });
});
