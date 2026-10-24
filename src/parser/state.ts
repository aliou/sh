import type { CommentNode, ParseOptions, Pos, Redirect } from "../ast";
import { isZsh } from "../dialect";
import type { OpTokenValue, SymbolTokenValue, Token } from "../tokenizer";
import { tokenPartsText } from "../tokenizer";
import { drainPendingHeredocs } from "./redirects";

export const ZERO_POS: Pos = { offset: 0, line: 1, col: 1 };

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

export type SkipSeparatorsOptions = {
  comments?: boolean;
  newline?: boolean;
  semicolon?: boolean | "single";
};

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

export function matchSeparator(s: ParserState): boolean {
  const token = s.peek();
  if (!token) return false;
  return (
    token.type === "newline" || (token.type === "op" && token.value === ";")
  );
}

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
