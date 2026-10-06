import { describe, expect, it } from "vitest";
import type { Logical, Pos } from "../ast";
import { parse } from "../parse";
import { program, simple, stmt, word } from "../test-helpers/ast-builders";

function expectDefined<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  if (value === undefined) throw new Error("expected value to be defined");
  return value;
}

describe("parse (phase 1: simple commands)", () => {
  it("parses empty input", () => {
    expect(parse("")).toMatchAst({ ast: program() });
  });

  it("parses a single simple command", () => {
    expect(parse("foo")).toMatchAst({ ast: program(stmt(simple("foo"))) });
  });

  it("parses multiple statements separated by newline or semicolon", () => {
    expect(parse("foo\nbar")).toMatchAst({
      ast: program(stmt(simple("foo")), stmt(simple("bar"))),
    });

    expect(parse("foo; bar;")).toMatchAst({
      ast: program(stmt(simple("foo")), stmt(simple("bar"))),
    });
  });

  it("parses pipelines", () => {
    expect(parse("foo | bar")).toMatchAst({
      ast: program(
        stmt({
          type: "Pipeline",
          commands: [stmt(simple("foo")), stmt(simple("bar"))],
        }),
      ),
    });

    expect(parse("foo | bar | baz")).toMatchAst({
      ast: program(
        stmt({
          type: "Pipeline",
          commands: [
            stmt(simple("foo")),
            stmt(simple("bar")),
            stmt(simple("baz")),
          ],
        }),
      ),
    });
  });

  it("parses logical and/or", () => {
    expect(parse("foo && bar")).toMatchAst({
      ast: program(
        stmt({
          type: "Logical",
          op: "and",
          left: stmt(simple("foo")),
          right: stmt(simple("bar")),
        }),
      ),
    });

    expect(parse("foo || bar")).toMatchAst({
      ast: program(
        stmt({
          type: "Logical",
          op: "or",
          left: stmt(simple("foo")),
          right: stmt(simple("bar")),
        }),
      ),
    });

    expect(parse("foo && bar || baz")).toMatchAst({
      ast: program(
        stmt({
          type: "Logical",
          op: "or",
          left: stmt({
            type: "Logical",
            op: "and",
            left: stmt(simple("foo")),
            right: stmt(simple("bar")),
          }),
          right: stmt(simple("baz")),
        }),
      ),
    });
  });

  it("gives pipelines higher precedence than logical ops", () => {
    expect(parse("foo | bar || baz")).toMatchAst({
      ast: program(
        stmt({
          type: "Logical",
          op: "or",
          left: stmt({
            type: "Pipeline",
            commands: [stmt(simple("foo")), stmt(simple("bar"))],
          }),
          right: stmt(simple("baz")),
        }),
      ),
    });
  });

  it("parses background commands", () => {
    expect(parse("foo &\nbar")).toMatchAst({
      ast: program(stmt(simple("foo"), true), stmt(simple("bar"))),
    });
  });

  it("gives the Logical statement an end position on the continued line", () => {
    const { ast } = parse("foo &&\nbar");
    const logical = expectDefined(ast.body[0]).command as Logical;
    expect(logical.pos).toEqual<Pos>({ offset: 0, line: 1, col: 1 });
    expect(logical.end).toEqual<Pos>({ offset: 10, line: 2, col: 4 });
  });

  it("parses comments in operator continuations", () => {
    expect(parse("foo && # comment\nbar")).toMatchAst({
      ast: program(
        stmt({
          type: "Logical",
          op: "and",
          left: stmt(simple("foo")),
          right: stmt(simple("bar")),
        }),
      ),
    });

    expect(parse("foo || # comment\nbar")).toMatchAst({
      ast: program(
        stmt({
          type: "Logical",
          op: "or",
          left: stmt(simple("foo")),
          right: stmt(simple("bar")),
        }),
      ),
    });

    expect(parse("foo | # comment\nbar")).toMatchAst({
      ast: program(
        stmt({
          type: "Pipeline",
          commands: [stmt(simple("foo")), stmt(simple("bar"))],
        }),
      ),
    });
  });

  it("parses comments and blank lines in operator continuations", () => {
    expect(parse("foo &&\n# comment\n\nbar")).toMatchAst({
      ast: program(
        stmt({
          type: "Logical",
          op: "and",
          left: stmt(simple("foo")),
          right: stmt(simple("bar")),
        }),
      ),
    });
  });

  it("parses line breaks in operator continuations", () => {
    expect(parse("foo &&\nbar")).toMatchAst({
      ast: program(
        stmt({
          type: "Logical",
          op: "and",
          left: stmt(simple("foo")),
          right: stmt(simple("bar")),
        }),
      ),
    });

    expect(parse("foo |\nbar")).toMatchAst({
      ast: program(
        stmt({
          type: "Pipeline",
          commands: [stmt(simple("foo")), stmt(simple("bar"))],
        }),
      ),
    });
  });

  it("parses a heredoc body after a comment in an operator continuation", () => {
    expect(parse("cmd <<EOF && # c\nbody\nEOF\ntrue")).toMatchAst({
      ast: program(
        stmt({
          type: "Logical",
          op: "and",
          left: stmt({
            type: "SimpleCommand",
            words: [word("cmd")],
            redirects: [
              {
                type: "Redirect",
                op: "<<",
                target: word("EOF"),
                heredoc: word("body\n"),
              },
            ],
          }),
          right: stmt(simple("true")),
        }),
      ),
    });
  });

  it("rejects && with no right-hand side", () => {
    expect(() => parse("foo && # comment")).toThrowError(
      "Expected command after && at 1:5",
    );

    expect(() => parse("foo &&")).toThrowError(
      "Expected command after && at 1:5",
    );
  });

  it("rejects a literal ; after an operator", () => {
    expect(() => parse("foo && ; bar")).toThrowError("Expected a command word");
  });

  it("rejects an operator continuation inside groups and blocks", () => {
    expect(() => parse("(foo &&\n)")).toThrowError();

    expect(() => parse("{ foo &&\n}")).toThrowError();
  });
});

describe("parse (phase 10: negation)", () => {
  it("parses negated commands", () => {
    expect(parse("! foo")).toMatchAst({
      ast: program(stmt(simple("foo"), false, true)),
    });
  });
});
