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
    expect(parse("a=b")).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          assignments: [assign("a", "b")],
        }),
      ),
    });
  });

  it("parses assignments before words", () => {
    expect(parse("a=b foo")).toMatchAst({
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
    expect(parse("foo >out")).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("foo")],
          redirects: [redirect(">", "out")],
        }),
      ),
    });

    expect(parse(">out foo")).toMatchAst({
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
    expect(parse("foo 2>out")).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("foo")],
          redirects: [redirect(">", "out", "2")],
        }),
      ),
    });
  });

  it.each(["bash", "zsh"] as const)(
    "parses named file descriptor redirects in %s",
    (dialect) => {
      expect(parse("foo {fd}<f", { dialect })).toMatchAst({
        ast: program(
          stmt({
            type: "SimpleCommand",
            words: [word("foo")],
            redirects: [redirect("<", "f", "{fd}")],
          }),
        ),
      });
    },
  );

  it("parses named file descriptor redirects before the command", () => {
    expect(parse("{fd}>>out foo")).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("foo")],
          redirects: [redirect(">>", "out", "{fd}")],
        }),
      ),
    });
  });

  it.each(["{1fd}>out", "{fd-x}>out", "{}>out"])(
    "treats %s as a word, not a named redirect",
    (source) => {
      const { ast } = parse(`foo ${source}`);
      const command = ast.body[0]?.command as {
        words?: { parts: { value?: string }[] }[];
        redirects?: { fd?: string }[];
      };
      expect(command.redirects?.[0]?.fd).toBeUndefined();
      expect(command.words?.[1]?.parts[0]?.value).toBe(source.split(">")[0]);
    },
  );

  it("does not treat brace groups as named redirects", () => {
    expect(parse("{ foo; }").ast.body[0]?.command.type).toBe("Block");
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
    expect(parse(input)).toMatchAst({
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
    expect(parse("foo 2>&1")).toMatchAst({
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
