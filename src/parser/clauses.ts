import type { Block, IfClause, Statement, Subshell, WhileClause } from "../ast";
import { isZsh } from "../dialect";
import type { SymbolTokenValue } from "../tokenizer";
import { parseStatement, wrapStatement } from "./commands";
import {
  allowNestedTrailingRedirects,
  parseTrailingRedirects,
} from "./redirects";
import { type ParserState, skipStatementSeparators } from "./state";

/** Parse a `(...)` subshell. */
export function parseSubshell(s: ParserState): Subshell {
  const open = s.consumeSymbol("(");
  const body = parseStatementList(s, "(", ")");
  const close = s.consumeSymbol(")");
  const node: Subshell = {
    type: "Subshell",
    body,
    pos: open.pos,
    end: close.end,
  };
  parseTrailingRedirects(s, node);
  return node;
}

/** Parse a `{ ... }` block. */
export function parseBlock(s: ParserState): Block {
  const open = s.consumeSymbol("{");
  const body = parseStatementList(s, "{", "}");
  const close = s.consumeSymbol("}");
  const node: Block = { type: "Block", body, pos: open.pos, end: close.end };
  parseTrailingRedirects(s, node);
  return node;
}

/**
 * Parse a `{ ... }`-style statement list delimited by `endSymbol`, with
 * trailing-redirect capture re-enabled inside (see
 * `allowNestedTrailingRedirects`).
 */
export function parseStatementList(
  s: ParserState,
  left: string,
  endSymbol: SymbolTokenValue,
): Statement[] {
  return allowNestedTrailingRedirects(s, () =>
    parseStatementListInner(s, left, endSymbol),
  );
}

function parseStatementListInner(
  s: ParserState,
  left: string,
  endSymbol: SymbolTokenValue,
): Statement[] {
  const body: Statement[] = [];
  s.skipSeparators();
  while (!s.matchSymbol(endSymbol)) {
    if (s.isEof()) {
      throw new Error(`Unexpected end of input while looking for ${endSymbol}`);
    }
    if (s.matchOp(";")) {
      // A literal `;` where a statement was expected: bash rejects
      // `{ ; }` and `{ foo; ; }`, so surface the same empty/short list
      // failure instead of a deep "Expected a command word".
      if (!isZsh(s.options.dialect)) {
        throw new Error(`"${left}" must be followed by a statement list`);
      }
      s.consume();
      s.skipSeparators();
      continue;
    }
    body.push(parseStatement(s));
    skipStatementSeparators(s);
  }
  if (body.length === 0 && !isZsh(s.options.dialect)) {
    throw new Error(`"${left}" must be followed by a statement list`);
  }
  return body;
}

/**
 * Parse statements until one of `endKeywords` is peeked (not consumed).
 * Used for clause bodies (`then`/`else`/`fi`, `do`/`done`, ...).
 */
export function parseStatementsUntilKeyword(
  s: ParserState,
  left: string,
  endKeywords: string[],
): Statement[] {
  return allowNestedTrailingRedirects(s, () =>
    parseStatementsUntilKeywordInner(s, left, endKeywords),
  );
}

function parseStatementsUntilKeywordInner(
  s: ParserState,
  left: string,
  endKeywords: string[],
): Statement[] {
  const body: Statement[] = [];
  s.skipSeparators();
  while (!s.matchKeywordIn(endKeywords)) {
    if (s.isEof()) {
      throw new Error(
        `Unexpected end of input while looking for ${endKeywords.join(", ")}`,
      );
    }
    if (s.matchOp(";")) {
      if (!isZsh(s.options.dialect)) {
        throw new Error(`"${left}" must be followed by a statement list`);
      }
      s.consume();
      s.skipSeparators();
      continue;
    }
    body.push(parseStatement(s));
    skipStatementSeparators(s);
  }
  if (body.length === 0 && !isZsh(s.options.dialect)) {
    throw new Error(`"${left}" must be followed by a statement list`);
  }
  return body;
}

/** Parse an `if` clause (delegates to the `if`/`elif` chain parser). */
export function parseIfClause(s: ParserState): IfClause {
  return parseIfChain(s, "if");
}

/**
 * Parse an `if`/`elif` chain starting at the head keyword. The caller has
 * already verified the head is `head` (either `"if"` or `"elif"`). The
 * outermost call consumes the trailing `fi`; recursive elif calls don't.
 */
function parseIfChain(s: ParserState, head: "if" | "elif"): IfClause {
  const headTok = s.consumeKeyword(head);
  const cond = parseStatementsUntilKeyword(s, head, ["then"]);
  s.consumeKeyword("then");
  const thenBranch = parseStatementsUntilKeyword(s, "then", [
    "else",
    "elif",
    "fi",
  ]);
  let elseBranch: Statement[] | undefined;
  if (s.matchKeyword("elif")) {
    const inner = parseIfChain(s, "elif");
    elseBranch = [wrapStatement(inner)];
  } else if (s.matchKeyword("else")) {
    s.consumeKeyword("else");
    elseBranch = parseStatementsUntilKeyword(s, "else", ["fi"]);
  }
  // Only the outermost `if` consumes `fi`; recursive `elif` rides on the
  // outer call's eventual consumption.
  const endPos =
    head === "if" ? s.consumeKeyword("fi").end : (s.lastEnd() ?? headTok.end);
  const node: IfClause = {
    type: "IfClause",
    cond,
    // biome-ignore lint/suspicious/noThenProperty: shell AST field
    then: thenBranch,
    pos: headTok.pos,
    end: endPos,
  };
  if (elseBranch) node.else = elseBranch;
  if (head === "if") parseTrailingRedirects(s, node);
  return node;
}

/** Parse a `while` or `until` clause. */
export function parseWhileClause(s: ParserState, until: boolean): WhileClause {
  const head = s.consumeKeyword(until ? "until" : "while");
  const keyword = until ? "until" : "while";
  const cond = parseStatementsUntilKeyword(s, keyword, ["do"]);
  s.consumeKeyword("do");
  const body = parseStatementsUntilKeyword(s, "do", ["done"]);
  const done = s.consumeKeyword("done");
  const node: WhileClause = {
    type: "WhileClause",
    cond,
    body,
    pos: head.pos,
    end: done.end,
  };
  if (until) node.until = true;
  parseTrailingRedirects(s, node);
  return node;
}
