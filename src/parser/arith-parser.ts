import type {
  ArithExpr,
  BinaryArithm,
  BinaryArithmOp,
  ParamExp,
  Pos,
  UnaryArithm,
  UnaryArithmOp,
} from "../ast";
import {
  isDigit,
  isHexDigit,
  isNameChar,
  isNameStart,
  specialParams,
} from "../tokenizer/charsets";
import { SourceMap } from "../tokenizer/cursor";

/**
 * Anchor describing where `source` lives in the original input, so the
 * positions we attach to nodes are absolute.
 */
export type ArithBase = {
  /** Absolute offset of `source[0]` in the original input. */
  offset: number;
  /** 1-indexed line of `source[0]` in the original input. */
  line: number;
  /** 1-indexed column of `source[0]` in the original input. */
  col: number;
};

/**
 * Parse a Bash arithmetic expression (the inside of `(( ... ))`,
 * `$(( ... ))`, or one clause of a C-style for loop) into an `ArithExpr`
 * tree. Returns `undefined` for empty/whitespace-only input.
 */
export function parseArithmetic(
  source: string,
  base: ArithBase,
): ArithExpr | undefined {
  const tokens = tokenizeArith(source);
  if (tokens.length === 0) return undefined;
  const ctx: Ctx = {
    tokens,
    index: 0,
    base,
    map: new SourceMap(source),
  };
  const expr = parseExpr(ctx, 0);
  if (ctx.index < ctx.tokens.length) {
    const tok = ctx.tokens[ctx.index];
    throw new Error(`Unexpected token in arithmetic: ${tokDisplay(tok)}`);
  }
  return expr;
}

function tokDisplay(t: ArithTok | undefined): string {
  if (!t) return "?";
  if (t.type === "lparen") return "(";
  if (t.type === "rparen") return ")";
  return t.value;
}

/** ===== arithmetic mini-tokenizer ===== */

type ArithTok =
  | { type: "num"; value: string; offset: number }
  | { type: "name"; value: string; offset: number }
  | { type: "op"; value: string; offset: number }
  | { type: "lparen"; offset: number }
  | { type: "rparen"; offset: number };

/** Operators tried longest-first. */
const OPS = [
  "<<=",
  ">>=",
  "**=",
  "&&",
  "||",
  "==",
  "!=",
  "<=",
  ">=",
  "<<",
  ">>",
  "**",
  "++",
  "--",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "+",
  "-",
  "*",
  "/",
  "%",
  "<",
  ">",
  "&",
  "|",
  "^",
  "~",
  "!",
  "=",
  ",",
  "?",
  ":",
];

function tokenizeArith(s: string): ArithTok[] {
  const toks: ArithTok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s.charAt(i);
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === "(") {
      toks.push({ type: "lparen", offset: i });
      i++;
      continue;
    }
    if (c === ")") {
      toks.push({ type: "rparen", offset: i });
      i++;
      continue;
    }
    if (c === "$") {
      // `$name` in arithmetic context is folded into a ParamExp later; the
      // leading `$` is dropped here since the name token suffices.
      let j = i + 1;
      const next = s.charAt(j);
      if (j < s.length && isNameStart(next)) {
        while (j < s.length && isNameChar(s.charAt(j))) j++;
        toks.push({ type: "name", value: s.slice(i + 1, j), offset: i });
        i = j;
        continue;
      }
      if (j < s.length && (isDigit(next) || specialParams.has(next))) {
        toks.push({ type: "name", value: next, offset: i });
        i += 2;
        continue;
      }
    }
    if (isDigit(c)) {
      let j = i + 1;
      if (c === "0" && (s.charAt(j) === "x" || s.charAt(j) === "X")) {
        j++;
        while (j < s.length && isHexDigit(s.charAt(j))) j++;
      } else {
        while (j < s.length && isDigit(s.charAt(j))) j++;
      }
      toks.push({ type: "num", value: s.slice(i, j), offset: i });
      i = j;
      continue;
    }
    if (isNameStart(c)) {
      let j = i + 1;
      while (j < s.length && isNameChar(s.charAt(j))) j++;
      toks.push({ type: "name", value: s.slice(i, j), offset: i });
      i = j;
      continue;
    }
    let matched = false;
    for (const op of OPS) {
      if (s.startsWith(op, i)) {
        toks.push({ type: "op", value: op, offset: i });
        i += op.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      throw new Error(
        `Unexpected character ${JSON.stringify(c)} in arithmetic at offset ${i}`,
      );
    }
  }
  return toks;
}

/** ===== precedence table (Bash, low number = lower precedence) ===== */

interface BinInfo {
  prec: number;
  rightAssoc?: boolean;
}

