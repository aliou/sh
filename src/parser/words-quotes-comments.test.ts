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
    expect(parse("# foo\nbar")).toEqual({
      ast: program(stmt(simple("bar"))),
    });

    expect(parse("foo # bar")).toEqual({
      ast: program(stmt(simple("foo"))),
    });
  });

  it("keeps # when not at a boundary", () => {
    expect(parse("foo#bar")).toEqual({
      ast: program(stmt(simple("foo#bar"))),
    });
  });

  it("parses single-quoted parts", () => {
    expect(parse("foo'bar'")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [wordParts(lit("foo"), sgl("bar"))],
        }),
      ),
    });
  });

  it("parses double-quoted parts", () => {
    expect(parse('"foo bar"')).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [wordParts(dbl(lit("foo bar")))],
        }),
      ),
    });
  });

  it("treats backslash-newline as whitespace", () => {
    expect(parse("foo \\\n bar")).toEqual({
      ast: program(stmt(simple("foo", "bar"))),
    });
  });
});
