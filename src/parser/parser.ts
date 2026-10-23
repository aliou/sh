import type {
  ParseError,
  ParseOptions,
  Pos,
  Program,
  Statement,
  Word,
} from "../ast";
import { isZsh } from "../dialect";
import type { Token } from "../tokenizer";
import { tokenize } from "../tokenizer";
import { parseStatement } from "./commands";
import {
  describeToken,
  ParserState,
  PositionedError,
  skipStatementSeparators,
  ZERO_POS,
} from "./state";
import { wordFromToken } from "./words";

/**
 * Parse a standalone inner program — the body of a command or process
 * substitution found inside a word. Used by the word-conversion module.
 */
export function parseInnerProgram(source: string): Program {
  const innerParser = new Parser(tokenize(source));
  return innerParser.parseProgram();
}

export class Parser {
  private readonly state: ParserState;

  constructor(tokens: Token[], options: ParseOptions = {}) {
    this.state = new ParserState(tokens, options);
  }

  /** Yield each top-level statement as it's parsed. */
  *statementsSeq(): Generator<Statement> {
    this.skipLeadingSeparators();
    while (!this.state.isEof()) {
      yield parseStatement(this.state);
      skipStatementSeparators(this.state);
    }
  }

  /** Yield each word token as a Word, ignoring statement structure. */
  *wordsSeq(): Generator<Word> {
    while (!this.state.isEof()) {
      const tok = this.state.peek();
      if (!tok) break;
      if (
        tok.type === "op" ||
        tok.type === "newline" ||
        tok.type === "redir" ||
        tok.type === "symbol" ||
        tok.type === "heredoc-body" ||
        tok.type === "comment" ||
        tok.type === "arith-cmd"
      ) {
        // Skip non-word tokens; useful for argv-style sources where we
        // only care about the word stream.
        this.state.consume();
        continue;
      }
      this.state.consume();
      yield wordFromToken(tok);
    }
  }

  /**
   * Like `parseProgram` but never throws: parse errors are collected into
   * the provided array, and the parser advances past the offending token
   * to keep going. Used by the public `recoverErrors` mode.
   */
  parseProgramRecovering(errors: ParseError[]): Program {
    const body: Statement[] = [];
    this.skipLeadingSeparators();
    const startPos = this.state.peek()?.pos ?? ZERO_POS;
    while (!this.state.isEof()) {
      const before = this.state.index;
      try {
        body.push(parseStatement(this.state));
        skipStatementSeparators(this.state);
      } catch (e) {
        // Operator-continuation failures carry their own position (the
        // operator's); other failures point at the token the statement
        // started at.
        const tok = this.state.tokens[before];
        const pos =
          e instanceof PositionedError
            ? e.position
            : (tok?.pos ?? this.state.lastEnd() ?? startPos);
        errors.push({
          message: e instanceof Error ? e.message : String(e),
          pos,
        });
        // Advance past the offending token to avoid infinite looping.
        if (this.state.index === before) this.state.index += 1;
        skipStatementSeparators(this.state);
      }
    }
    return this.buildProgram(body, startPos);
  }

  parseProgram(): Program {
    const body: Statement[] = [];
    this.skipLeadingSeparators();
    const startPos = this.state.peek()?.pos ?? ZERO_POS;
    while (!this.state.isEof()) {
      body.push(parseStatement(this.state));
      skipStatementSeparators(this.state);
    }
    return this.buildProgram(body, startPos);
  }

  assertEof() {
    if (this.state.isEof()) return;
    throw new Error(`Unexpected token: ${describeToken(this.state.peek())}`);
  }

  private buildProgram(body: Statement[], startPos: Pos): Program {
    const endPos = this.state.lastEnd() ?? startPos;
    const program: Program = {
      type: "Program",
      body,
      pos: startPos,
      end: endPos,
    };
    if (this.state.options.keepComments && this.state.comments.length > 0) {
      program.comments = this.state.comments;
    }
    return program;
  }

  /**
   * Skip the separators that may lead a program: newlines and comments.
   * zsh also tolerates leading `;` separators, so those are skipped in
   * zsh mode.
   */
  private skipLeadingSeparators(): void {
    this.state.skipSeparators({
      semicolon: isZsh(this.state.options.dialect),
    });
  }
}
