import { describe, expect, it } from "vitest";
import { parse } from "../parse";
import {
  arrayElem,
  arrayExpr,
  assign,
  block,
  coprocClause,
  functionDecl,
  program,
  redirect,
  simple,
  stmt,
  timeClause,
  word,
} from "../test-helpers/ast-builders";

/**
 * Unit tests for the commands module: statements (negation, background),
 * pipelines, simple commands, assignments, array assignments, function
 * declarations, coproc and time clauses. The broad public-surface
 * behavior lives in basic.test.ts; clause bodies are covered by
 * clauses.test.ts.
 */
describe("parseStatement", () => {
  it("parses negation with comments and newlines after !", () => {
    expect(parse("! foo").ast).toMatchAst(
      program(stmt(simple("foo"), false, true)),
    );
    expect(parse("! # c\nfoo").ast).toMatchAst(
      program(stmt(simple("foo"), false, true)),
    );
  });

  it("parses background statements", () => {
    expect(parse("foo &").ast).toMatchAst(program(stmt(simple("foo"), true)));
    expect(parse("foo &\nbar").ast).toMatchAst(
      program(stmt(simple("foo"), true), stmt(simple("bar"))),
    );
  });

  it("rejects ; after & (bash parity)", () => {
    expect(() => parse("foo & ; bar")).toThrowError(
      "`&` cannot be followed by `;`",
    );
  });
});

describe("parsePipeline", () => {
  it("parses pipelines", () => {
    const { ast } = parse("foo | bar | baz");
    expect(ast.body).toHaveLength(1);
    expect(ast.body[0]?.command).toMatchObject({ type: "Pipeline" });
  });
});

describe("parseSimpleCommand", () => {
  it("parses words, assignments and redirects in any order", () => {
    expect(parse("A=1 foo >f bar").ast).toMatchAst(
      program(
        stmt({
          type: "SimpleCommand",
          assignments: [assign("A", "1")],
          redirects: [redirect(">", "f")],
          words: [word("foo"), word("bar")],
        }),
      ),
    );
  });

  it("stops assignments after the first word", () => {
    expect(parse("foo A=1").ast).toMatchAst(
      program(stmt(simple("foo", "A=1"))),
    );
  });

  it("rejects a bare separator", () => {
    expect(() => parse(";")).toThrowError("Expected a command word");
  });
});

describe("tryParseAssignment", () => {
  it("parses plain, appended and array assignments", () => {
    expect(parse("A=1").ast).toMatchAst(
      program(
        stmt({
          type: "SimpleCommand",
          assignments: [assign("A", "1")],
        }),
      ),
    );
    expect(parse("A+=1").ast).toMatchAst(
      program(
        stmt({
          type: "SimpleCommand",
          assignments: [assign("A", "1", { append: true })],
        }),
      ),
    );
    expect(parse("A=(1 2 [i]=3)").ast).toMatchAst(
      program(
        stmt({
          type: "SimpleCommand",
          assignments: [
            assign("A", undefined, {
              array: arrayExpr(
                arrayElem("1"),
                arrayElem("2"),
                arrayElem("3", "i"),
              ),
            }),
          ],
        }),
      ),
    );
  });

  it("allows newlines and comments but not ; inside arrays", () => {
    expect(() => parse("A=(1\n2)")).not.toThrow();
    expect(() => parse("A=(1;2)")).toThrowError(
      "Expected word in array expression",
    );
  });
});

describe("parseFunctionDecl", () => {
  it("parses both declaration forms", () => {
    expect(parse("foo() { bar; }").ast).toMatchAst(
      program(stmt(functionDecl("foo", [stmt(simple("bar"))]))),
    );
    expect(parse("function foo { bar; }").ast).toMatchAst(
      program(stmt(functionDecl("foo", [stmt(simple("bar"))]))),
    );
  });

  it("allows comments and newlines between () and the body", () => {
    expect(parse("x() # c\n{ foo; }").ast).toMatchAst(
      program(stmt(functionDecl("x", [stmt(simple("foo"))]))),
    );
    expect(parse("x()\n{ foo; }").ast).toMatchAst(
      program(stmt(functionDecl("x", [stmt(simple("foo"))]))),
    );
  });

  it("rejects a function without a body block", () => {
    expect(() => parse("function x")).toThrowError(
      "Expected function body block",
    );
  });
});

describe("parseCoprocClause", () => {
  it("parses coproc with and without a name", () => {
    expect(parse("coproc foo").ast).toMatchAst(
      program(stmt(coprocClause(stmt(simple("foo"))))),
    );
    expect(parse("coproc NAME { foo; }").ast).toMatchAst(
      program(stmt(coprocClause(stmt(block(stmt(simple("foo")))), "NAME"))),
    );
  });
});

describe("parseTimeClause", () => {
  it("parses time clauses", () => {
    expect(parse("time foo").ast).toMatchAst(
      program(stmt(timeClause(stmt(simple("foo"))))),
    );
  });
});
