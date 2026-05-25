// biome-ignore-all lint/suspicious/noTemplateCurlyInString: shell syntax in test strings
import { describe, expect, it } from "vitest";
import { parse } from "../parse";
import {
  cmdSubst,
  dbl,
  lit,
  paramExp,
  program,
  simple,
  stmt,
  word,
  wordParts,
} from "../test-helpers/ast-builders";

describe("parse (phase 15: parameter expansion)", () => {
  it("parses $var", () => {
    expect(parse("echo $foo")).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("echo"), wordParts(paramExp("foo"))],
        }),
      ),
    });
  });

  it("parses ${var}", () => {
    expect(parse("echo ${foo}")).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("echo"), wordParts(paramExp("foo", false))],
        }),
      ),
    });
  });

  it("parses ${var:-default}", () => {
    expect(parse("echo ${foo:-bar}")).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("echo"), wordParts(paramExp("foo", false, ":-", "bar"))],
        }),
      ),
    });
  });

  it("parses $var inside double quotes", () => {
    expect(parse('"hello $name"')).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [wordParts(dbl(lit("hello "), paramExp("name")))],
        }),
      ),
    });
  });

  it("parses special params $? $# $@", () => {
    expect(parse("echo $?")).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("echo"), wordParts(paramExp("?"))],
        }),
      ),
    });
  });
});

describe("parse (phase 16: command substitution)", () => {
  it("parses $(cmd)", () => {
    expect(parse("echo $(foo)")).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("echo"), wordParts(cmdSubst(stmt(simple("foo"))))],
        }),
      ),
    });
  });

  it("parses backtick substitution", () => {
    expect(parse("echo `foo`")).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("echo"), wordParts(cmdSubst(stmt(simple("foo"))))],
        }),
      ),
    });
  });

  it("parses $(cmd) inside double quotes", () => {
    expect(parse('"$(foo)"')).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [wordParts(dbl(cmdSubst(stmt(simple("foo")))))],
        }),
      ),
    });
  });
});

describe("parse (phase 17: arithmetic expansion)", () => {
  it("parses $((expr))", () => {
    const { ast } = parse("echo $((1 + 2))");
    const cmd = ast.body[0]?.command;
    if (cmd?.type !== "SimpleCommand")
      throw new Error("expected SimpleCommand");
    const expansion = cmd.words?.[1]?.parts[0];
    expect(expansion).toMatchAst({
      type: "ArithExp",
      x: {
        type: "BinaryArithm",
        op: "+",
        x: { type: "ArithLit", value: "1" },
        y: { type: "ArithLit", value: "2" },
      },
    });
  });
});

describe("parse (phase 19: process substitution)", () => {
  it("parses <() process substitution", () => {
    expect(parse("diff <(foo) <(bar)")).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [
            word("diff"),
            wordParts({
              type: "ProcSubst",
              op: "<",
              stmts: [stmt(simple("foo"))],
            }),
            wordParts({
              type: "ProcSubst",
              op: "<",
              stmts: [stmt(simple("bar"))],
            }),
          ],
        }),
      ),
    });
  });
});

describe("parse (phase 20: mixed expansions)", () => {
  it("parses mixed literal and expansion in word", () => {
    expect(parse("echo foo${bar}baz")).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [
            word("echo"),
            wordParts(lit("foo"), paramExp("bar", false), lit("baz")),
          ],
        }),
      ),
    });
  });

  it("parses nested command substitution", () => {
    expect(parse("echo $(echo $(foo))")).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [
            word("echo"),
            wordParts(
              cmdSubst(
                stmt({
                  type: "SimpleCommand",
                  words: [
                    word("echo"),
                    wordParts(cmdSubst(stmt(simple("foo")))),
                  ],
                }),
              ),
            ),
          ],
        }),
      ),
    });
  });
});
