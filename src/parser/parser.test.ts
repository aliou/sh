import { describe, expect, it } from "vitest";
import { parse } from "../parse";
import { parseStmtsSeq, parseWordsSeq } from "../seq";
import { program, simple, stmt } from "../test-helpers/ast-builders";
import { tokenize } from "../tokenizer";
import { Parser } from "./parser";

/**
 * Unit tests for the parser class shell: the program entry points
 * (`parseProgram`, `parseProgramRecovering`, the streaming sequences).
 * The broad public-surface behavior lives in basic.test.ts.
 */
describe("Parser", () => {
  it("parses a program through the class directly", () => {
    const parser = new Parser(tokenize("foo; bar"));
    expect(parser.parseProgram()).toMatchAst(
      program(stmt(simple("foo")), stmt(simple("bar"))),
    );
    parser.assertEof();
  });

  it("assertEof rejects leftover tokens", () => {
    const parser = new Parser(tokenize("foo; bar"));
    parser.parseProgram();
    parser.assertEof();
    expect(() => new Parser(tokenize("foo")).assertEof()).toThrowError(
      "Unexpected token: foo",
    );
  });

  it("streams statements lazily", () => {
    const stmts = [...parseStmtsSeq("foo\nbar")];
    expect(stmts).toHaveLength(2);
    // A trailing separator is consumed without yielding an extra
    // statement.
    expect([...parseStmtsSeq("foo;\n")]).toHaveLength(1);
  });

  it("streams words, skipping separators and operators", () => {
    const words = [...parseWordsSeq("foo\n; | bar")];
    expect(words.map((w) => w.parts[0])).toMatchObject([
      { type: "Literal", value: "foo" },
      { type: "Literal", value: "bar" },
    ]);
  });

  it("recovering mode keeps the operator position on errors", () => {
    const { ast, errors } = parse("foo && # c", { recoverErrors: true });
    expect(errors?.[0]?.pos).toMatchObject({ offset: 4 });
    expect(ast.body).toHaveLength(0);
  });
});