const BIN_INFO: Record<string, BinInfo> = {
  ",": { prec: 1 },
  "=": { prec: 2, rightAssoc: true },
  "+=": { prec: 2, rightAssoc: true },
  "-=": { prec: 2, rightAssoc: true },
  "*=": { prec: 2, rightAssoc: true },
  "/=": { prec: 2, rightAssoc: true },
  "%=": { prec: 2, rightAssoc: true },
  "**=": { prec: 2, rightAssoc: true },
  "&=": { prec: 2, rightAssoc: true },
  "|=": { prec: 2, rightAssoc: true },
  "^=": { prec: 2, rightAssoc: true },
  "<<=": { prec: 2, rightAssoc: true },
  ">>=": { prec: 2, rightAssoc: true },
  "?": { prec: 3, rightAssoc: true },
  ":": { prec: 3, rightAssoc: true },
  "||": { prec: 4 },
  "&&": { prec: 5 },
  "|": { prec: 6 },
  "^": { prec: 7 },
  "&": { prec: 8 },
  "==": { prec: 9 },
  "!=": { prec: 9 },
  "<": { prec: 10 },
  "<=": { prec: 10 },
  ">": { prec: 10 },
  ">=": { prec: 10 },
  "<<": { prec: 11 },
  ">>": { prec: 11 },
  "+": { prec: 12 },
  "-": { prec: 12 },
  "*": { prec: 13 },
  "/": { prec: 13 },
  "%": { prec: 13 },
  "**": { prec: 14, rightAssoc: true },
};

const UNARY_PREFIX = new Set(["+", "-", "!", "~", "++", "--"]);

/** ===== parser ===== */

interface Ctx {
  tokens: ArithTok[];
  index: number;
  base: ArithBase;
  map: SourceMap;
}

const peek = (ctx: Ctx) => ctx.tokens[ctx.index];
const advance = (ctx: Ctx) => ctx.tokens[ctx.index++];

/**
 * Compute the absolute (pos, end) for a span of arithmetic source.
 * Uses the SourceMap's binary-search `posAt` and translates by the base
 * anchor. The first line of the inner source is on the same line as the
 * containing `(( `, so its column needs the base offset added.
 */
function posOf(ctx: Ctx, offset: number, length = 1): { pos: Pos; end: Pos } {
  return {
    pos: translate(ctx, offset),
    end: translate(ctx, offset + length),
  };
}

function translate(ctx: Ctx, offset: number): Pos {
  const inner = ctx.map.posAt(offset);
  const onFirstLine = inner.line === 1;
  return {
    offset: ctx.base.offset + offset,
    line: ctx.base.line + (inner.line - 1),
    col: onFirstLine ? ctx.base.col + (inner.col - 1) : inner.col,
  };
}

function parseExpr(ctx: Ctx, minPrec: number): ArithExpr {
  let left = parseUnary(ctx);
  while (true) {
    const tok = peek(ctx);
    if (tok?.type !== "op") break;
    const info = BIN_INFO[tok.value];
    if (!info || info.prec < minPrec) break;

    advance(ctx);
    const nextMin = info.rightAssoc ? info.prec : info.prec + 1;
    // Special handling for postfix `++`/`--` is done at primary level.
    const right = parseExpr(ctx, nextMin);
    const node: BinaryArithm = {
      type: "BinaryArithm",
      op: tok.value as BinaryArithmOp,
      x: left,
      y: right,
      pos: left.pos ?? posOf(ctx, tok.offset, tok.value.length).pos,
      end: right.end ?? posOf(ctx, tok.offset, tok.value.length).end,
    };
    left = node;
  }
  return left;
}

function parseUnary(ctx: Ctx): ArithExpr {
  const tok = peek(ctx);
  if (tok && tok.type === "op" && UNARY_PREFIX.has(tok.value)) {
    advance(ctx);
    const operand = parseUnary(ctx);
    const node: UnaryArithm = {
      type: "UnaryArithm",
      op: tok.value as UnaryArithmOp,
      x: operand,
      ...posOf(ctx, tok.offset, tok.value.length),
    };
    return node;
  }
  return parsePostfix(ctx);
}

function parsePostfix(ctx: Ctx): ArithExpr {
  const expr = parsePrimary(ctx);
  const tok = peek(ctx);
  if (tok && tok.type === "op" && (tok.value === "++" || tok.value === "--")) {
    advance(ctx);
    const node: UnaryArithm = {
      type: "UnaryArithm",
      op: tok.value as UnaryArithmOp,
      post: true,
      x: expr,
      pos: expr.pos ?? posOf(ctx, tok.offset, tok.value.length).pos,
      end: posOf(ctx, tok.offset, tok.value.length).end,
    };
    return node;
  }
  return expr;
}

function parsePrimary(ctx: Ctx): ArithExpr {
  const tok = advance(ctx);
  if (!tok) throw new Error("Unexpected end of arithmetic expression");
  if (tok.type === "num") {
    return {
      type: "ArithLit",
      value: tok.value,
      ...posOf(ctx, tok.offset, tok.value.length),
    };
  }
  if (tok.type === "name") {
    const param: ParamExp = {
      type: "ParamExp",
      short: true,
      param: { type: "Literal", value: tok.value },
      ...posOf(ctx, tok.offset, tok.value.length),
    };
    return param;
  }
  if (tok.type === "lparen") {
    const inner = parseExpr(ctx, 0);
    const next = advance(ctx);
    if (next?.type !== "rparen") {
      throw new Error("Expected closing paren in arithmetic");
    }
    return {
      type: "ParenArithm",
      x: inner,
      ...posOf(ctx, tok.offset, next.offset - tok.offset + 1),
    };
  }
  throw new Error(`Unexpected token in arithmetic: ${JSON.stringify(tok)}`);
}
