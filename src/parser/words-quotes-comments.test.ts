import { describe, expect, it } from "vitest";
import { parse } from "../parse";
import {
  dbl,
  lit,
  program,
  sgl,
  simple,
  stmt,
  wordParts,
} from "../test-helpers/ast-builders";

describe("parse (phase 2: words, quotes, comments)", () => {
  it("ignores full-line and trailing comments", () => {
    expect(parse("# foo\nbar")).toMatchAst({
      ast: program(stmt(simple("bar"))),
    });

    expect(parse("foo # bar")).toMatchAst({
      ast: program(stmt(simple("foo"))),
    });
  });

  it("keeps # when not at a boundary", () => {
    expect(parse("foo#bar")).toMatchAst({
      ast: program(stmt(simple("foo#bar"))),
    });
  });

  it("parses single-quoted parts", () => {
    expect(parse("foo'bar'")).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [wordParts(lit("foo"), sgl("bar"))],
        }),
      ),
    });
  });

  it("parses double-quoted parts", () => {
    expect(parse('"foo bar"')).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [wordParts(dbl(lit("foo bar")))],
        }),
      ),
    });
  });

  it("treats backslash-newline as whitespace", () => {
    expect(parse("foo \\\n bar")).toMatchAst({
      ast: program(stmt(simple("foo", "bar"))),
    });
  });
  it("treats backslash-CRLF as whitespace", () => {
    expect(parse("foo \\\r\n bar")).toMatchAst({
      ast: program(stmt(simple("foo", "bar"))),
    });
  });

  it("keeps escaped parentheses as literal words", () => {
    expect(parse('find . \\( -name "*.cs" \\)')).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [
            wordParts(lit("find")),
            wordParts(lit(".")),
            wordParts(lit("(")),
            wordParts(lit("-name")),
            wordParts(dbl(lit("*.cs"))),
            wordParts(lit(")")),
          ],
        }),
      ),
    });
  });

  it("keeps escaped spaces inside the same word", () => {
    expect(parse("echo a\\ b")).toMatchAst({
      ast: program(stmt(simple("echo", "a b"))),
    });
  });

  it("keeps escaped operators inside literal words", () => {
    expect(parse("echo foo\\;bar")).toMatchAst({
      ast: program(stmt(simple("echo", "foo;bar"))),
    });

    expect(parse("echo a\\|b")).toMatchAst({
      ast: program(stmt(simple("echo", "a|b"))),
    });
  });

  it("keeps a trailing backslash literal", () => {
    expect(parse("echo foo\\")).toMatchAst({
      ast: program(stmt(simple("echo", "foo\\"))),
    });
  });
});
