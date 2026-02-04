import { describe, expect, it } from "vitest";
import type { RedirOp } from "../ast";
import { parse } from "../parse";
import {
  assign,
  program,
  redirect,
  stmt,
  word,
} from "../test-helpers/ast-builders";

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

describe("parse (phase 12: extended redirects)", () => {
  it.each([
    { input: "foo >| bar", op: ">|" as RedirOp, target: "bar" },
    { input: "foo >&2", op: ">&" as RedirOp, target: "2" },
    { input: "foo <&3", op: "<&" as RedirOp, target: "3" },
    { input: "foo &>bar", op: "&>" as RedirOp, target: "bar" },
    { input: "foo &>>bar", op: "&>>" as RedirOp, target: "bar" },
    { input: "foo <<<bar", op: "<<<" as RedirOp, target: "bar" },
    { input: "foo <>bar", op: "<>" as RedirOp, target: "bar" },
  ])("parses $op redirect", ({ input, op, target }) => {
    expect(parse(input)).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("foo")],
          redirects: [redirect(op, target)],
        }),
      ),
    });
  });

  it("parses fd dup with explicit fd 2>&1", () => {
    expect(parse("foo 2>&1")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("foo")],
          redirects: [redirect(">&", "1", "2")],
        }),
      ),
    });
  });
});
