import { describe, expect, it } from "vitest";
import { parse } from "../parse";

describe("parse (phase 27: comments)", () => {
  it("does not include comments by default", () => {
    const result = parse("echo hi # a comment");
    expect(result.ast.comments).toBeUndefined();
  });

  it("collects comments when keepComments is true", () => {
    const result = parse("echo hi # a comment", { keepComments: true });
    expect(result.ast.comments).toEqual([
      { type: "Comment", text: " a comment" },
    ]);
  });

  it("collects multiple comments", () => {
    const result = parse("# first\necho hi\n# second", {
      keepComments: true,
    });
    expect(result.ast.comments).toEqual([
      { type: "Comment", text: " first" },
      { type: "Comment", text: " second" },
    ]);
  });

  it("collects inline comment after semicolon", () => {
    const result = parse("echo hi; # trailing", { keepComments: true });
    expect(result.ast.comments).toEqual([
      { type: "Comment", text: " trailing" },
    ]);
  });
});
