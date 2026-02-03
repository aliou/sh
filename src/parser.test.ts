import { describe, expect, it } from "vitest";
import { parse } from "./index.js";

type Literal = { type: "Literal"; value: string };
type Word = { type: "Word"; parts: Literal[] };
type Assignment = { type: "Assignment"; name: string; value?: Word };
type Redirect = {
  type: "Redirect";
  op: ">" | "<" | ">>";
  fd?: string;
  target: Word;
};
type SimpleCommand = {
  type: "SimpleCommand";
  words?: Word[];
  assignments?: Assignment[];
  redirects?: Redirect[];
};
type Pipeline = { type: "Pipeline"; commands: Statement[] };
type Logical = {
  type: "Logical";
  op: "and" | "or";
  left: Statement;
  right: Statement;
};
type Statement = {
  type: "Statement";
  command: Command;
  background?: boolean;
};
type Program = { type: "Program"; body: Statement[] };
type Command = SimpleCommand | Pipeline | Logical;

const lit = (value: string): Literal => ({ type: "Literal", value });
const word = (value: string): Word => ({ type: "Word", parts: [lit(value)] });
const wordParts = (...parts: string[]): Word => ({
  type: "Word",
  parts: parts.map(lit),
});
const simple = (...words: string[]): SimpleCommand => ({
  type: "SimpleCommand",
  words: words.map(word),
});
const assign = (name: string, value?: string): Assignment =>
  value === undefined
    ? { type: "Assignment", name }
    : { type: "Assignment", name, value: word(value) };
const redirect = (
  op: ">" | "<" | ">>",
  target: string,
  fd?: string,
): Redirect =>
  fd === undefined
    ? { type: "Redirect", op, target: word(target) }
    : { type: "Redirect", op, target: word(target), fd };
const stmt = (command: Command, background = false): Statement =>
  background
    ? { type: "Statement", command, background }
    : { type: "Statement", command };
const program = (...body: Statement[]): Program => ({ type: "Program", body });

// Tests derived from mvdan/sh syntax/filetests_test.go command parsing cases.
describe("parse (phase 1: simple commands)", () => {
  it("parses empty input", () => {
    expect(parse("")).toEqual({ ast: program() });
  });

  it("parses a single simple command", () => {
    expect(parse("foo")).toEqual({ ast: program(stmt(simple("foo"))) });
  });

  it("parses multiple statements separated by newline or semicolon", () => {
    expect(parse("foo\nbar")).toEqual({
      ast: program(stmt(simple("foo")), stmt(simple("bar"))),
    });

    expect(parse("foo; bar;")).toEqual({
      ast: program(stmt(simple("foo")), stmt(simple("bar"))),
    });
  });

  it("parses pipelines", () => {
    expect(parse("foo | bar")).toEqual({
      ast: program(
        stmt({
          type: "Pipeline",
          commands: [stmt(simple("foo")), stmt(simple("bar"))],
        }),
      ),
    });

    expect(parse("foo | bar | baz")).toEqual({
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
    expect(parse("foo && bar")).toEqual({
      ast: program(
        stmt({
          type: "Logical",
          op: "and",
          left: stmt(simple("foo")),
          right: stmt(simple("bar")),
        }),
      ),
    });

    expect(parse("foo || bar")).toEqual({
      ast: program(
        stmt({
          type: "Logical",
          op: "or",
          left: stmt(simple("foo")),
          right: stmt(simple("bar")),
        }),
      ),
    });

    expect(parse("foo && bar || baz")).toEqual({
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
    expect(parse("foo | bar || baz")).toEqual({
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
    expect(parse("foo &\nbar")).toEqual({
      ast: program(stmt(simple("foo"), true), stmt(simple("bar"))),
    });
  });
});

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

  it("parses single-quoted parts as literals", () => {
    expect(parse("foo'bar'")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [wordParts("foo", "bar")],
        }),
      ),
    });
  });

  it("parses double-quoted parts as literals", () => {
    expect(parse('"foo bar"')).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("foo bar")],
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

describe("parse (phase 3: assignments and redirects)", () => {
  it("parses assignment-only commands", () => {
    expect(parse("a=b")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          assignments: [assign("a", "b")],
        }),
      ),
    });
  });

  it("parses assignments before words", () => {
    expect(parse("a=b foo")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          assignments: [assign("a", "b")],
          words: [word("foo")],
        }),
      ),
    });
  });

  it("parses redirects", () => {
    expect(parse("foo >out")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("foo")],
          redirects: [redirect(">", "out")],
        }),
      ),
    });

    expect(parse(">out foo")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("foo")],
          redirects: [redirect(">", "out")],
        }),
      ),
    });
  });

  it("parses redirects with file descriptors", () => {
    expect(parse("foo 2>out")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("foo")],
          redirects: [redirect(">", "out", "2")],
        }),
      ),
    });
  });
});
