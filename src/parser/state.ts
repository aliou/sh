import type { CommentNode, ParseOptions, Pos, Redirect } from "../ast";
import { isZsh } from "../dialect";
import type { OpTokenValue, SymbolTokenValue, Token } from "../tokenizer";
import { tokenPartsText } from "../tokenizer";
import { drainPendingHeredocs } from "./redirects";

/** Position used for nodes built without a known source position. */
export const ZERO_POS: Pos = { offset: 0, line: 1, col: 1 };

/**
 * Error thrown by the parser that carries the source position it should
 * be reported at, which may differ from wherever the parser happened to
 * fail — e.g. an operator continuation failure points at the operator
 * (`&&`), not at the missing statement after it.
 */
export class PositionedError extends Error {
  constructor(
    message: string,
    readonly position: Pos,
  ) {
    super(message);
    this.name = "PositionedError";
  }
}

/** Human-readable description of a token, for error messages. */
export function describeToken(token: Token | undefined): string {
  if (!token) return "";
  switch (token.type) {
    case "op":
      return token.value;
    case "newline":
      return "newline";
    case "redir":
      return token.op;
    case "symbol":
      return token.value;
    case "arith-cmd":
      return "(( ... ))";
    case "heredoc-body":
      return "<<heredoc>>";
    case "comment":
      return `#${token.text}`;
    case "word":
      return tokenPartsText(token.parts);
  }
}

/**
 * Options for the single separator-skipping helper.
 *
 * A *separator* is anything that may appear between statements: newlines,
 * comments, and literal `;` operators. Which kinds are skipped is decided
 * per call site:
 *
 * - statement lists skip newlines and comments, and handle the optional
 *   single `;` through `skipStatementSeparators` so that stray separators
 *   fail loudly instead of being silently eaten;
 * - operator continuations (`&&`, `||`, `|`) skip newlines and comments but
 *   never a literal `;`, so `cmd && ; next` stays an error;
 * - `case` item bodies skip a single `;` but stop before a `;;` terminator.
 */
export type SkipSeparatorsOptions = {
  /** Skip comment tokens. Default `true`. */
  comments?: boolean;
  /** Skip newline tokens. Default `true`. */
  newline?: boolean;
  /**
   * Skip literal `;` op tokens. Default `false`. `"single"` skips only a
   * `;` that is not immediately followed by another `;` — the `case` item
   * body case, where `;;` is the item terminator.
   */
  semicolon?: boolean | "single";
};

/**
 * The mutable state all parser modules operate on: the token cursor, the
 * collected comments, and the queue of heredoc-opening redirects whose
 * body tokens the tokenizer has not emitted yet.
 */
export class ParserState {
  index = 0;
  comments: CommentNode[] = [];
  /**
   * Redirects that opened a heredoc (`<<`/`<<-`) but whose body token the
   * tokenizer hasn't emitted yet, in opener order. The tokenizer emits one
   * body token per queued heredoc right after the newline that ends the
   * command line, so bodies can arrive after later redirects on the same
   * line or after a trailing separator (`;`, `&&`, `||`, `|`). Bodies drain
   * to their redirects in `skipSeparators`.
   */
  pendingHeredocs: Redirect[] = [];
  /**
   * When true, redirects following a compound command's closing keyword are
   * not attached to that compound node. Set while parsing a `coproc` body or
   * a function-decl block so the enclosing CoprocClause/FunctionDecl captures
   * them instead; cleared again inside nested statement lists.
   */
  suppressTrailingRedirects = false;

  constructor(
    readonly tokens: Token[],
    readonly options: ParseOptions = {},
  ) {}

  peek(): Token | undefined {
    return this.tokens[this.index];
  }

  peekToken(offset: number): Token | undefined {
    return this.tokens[this.index + offset];
  }

  consume(): Token {
    if (this.isEof()) {
      throw new Error("Unexpected end of input");
    }
    const token = this.tokens[this.index];
    if (!token) {
      throw new Error("Unexpected end of input");
    }
    this.index += 1;
    return token;
  }

  isEof(): boolean {
    return this.index >= this.tokens.length;
  }

