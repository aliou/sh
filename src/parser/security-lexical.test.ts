import { describe, expect, it } from "vitest";
import type { Pos, SimpleCommand, Statement } from "../ast";
import { parse } from "../parse";
import { extractCommandNames } from "../test-helpers/extract-command-names";
import type { Token, TokenWordPart } from "../tokenizer";
import { Parser } from "./index";

/**
 * Quoting/lexeme fidelity fixtures
 * (tmp/security-audit/run-1/lib/cases-v3-lexical.json). Assignment-prefix
 * and escape-provenance semantics the parser owns, tested end-to-end where
 * today's tokenizer suffices and with handwritten contract token streams
 * (token-api.md §1/§6) where the new token shapes are required.
 *
 * Payloads:
 *   ansi_c:         echo $'a\'b'; ...
 *   ansi_name_echo: $'\x65cho' ANSI_NAME_MARKER
 *   esc_time:       \time echo ARGUMENT
 *   esc_assign:     X\=1 echo ASSIGNMENT
 *   assign_quoted:  X="v" echo ASSIGN_NAME_MARKER
 *   assign_control: X=v echo ASSIGN_CONTROL_MARKER
 */

let cursor = 0;
const at = (len: number): { pos: Pos; end: Pos } => {
  const pos: Pos = { offset: cursor, line: 1, col: cursor + 1 };
  cursor += len;
  const end: Pos = { offset: cursor, line: 1, col: cursor + 1 };
  return { pos, end };
};

function word(...parts: TokenWordPart[]): Token {
  const span = at(3);
  return { type: "word", parts, ...span };
}

function lit(value: string, escaped = false): TokenWordPart {
  const span = at(value.length);
  const part: TokenWordPart = { type: "lit", value, ...span };
  if (escaped) part.escaped = true;
  return part;
}

function ansiC(value: string, raw?: string): TokenWordPart {
  const span = at(value.length + 3);
  return { type: "ansi-c", value, raw: raw ?? value, ...span };
}

function parseTokens(tokens: Token[]) {
  cursor = 0;
  const parser = new Parser(tokens);
  const ast = parser.parseProgram();
  parser.assertEof();
  return ast;
}

describe("security: quoting lexeme fidelity", () => {
  it("ansi_c: $'a\\'b' becomes an AnsiC node with a decoded value", () => {
    const ast = parseTokens([
      word(lit("echo")),
      word(ansiC("a\\'b")),
      word(lit("x")),
    ]);
    const cmd = ast.body[0]?.command as SimpleCommand;
    const part = cmd.words?.[1]?.parts[0];
    expect(part).toMatchAst({ type: "AnsiC", value: "a'b", raw: "a\\'b" });
  });

  it("ansi_c decodes standard escapes", () => {
    const ast = parseTokens([
      word(lit("echo")),
      word(ansiC("n\\nx\\t\\x41\\101")),
    ]);
    const cmd = ast.body[0]?.command as SimpleCommand;
    expect(cmd.words?.[1]?.parts[0]).toMatchAst({
      type: "AnsiC",
      value: "n\nx\tAA",
      raw: "n\\nx\\t\\x41\\101",
    });
  });

  it("ansi_name_echo: $'\\x65cho' decodes to echo without spurious quoting splits", () => {
    const ast = parseTokens([
      word(ansiC("\\x65cho")),
      word(lit("ANSI_NAME_MARKER")),
    ]);
    const cmd = ast.body[0]?.command as SimpleCommand;
    const part = cmd.words?.[0]?.parts[0];
    expect(part).toMatchAst({ type: "AnsiC", value: "echo", raw: "\\x65cho" });
  });

  it("locale-str token parts become LocaleStr nodes", () => {
    const ast = parseTokens([
      word(lit("echo")),
      word({
        type: "locale-str",
        parts: [lit("hello")],
        ...at(9),
      }),
    ]);
    const cmd = ast.body[0]?.command as SimpleCommand;
    expect(cmd.words?.[1]?.parts[0]).toMatchAst({
      type: "LocaleStr",
      parts: [{ type: "Literal", value: "hello" }],
    });
  });

  it("esc_time: an escaped keyword is not a keyword", () => {
    const ast = parseTokens([
      word(lit("t", true), lit("ime")),
      word(lit("echo")),
      word(lit("ARGUMENT")),
    ]);
    const stmt = ast.body[0] as Statement;
    expect(stmt.command.type).toBe("SimpleCommand");
    // The command name is still recoverable from the flattened literals.
    expect(extractCommandNames(ast)).toEqual(["time", "ARGUMENT"].slice(0, 1));
  });

  it("esc_assign: an escaped = is not an assignment delimiter", () => {
    const ast = parseTokens([
      word(lit("X"), lit("=", true), lit("1")),
      word(lit("echo")),
      word(lit("ASSIGNMENT")),
    ]);
    const cmd = ast.body[0]?.command as SimpleCommand;
    expect(cmd.assignments).toBeUndefined();
    expect(cmd.words?.length).toBe(3);
    expect(extractCommandNames(ast)).toEqual(["X=1"]);
  });

  it("an escaped keyword character does not match declaration keywords", () => {
    const parser = new Parser([
      word(lit("d", true), lit("eclare")),
      word(lit("x")),
    ]);
    const ast = parser.parseProgram();
    parser.assertEof();
    expect(ast.body[0]?.command.type).toBe("SimpleCommand");
  });

  it('assign_quoted: X="v" keeps a structured quoted value', () => {
    const { ast } = parse('X="v" echo ASSIGN_NAME_MARKER');
    const cmd = ast.body[0]?.command as SimpleCommand;
    expect(cmd.assignments?.[0]?.name).toBe("X");
    expect(cmd.assignments?.[0]?.value).toMatchAst({
      type: "Word",
      parts: [{ type: "DblQuoted", parts: [{ type: "Literal", value: "v" }] }],
    });
    expect(extractCommandNames(ast)).toEqual(["echo"]);
  });

  it("assign_quoted with an expanded value: X=$(...) stays structured", () => {
    const { ast } = parse("X=$(echo X_SUB_MARKER) true");
    const cmd = ast.body[0]?.command as SimpleCommand;
    expect(cmd.assignments?.[0]?.name).toBe("X");
    expect(cmd.assignments?.[0]?.value?.parts[0]?.type).toBe("CmdSubst");
    expect(extractCommandNames(ast)).toContain("echo");
  });

  it("assign_control: plain X=v assignment is unchanged", () => {
    const { ast } = parse("X=v echo ASSIGN_CONTROL_MARKER");
    const cmd = ast.body[0]?.command as SimpleCommand;
    expect(cmd.assignments?.[0]?.name).toBe("X");
    expect(cmd.assignments?.[0]?.value).toMatchAst({
      type: "Word",
      parts: [{ type: "Literal", value: "v" }],
    });
    expect(extractCommandNames(ast)).toEqual(["echo"]);
  });

  it('X+="v" is an append assignment with a quoted value', () => {
    const { ast } = parse('X+="v" true');
    const cmd = ast.body[0]?.command as SimpleCommand;
    expect(cmd.assignments?.[0]?.append).toBe(true);
    expect(cmd.assignments?.[0]?.value).toMatchAst({
      type: "Word",
      parts: [{ type: "DblQuoted", parts: [{ type: "Literal", value: "v" }] }],
    });
  });
});
