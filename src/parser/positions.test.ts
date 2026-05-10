import { describe, expect, it } from "vitest";
import type { Pos, SimpleCommand, WhileClause } from "../ast";
import { parse } from "../parse";

describe("position tracking", () => {
  it("attaches pos/end to the program", () => {
    const { ast } = parse("foo bar");
    expect(ast.pos).toEqual<Pos>({ offset: 0, line: 1, col: 1 });
    expect(ast.end).toEqual<Pos>({ offset: 7, line: 1, col: 8 });
  });

  it("attaches pos/end to simple commands and words", () => {
    const { ast } = parse("foo bar");
    const stmt = ast.body[0]!;
    expect(stmt.pos).toEqual<Pos>({ offset: 0, line: 1, col: 1 });
    expect(stmt.end).toEqual<Pos>({ offset: 7, line: 1, col: 8 });
    const cmd = stmt.command as SimpleCommand;
    expect(cmd.pos).toEqual<Pos>({ offset: 0, line: 1, col: 1 });
    expect(cmd.end).toEqual<Pos>({ offset: 7, line: 1, col: 8 });
    const [foo, bar] = cmd.words!;
    expect(foo!.pos).toEqual<Pos>({ offset: 0, line: 1, col: 1 });
    expect(foo!.end).toEqual<Pos>({ offset: 3, line: 1, col: 4 });
    expect(bar!.pos).toEqual<Pos>({ offset: 4, line: 1, col: 5 });
    expect(bar!.end).toEqual<Pos>({ offset: 7, line: 1, col: 8 });
  });

  it("tracks line and column across newlines", () => {
    const { ast } = parse("foo\nbar");
    const second = ast.body[1]!;
    expect(second.pos).toEqual<Pos>({ offset: 4, line: 2, col: 1 });
    expect(second.end).toEqual<Pos>({ offset: 7, line: 2, col: 4 });
  });

  it("spans control flow statements from keyword to terminator", () => {
    const src = "while true; do echo hi; done";
    const { ast } = parse(src);
    const wh = ast.body[0]!.command as WhileClause;
    expect(wh.pos).toEqual<Pos>({ offset: 0, line: 1, col: 1 });
    expect(wh.end).toEqual<Pos>({ offset: src.length, line: 1, col: 29 });
  });

  it("handles tabs as a single column", () => {
    const { ast } = parse("\tfoo");
    const stmt = ast.body[0]!;
    expect(stmt.pos).toEqual<Pos>({ offset: 1, line: 1, col: 2 });
  });

  it("attaches pos/end to expansions inside words", () => {
    const { ast } = parse("echo $foo");
    const cmd = ast.body[0]!.command as SimpleCommand;
    const expansion = cmd.words![1]!.parts[0]!;
    expect(expansion.type).toBe("ParamExp");
    expect(expansion.pos).toEqual<Pos>({ offset: 5, line: 1, col: 6 });
    expect(expansion.end).toEqual<Pos>({ offset: 9, line: 1, col: 10 });
  });
});
