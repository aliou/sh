import { describe, expect, it } from "vitest";
import { parse } from "../parse";

describe("parse (phase 27: comments)", () => {
  it("does not include comments by default", () => {
    const result = parse("echo hi # a comment");
    expect(result.ast.comments).toBeUndefined();
  });

  it("collects comments when keepComments is true", () => {
    const result = parse("echo hi # a comment", { keepComments: true });
    expect(result.ast.comments).toMatchAst([
      { type: "Comment", text: " a comment" },
    ]);
  });

  it("collects multiple comments", () => {
    const result = parse("# first\necho hi\n# second", {
      keepComments: true,
    });
    expect(result.ast.comments).toMatchAst([
      { type: "Comment", text: " first" },
      { type: "Comment", text: " second" },
    ]);
  });

  it("collects inline comment after semicolon", () => {
    const result = parse("echo hi; # trailing", { keepComments: true });
    expect(result.ast.comments).toMatchAst([
      { type: "Comment", text: " trailing" },
    ]);
  });

  it("collects comment between && and the continued command", () => {
    const result = parse("foo && # first\nbar", { keepComments: true });
    expect(result.ast.comments).toMatchAst([
      { type: "Comment", text: " first" },
    ]);
  });

  it("collects comments between || and pipe continuations", () => {
    const result = parse("foo || # one\nbar | # two\nbaz", {
      keepComments: true,
    });
    expect(result.ast.comments).toMatchAst([
      { type: "Comment", text: " one" },
      { type: "Comment", text: " two" },
    ]);
  });
});
