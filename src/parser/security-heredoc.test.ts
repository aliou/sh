import { describe, expect, it } from "vitest";
import type { Pos, Redirect, SimpleCommand, Statement } from "../ast";
import { extractCommandNames } from "../test-helpers/extract-command-names";
import { hasSubstitution } from "../test-helpers/has-substitution";
import type { Token, TokenWordPart } from "../tokenizer";
import { Parser } from "./index";

/**
 * Heredoc regression fixtures (tmp/security-audit/run-1/lib/cases-v3-heredocs.json).
 *
 * Delimiter extraction, terminator matching, folding and CR handling are the
 * tokenizer lane's job; these tests drive the parser with handwritten token
 * streams matching the frozen token-api.md contract, and assert the parser
 * half: body expansion parsing and complete `statementsSeq` yields.
 *
 * The payloads (sources) each case models:
 *   body_unquoted:      : <<EOF\n$(echo HEREDOC_MARKER >&2)\nEOF\n
 *   body_quoted_control: : <<'EOF'\n$(echo HEREDOC_QUOTED_MARKER >&2)\nEOF\n
 *   delim_expansion:    echo OUTER <<echo$x\necho$x\necho HIDDEN\necho\necho AFTER\n
 *   delim_fold:         echo OUTER <<echo\nec\\\nho\necho HIDDEN\necho\necho AFTER\n
 *   fold_ctrl_quoted:   echo OUTER <<e"c"ho\nec\\\nho\necho HIDDEN\necho\necho AFTER\n
 *   seq_first_yield:    : <<EOF\n$(echo SEQ_HEREDOC_MARKER >&2)\nEOF\n
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

function lit(value: string, escaped?: boolean): TokenWordPart {
  const span = at(value.length);
  const part: TokenWordPart = { type: "lit", value, ...span };
  if (escaped) part.escaped = true;
  return part;
}

function cmdSubst(raw: string): TokenWordPart {
  return { type: "cmd-subst", raw, innerOffset: 0, ...at(raw.length + 3) };
}

function param(name: string): TokenWordPart {
  return { type: "param", name, braced: false, ...at(name.length + 1) };
}

function redir(): Token {
  return { type: "redir", op: "<<", ...at(2) };
}

function newline(): Token {
  return { type: "op", value: ";", newline: true, ...at(1) };
}

function heredocBody(
  content: string,
  opts: { expand: boolean; delimiter: string; quoted: boolean },
): Token {
  return { type: "heredoc-body", content, ...opts, ...at(content.length) };
}

function parseTokens(tokens: Token[]) {
  cursor = 0;
  const parser = new Parser(tokens);
  const ast = parser.parseProgram();
  parser.assertEof();
  return ast;
}

function firstRedirect(ast: { body: Statement[] }): Redirect {
  const cmd = ast.body[0]?.command as SimpleCommand;
  const redirect = cmd.redirects?.[0];
  if (!redirect) throw new Error("expected a redirect");
  return redirect;
}

describe("security: heredoc bodies (token-api contract streams)", () => {
  it("body_unquoted: unquoted body parses expansions structurally", () => {
    const ast = parseTokens([
      word(lit(":")),
      redir(),
      word(lit("EOF")),
      newline(),
      heredocBody("$(echo HEREDOC_MARKER >&2)\n", {
        expand: true,
        delimiter: "EOF",
        quoted: false,
      }),
    ]);
    const body = firstRedirect(ast).heredoc;
    expect(hasSubstitution(body)).toBe(true);
    expect(extractCommandNames(body)).toContain("echo");
    // Trailing body newline stays literal.
    expect(body?.parts[body.parts.length - 1]).toMatchAst({
      type: "Literal",
      value: "\n",
    });
  });

  it("body_quoted_control: quoted body stays one literal", () => {
    const ast = parseTokens([
      word(lit(":")),
      redir(),
      word(lit("EOF")),
      newline(),
      heredocBody("$(echo HEREDOC_QUOTED_MARKER >&2)\n", {
        expand: false,
        delimiter: "EOF",
        quoted: true,
      }),
    ]);
    const body = firstRedirect(ast).heredoc;
    expect(hasSubstitution(body)).toBe(false);
    expect(body).toMatchAst({
      type: "Word",
      parts: [
        { type: "Literal", value: "$(echo HEREDOC_QUOTED_MARKER >&2)\n" },
      ],
    });
  });

  it("delim_expansion: $ in the delimiter keeps the body plain and bounded", () => {
    // `<<echo$x`: bash treats the delimiter as quoted (contains `$`), so
    // the first `echo$x` line terminates; HIDDEN/AFTER run as commands.
    const ast = parseTokens([
      word(lit("echo")),
      word(lit("OUTER")),
      redir(),
      word(lit("echo"), param("x")),
      newline(),
      heredocBody("", { expand: false, delimiter: "echo$x", quoted: true }),
      word(lit("echo")),
      word(lit("HIDDEN")),
      newline(),
      word(lit("echo")),
      newline(),
      word(lit("echo")),
      word(lit("AFTER")),
    ]);
    expect(ast.body.length).toBe(4);
    expect(extractCommandNames(ast)).toEqual(["echo", "echo", "echo", "echo"]);
    const body = firstRedirect(ast).heredoc;
    expect(hasSubstitution(body)).toBe(false);
  });

  it("delim_fold: folded unquoted terminator yields an empty body", () => {
    // Unquoted delimiter, so the `ec\` + `ho` lines fold into the
    // terminator; anything after runs as commands.
    const ast = parseTokens([
      word(lit("echo")),
      word(lit("OUTER")),
      redir(),
      word(lit("echo")),
      newline(),
      heredocBody("", { expand: true, delimiter: "echo", quoted: false }),
      word(lit("echo")),
      word(lit("HIDDEN")),
      newline(),
      word(lit("echo")),
      newline(),
      word(lit("echo")),
      word(lit("AFTER")),
    ]);
    // OUTER + HIDDEN + bare echo + AFTER = 4 statements.
    expect(ast.body.length).toBe(4);
  });

  it("fold_ctrl_quoted: quoted delimiter does not fold; physical echo line terminates", () => {
    // `<<e"c"ho` is quoted: no backslash-newline folding for the terminator,
    // so the body runs to the physical `echo` line and is NOT expanded.
    const bodyText = "ec\\\nho\necho HIDDEN\n";
    const ast = parseTokens([
      word(lit("echo")),
      word(lit("OUTER")),
      redir(),
      word(
        lit("e"),
        {
          type: "dbl",
          parts: [{ type: "lit", value: "c", ...at(1) }],
          ...at(3),
        } as TokenWordPart & { type: "dbl" },
        lit("ho"),
      ),
      newline(),
      heredocBody(bodyText, {
        expand: false,
        delimiter: "echo",
        quoted: true,
      }),
      word(lit("echo")),
      word(lit("AFTER")),
    ]);
    expect(ast.body.length).toBe(2);
    const body = firstRedirect(ast).heredoc;
    expect(hasSubstitution(body)).toBe(false);
    expect(body).toMatchAst({
      type: "Word",
      parts: [{ type: "Literal", value: bodyText }],
    });
  });

  it("seq_first_yield: statementsSeq yields a heredoc statement complete", () => {
    cursor = 0;
    const tokens: Token[] = [
      word(lit(":")),
      redir(),
      word(lit("EOF")),
      newline(),
      heredocBody("$(echo SEQ_HEREDOC_MARKER >&2)\n", {
        expand: true,
        delimiter: "EOF",
        quoted: false,
      }),
    ];
    const parser = new Parser(tokens);
    const first = parser.statementsSeq().next().value as Statement;
    const redirect = (first.command as SimpleCommand).redirects?.[0];
    expect(redirect?.heredoc).toBeDefined();
    expect(hasSubstitution(redirect?.heredoc)).toBe(true);
  });

  it("a legacy heredoc-body token (no expand field) stays one literal", () => {
    cursor = 0;
    // Pre-contract shape kept as a defensive fallback; the real tokenizer
    // always emits the full contract fields now.
    const body = {
      type: "heredoc-body",
      content: "hello $world\n",
      ...at(4),
    } as Token;
    const ast = parseTokens([
      word(lit("cat")),
      redir(),
      word(lit("EOF")),
      newline(),
      body,
    ]);
    expect(firstRedirect(ast).heredoc).toMatchAst({
      type: "Word",
      parts: [{ type: "Literal", value: "hello $world\n" }],
    });
  });

  it("CR bytes in a quoted body are preserved as data", () => {
    const ast = parseTokens([
      word(lit("echo")),
      redir(),
      word(lit("EOF")),
      newline(),
      heredocBody("a\r\nb\r\n", {
        expand: false,
        delimiter: "EOF\r",
        quoted: true,
      }),
    ]);
    expect(firstRedirect(ast).heredoc).toMatchAst({
      type: "Word",
      parts: [{ type: "Literal", value: "a\r\nb\r\n" }],
    });
  });

  it("unquoted body keeps \\$ as literal text", () => {
    const ast = parseTokens([
      word(lit(":")),
      redir(),
      word(lit("EOF")),
      newline(),
      heredocBody("\\$(echo x) $(echo y)\n", {
        expand: true,
        delimiter: "EOF",
        quoted: false,
      }),
    ]);
    const body = firstRedirect(ast).heredoc;
    // The escaped $( stays literal; the unescaped one is a CmdSubst.
    expect(body?.parts[0]).toMatchAst({
      type: "Literal",
      value: "$(echo x) ",
    });
    expect(hasSubstitution(body)).toBe(true);
  });

  it("cmd-subst raw re-tokenization carries contract heredoc streams", () => {
    // fold_in_cmdsubst: expansions nested in cmd-subst go through
    // convertWordPart's inner tokenize; once the tokenizer lane emits
    // contract tokens, the inner drain runs through the same code path as
    // the top-level cases above. Simulate the inner stream directly.
    const ast = parseTokens([
      word(lit("echo")),
      word(lit("INNER")),
      redir(),
      word(lit("echo")),
      newline(),
      heredocBody("", { expand: true, delimiter: "echo", quoted: false }),
      word(lit("echo")),
      word(lit("HIDDEN")),
    ]);
    expect(ast.body.length).toBe(2);
    const redirect = firstRedirect(ast);
    expect(redirect.heredoc).toBeDefined();
    expect(hasSubstitution(redirect.heredoc)).toBe(false);
  });

  it("nested cmd-subst adjacent to heredoc opener keeps both commands", () => {
    const ast = parseTokens([
      word(lit(":"), cmdSubst("true")),
      redir(),
      word(lit("EOF")),
      newline(),
      heredocBody("body\n", { expand: true, delimiter: "EOF", quoted: false }),
    ]);
    const cmd = ast.body[0]?.command as SimpleCommand;
    expect(cmd.words?.[0]?.parts[1]?.type).toBe("CmdSubst");
    expect(firstRedirect(ast).heredoc).toBeDefined();
  });
});
