import type { CStyleLoop, ForClause, Pos, SelectClause, Word } from "../ast";
import { checkLang, isZsh } from "../dialect";
import { tokenPartsText } from "../tokenizer";
import { SourceMap } from "../tokenizer/cursor";
import { parseArithmetic } from "./arith-parser";
import { parseStatementsUntilKeyword } from "./clauses";
import { parseTrailingRedirects } from "./redirects";
import { matchSeparator, type ParserState } from "./state";
import { wordFromToken } from "./words";

type TopLevelPart = { raw: string; offset: number };

/** Split `s` on a single-char delimiter, ignoring delimiters in parentheses. */
function splitAtTopLevel(s: string, delim: string): TopLevelPart[] {
  const parts: TopLevelPart[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === delim && depth === 0) {
      parts.push(trimmedTopLevelPart(s, start, i));
      start = i + 1;
    }
  }
  parts.push(trimmedTopLevelPart(s, start, s.length));
  return parts;
}

function trimmedTopLevelPart(
  source: string,
  start: number,
  end: number,
): TopLevelPart {
  while (start < end && /\s/.test(source[start] as string)) start++;
  while (end > start && /\s/.test(source[end - 1] as string)) end--;
  return { raw: source.slice(start, end), offset: start };
}

/**
 * Read an optional `in word1 word2 ...` clause used by `for` and `select`,
 * up to `do`. Returns `undefined` if there's no `in` keyword.
 */
function collectLoopItems(s: ParserState): Word[] | undefined {
  if (!s.matchKeyword("in")) return undefined;
  s.consumeKeyword("in");
  const items: Word[] = [];
  while (s.matchWord() && !s.matchKeyword("do")) {
    const tok = s.consume();
    if (tok.type !== "word") throw new Error("Expected loop item word");
    items.push(wordFromToken(tok, s.options));
  }
  return items.length > 0 ? items : undefined;
}

export function parseForOrCStyleLoop(s: ParserState): ForClause | CStyleLoop {
  const forTok = s.consumeKeyword("for");

  // C-style: for (( init; cond; post ))
  if (s.peek()?.type === "arith-cmd") {
    return parseCStyleLoop(s, forTok.pos);
  }

  const nameToken = s.consume();
  if (nameToken.type !== "word") {
    throw new Error("Expected loop variable name");
  }
  const name = tokenPartsText(nameToken.parts);
  const items = collectLoopItems(s);
  if (matchSeparator(s)) {
    s.consume();
  }
  s.skipSeparators({ semicolon: isZsh(s.options.dialect) });
  s.consumeKeyword("do");
  const body = parseStatementsUntilKeyword(s, "do", ["done"]);
  const done = s.consumeKeyword("done");
  const node: ForClause = {
    type: "ForClause",
    name,
    body,
    pos: forTok.pos,
    end: done.end,
  };
  if (items) node.items = items;
  parseTrailingRedirects(s, node);
  return node;
}

export function parseCStyleLoop(s: ParserState, startPos: Pos): CStyleLoop {
  const token = s.consume();
  if (token.type !== "arith-cmd") {
    throw new Error("Expected (( )) in c-style for");
  }
  checkLang(s.options.dialect, startPos, "for ((", ["bash", "mksh", "zsh"]);

  // Split inner on `;` boundaries (top-level only) and parse each piece
  // as its own arithmetic expression. Empty clauses are allowed.
  const base = {
    offset: token.innerOffset,
    line: token.pos.line,
    col: token.pos.col + 2,
  };
  const partMap = new SourceMap(token.expr);
  const [initPart, condPart, postPart] = splitAtTopLevel(token.expr, ";");
  const baseFor = (part: TopLevelPart) => {
    const inner = partMap.posAt(part.offset);
    return {
      offset: base.offset + part.offset,
      line: base.line + inner.line - 1,
      col: inner.line === 1 ? base.col + inner.col - 1 : inner.col,
    };
  };
  const init = initPart?.raw
    ? parseArithmetic(initPart.raw, baseFor(initPart))
    : undefined;
  const cond = condPart?.raw
    ? parseArithmetic(condPart.raw, baseFor(condPart))
    : undefined;
  const post = postPart?.raw
    ? parseArithmetic(postPart.raw, baseFor(postPart))
    : undefined;

  if (matchSeparator(s)) {
    s.consume();
  }
  s.skipSeparators({ semicolon: isZsh(s.options.dialect) });
  s.consumeKeyword("do");
  const body = parseStatementsUntilKeyword(s, "do", ["done"]);
  const done = s.consumeKeyword("done");
  const loop: CStyleLoop = {
    type: "CStyleLoop",
    body,
    pos: startPos,
    end: done.end,
  };
  if (init !== undefined) loop.init = init;
  if (cond !== undefined) loop.cond = cond;
  if (post !== undefined) loop.post = post;
  parseTrailingRedirects(s, loop);
  return loop;
}

export function parseSelectClause(s: ParserState): SelectClause {
  const head = s.consumeKeyword("select");
  checkLang(s.options.dialect, head.pos, "select", ["bash", "mksh", "zsh"]);
  const nameToken = s.consume();
  if (nameToken.type !== "word") {
    throw new Error("Expected select variable name");
  }
  const name = tokenPartsText(nameToken.parts);
  let items: Word[] | undefined;
  if (s.matchKeyword("in")) {
    s.consumeKeyword("in");
    const collected: Word[] = [];
    while (s.matchWord() && !s.matchKeyword("do")) {
      const itemToken = s.consume();
      if (itemToken.type !== "word") {
        throw new Error("Expected select item word");
      }
      collected.push(wordFromToken(itemToken, s.options));
    }
    if (collected.length > 0) {
      items = collected;
    }
  }
  if (matchSeparator(s)) {
    s.consume();
  }
  s.skipSeparators({ semicolon: isZsh(s.options.dialect) });
  s.consumeKeyword("do");
  const body = parseStatementsUntilKeyword(s, "do", ["done"]);
  const done = s.consumeKeyword("done");
  const node: SelectClause = {
    type: "SelectClause",
    name,
    body,
    pos: head.pos,
    end: done.end,
  };
  if (items) node.items = items;
  parseTrailingRedirects(s, node);
  return node;
}
