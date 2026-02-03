import { describe, expect, it } from "vitest";
import { parse } from "./index.js";

type Literal = { type: "Literal"; value: string };
type Word = { type: "Word"; parts: Literal[] };
type SimpleCommand = { type: "SimpleCommand"; words: Word[] };
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
const simple = (...words: string[]): SimpleCommand => ({
  type: "SimpleCommand",
  words: words.map(word),
});
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
  });

  it("parses background commands", () => {
    expect(parse("foo &\nbar")).toEqual({
      ast: program(stmt(simple("foo"), true), stmt(simple("bar"))),
    });
  });
});