  lastEnd(): Pos | undefined {
    const tok = this.tokens[this.index - 1];
    return tok?.end;
  }

  matchOp(value: OpTokenValue): boolean {
    const token = this.peek();
    return token?.type === "op" && token.value === value;
  }

  peekOp(value: OpTokenValue): boolean {
    const token = this.peekToken(1);
    return token?.type === "op" && token.value === value;
  }

  matchNewline(): boolean {
    return this.peek()?.type === "newline";
  }

  matchWord(): boolean {
    return this.peek()?.type === "word";
  }

  matchRedir(): boolean {
    return this.peek()?.type === "redir";
  }

  matchKeyword(value: string): boolean {
    const token = this.peek();
    if (token?.type !== "word" || token.parts.length !== 1) return false;
    const part = token.parts[0];
    return part?.type === "lit" && part.value === value;
  }

  matchKeywordIn(values: string[]): boolean {
    return values.some((value) => this.matchKeyword(value));
  }

  matchSymbol(value: SymbolTokenValue): boolean {
    const token = this.peek();
    return token?.type === "symbol" && token.value === value;
  }

  consumeSymbol(value: SymbolTokenValue): Token & { type: "symbol" } {
    const token = this.consume();
    if (token.type !== "symbol" || token.value !== value) {
      throw new Error(`Expected symbol ${value}`);
    }
    return token;
  }

  consumeKeyword(value: string): Token & { type: "word" } {
    const token = this.consume();
    if (
      token.type !== "word" ||
      token.parts.length !== 1 ||
      token.parts[0]?.type !== "lit" ||
      token.parts[0].value !== value
    ) {
      throw new Error(`Expected keyword ${value}`);
    }
    return token;
  }

  matchComment(): boolean {
    return this.peek()?.type === "comment";
  }

  consumeComment(): void {
    const token = this.consume();
    if (token.type === "comment") {
      this.comments.push({
        type: "Comment",
        text: token.text,
        pos: token.pos,
        end: token.end,
      });
    }
  }

  /**
   * The single separator-skipping helper. Drains any heredoc bodies queued
   * on the line that just ended, then skips the separator kinds selected
   * by `opts` (see `SkipSeparatorsOptions`).
   */
  skipSeparators(opts: SkipSeparatorsOptions = {}): void {
    const comments = opts.comments ?? true;
    const newline = opts.newline ?? true;
    const semicolon = opts.semicolon ?? false;
    while (true) {
      drainPendingHeredocs(this);
      const token = this.peek();
      if (!token) break;
      if (comments && token.type === "comment") {
        this.consumeComment();
        continue;
      }
      if (newline && token.type === "newline") {
        this.consume();
        continue;
      }
      if (semicolon !== false && token.type === "op" && token.value === ";") {
        if (semicolon === "single" && this.peekOp(";")) break;
        this.consume();
        continue;
      }
      break;
    }
  }
}

/**
 * Whether the current token can act as the separator between a loop head
 * and its `do` keyword: a literal `;` or a newline. Used by the `for`,
 * `select` and C-style loop productions, which accept exactly one
 * optional separator there.
 */
export function matchSeparator(s: ParserState): boolean {
  const token = s.peek();
  if (!token) return false;
  return (
    token.type === "newline" || (token.type === "op" && token.value === ";")
  );
}

/**
 * Skip the separators that may follow a statement inside a statement list.
 *
 * bash allows a single optional `;` immediately after the statement (only
 * whitespace in between), followed by any number of newlines and comments;
 * a `;` after a newline — or a second `;` — is a syntax error, so it is
 * deliberately left in place for the next `parseStatement` to fail on.
 *
 * zsh is lax here (it accepts `foo; ; bar` and `foo\n; bar`), so in zsh
 * mode any run of separators is skipped like before the newline token
 * existed.
 */
export function skipStatementSeparators(s: ParserState): void {
  if (isZsh(s.options.dialect)) {
    s.skipSeparators({ semicolon: true });
    return;
  }
  if (s.matchOp(";")) {
    s.consume();
  }
  s.skipSeparators();
}
