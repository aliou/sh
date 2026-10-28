import type {
  CmdSubst,
  ExtGlob,
  ParamExp,
  ParamExpOp,
  ParseOptions,
  Pos,
  ProcSubst,
  Statement,
  Word,
  WordPart,
} from "../ast";
import type { Token, TokenWordPart } from "../tokenizer";
import { tokenize } from "../tokenizer";
import { SourceMap } from "../tokenizer/cursor";
import { scanBacktick } from "../tokenizer/scan-backtick";
import { scanExpansion } from "../tokenizer/scan-expansion";
import { parseArithmetic } from "./arith-parser";
import { parseInnerProgram } from "./parser";

function innerBase(part: { pos: Pos; innerOffset: number }): Pos {
  return {
    offset: part.innerOffset,
    line: part.pos.line,
    col: part.pos.col + (part.innerOffset - part.pos.offset),
  };
}

/** Anchor a relative position (from a re-scanned fragment) to the source. */
export function rebasePos(pos: Pos, base: Pos): Pos {
  return {
    offset: pos.offset + base.offset,
    line: pos.line + base.line - 1,
    col: pos.line === 1 ? pos.col + base.col - 1 : pos.col,
  };
}

/**
 * Absolute position of `relOffset` inside `text`, where the text starts at
 * `base`. Walks the text so newlines advance the line and reset the col.
 */
function absPos(base: Pos, text: string, relOffset: number): Pos {
  let line = base.line;
  let lastNewline = -1;
  const end = Math.min(relOffset, text.length);
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      lastNewline = i;
    }
  }
  return {
    offset: base.offset + relOffset,
    line,
    col: lastNewline === -1 ? base.col + relOffset : relOffset - lastNewline,
  };
}

function isPos(value: unknown): value is Pos {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Pos).offset === "number" &&
    typeof (value as Pos).line === "number" &&
    typeof (value as Pos).col === "number"
  );
}

/**
 * Opening-delimiter length (`$(`, `<(`, `>(`, backtick) per substitution
 * node, so rebaseTree can locate the body origin of nested substitutions
 * when anchoring a reparsed fragment to the source.
 */
const substOpenLen = new WeakMap<object, number>();

/**
 * Rebase every position in a converted subtree by `base`, exactly once per
 * level. Substitution bodies are parsed from their inner text, so their
 * descendants rebase against the body origin instead of the node origin.
 */
function rebaseTree(node: unknown, base: Pos): void {
  if (Array.isArray(node)) {
    for (const item of node) rebaseTree(item, base);
    return;
  }
  if (!node || typeof node !== "object") return;
  const n = node as Record<string, unknown> & { pos?: Pos; end?: Pos };
  let bodyBase: Pos | undefined;
  if ((n.type === "CmdSubst" || n.type === "ProcSubst") && isPos(n.pos)) {
    const openLen = substOpenLen.get(n) ?? 2;
    bodyBase = rebasePos(
      {
        offset: n.pos.offset + openLen,
        line: n.pos.line,
        col: n.pos.col + openLen,
      },
      base,
    );
  }
  if (isPos(n.pos)) n.pos = rebasePos(n.pos, base);
  if (isPos(n.end)) n.end = rebasePos(n.end, base);
  for (const [key, value] of Object.entries(n)) {
    if (key === "pos" || key === "end" || key === "type") continue;
    if (key === "stmts" && bodyBase) {
      rebaseTree(value, bodyBase);
      continue;
    }
    rebaseTree(value, base);
  }
}

/** Append literal text to `parts`, coalescing with a trailing Literal. */
function pushLiteral(parts: WordPart[], value: string, pos?: Pos, end?: Pos) {
  if (value.length === 0) return;
  const prev = parts[parts.length - 1];
  if (prev?.type === "Literal") {
    prev.value += value;
    if (end) prev.end = end;
    return;
  }
  const lit: WordPart = { type: "Literal", value };
  if (pos) lit.pos = pos;
  if (end) lit.end = end;
  parts.push(lit);
}

/**
 * Merge adjacent Literal parts into one. Escape provenance lives on the
 * token stream (consumed by keyword/assignment checks before conversion);
 * at the AST level `a\ b` is a single literal, matching bash semantics.
 */
function mergeLiteralParts(parts: WordPart[]): WordPart[] {
  const out: WordPart[] = [];
  for (const part of parts) {
    const prev = out[out.length - 1];
    if (part.type === "Literal" && prev?.type === "Literal") {
      prev.value += part.value;
      if (part.end) prev.end = part.end;
      continue;
    }
    out.push(part);
  }
  return out;
}

/** Decode a Bash ANSI-C quoted string body ($'...') into its value. */
function decodeAnsiC(raw: string): string {
  let out = "";
  let i = 0;
  const hex = /[0-9a-fA-F]/;
  const oct = /[0-7]/;
  while (i < raw.length) {
    const c = raw.charAt(i);
    if (c !== "\\" || i + 1 >= raw.length) {
      out += c;
      i += 1;
      continue;
    }
    const e = raw.charAt(i + 1);
    switch (e) {
      case "a":
        out += "\x07";
        i += 2;
        break;
      case "b":
        out += "\b";
        i += 2;
        break;
      case "e":
      case "E":
        out += "\x1b";
        i += 2;
        break;
      case "f":
        out += "\f";
        i += 2;
        break;
      case "n":
        out += "\n";
        i += 2;
        break;
      case "r":
        out += "\r";
        i += 2;
        break;
      case "t":
        out += "\t";
        i += 2;
        break;
      case "v":
        out += "\v";
        i += 2;
        break;
      case "\\":
      case "'":
      case '"':
      case "?":
        out += e;
        i += 2;
        break;
      case "c": {
        const cx = raw.charAt(i + 2);
        if (cx === "") {
          out += "\\c";
          i += 2;
          break;
        }
        out += String.fromCharCode(cx.toUpperCase().charCodeAt(0) & 0x1f);
        i += 3;
        break;
      }
      case "x": {
        let j = i + 2;
        while (j < raw.length && j < i + 4 && hex.test(raw.charAt(j))) j++;
        if (j === i + 2) {
          out += "\\x";
          i += 2;
          break;
        }
        out += String.fromCodePoint(Number.parseInt(raw.slice(i + 2, j), 16));
        i = j;
        break;
      }
      case "u":
      case "U": {
        const len = e === "u" ? 4 : 8;
        const digits = raw.slice(i + 2, i + 2 + len);
        if (digits.length !== len || ![...digits].every((d) => hex.test(d))) {
          out += `\\${e}`;
          i += 2;
          break;
        }
        const cp = Number.parseInt(digits, 16);
        out += cp <= 0x10ffff ? String.fromCodePoint(cp) : `\\${e}${digits}`;
        i += 2 + len;
        break;
      }
      default: {
        if (oct.test(e)) {
          let j = i + 1;
          while (j < raw.length && j < i + 4 && oct.test(raw.charAt(j))) j++;
          out += String.fromCodePoint(Number.parseInt(raw.slice(i + 1, j), 8));
          i = j;
          break;
        }
        // Unknown escape: the backslash stays literal, as in Bash.
        out += `\\${e}`;
        i += 2;
      }
    }
  }
  return out;
}

/**
 * Text a token part contributes when matching textual boundaries inside an
 * array element (`[index]=`). Substitution parts contribute nothing; escaped
 * literals are invisible per the quoting-fidelity contract.
 */
function arrayElemVisibleText(part: TokenWordPart): string {
  switch (part.type) {
    case "lit":
      return part.escaped === true ? "" : part.value;
    case "sgl":
      return part.value;
    case "dbl":
      return part.parts.map(arrayElemVisibleText).join("");
    default:
      return "";
  }
}

/** Shift a literal part's position by `chars` (same line). */
function shiftPos(pos: Pos, chars: number): Pos {
  return { offset: pos.offset + chars, line: pos.line, col: pos.col + chars };
}

/**
 * Slice a literal token part to [from, to) of its value. Returns undefined
 * when the slice is empty.
 */
export function sliceLitPart(
  part: TokenWordPart & { type: "lit" },
  from: number,
  to: number,
): TokenWordPart | undefined {
  if (to - from <= 0) return undefined;
  return {
    ...part,
    value: part.value.slice(from, to),
    pos: shiftPos(part.pos, from),
    end: shiftPos(part.pos, to),
  };
}

/**
 * Split an array element's token parts at the `[index]=` boundary, matching
 * only on literal text (substitution parts are skipped for the match but
 * kept in the result, so embedded `$(...)` stays structured). Returns
 * undefined when the element is not an indexed assignment.
 */
export function splitIndexedArrayElem(parts: TokenWordPart[]):
  | {
      index: TokenWordPart[];
      value: TokenWordPart[];
    }
  | undefined {
  const chunks = parts.map((part) => ({
    part,
    text: arrayElemVisibleText(part),
  }));
  // Map each visible character to its chunk location.
  let vis = "";
  const vpos: Array<{ chunk: number; offset: number }> = [];
  chunks.forEach((chunk, ci) => {
    for (let k = 0; k < chunk.text.length; k++) {
      vis += chunk.text.charAt(k);
      vpos.push({ chunk: ci, offset: k });
    }
  });
  if (!vis.startsWith("[")) return undefined;
  let closeAt = -1;
  for (let k = 1; k + 1 < vis.length; k++) {
    if (vis.charAt(k) === "]" && vis.charAt(k + 1) === "=") {
      closeAt = k;
      break;
    }
  }
  if (closeAt === -1) return undefined;
  const openLoc = vpos[0];
  const closeLoc = vpos[closeAt];
  const eqLoc = vpos[closeAt + 1];
  if (!openLoc || !closeLoc || !eqLoc) return undefined;
  // The delimiters themselves must be plain literal characters.
  for (const loc of [openLoc, closeLoc, eqLoc]) {
    if (chunks[loc.chunk]?.part.type !== "lit") return undefined;
  }
  // Nothing but empty quote parts may sit between `]` and `=`.
  for (let ci = closeLoc.chunk + 1; ci < eqLoc.chunk; ci++) {
    const chunk = chunks[ci];
    if (!chunk) return undefined;
    if (chunk.text.length > 0) return undefined;
    const t = chunk.part.type;
    if (t !== "sgl" && t !== "dbl") return undefined;
  }
  const index: TokenWordPart[] = [];
  const value: TokenWordPart[] = [];
  chunks.forEach((chunk, ci) => {
    if (ci < openLoc.chunk) return;
    if (ci > eqLoc.chunk) {
      value.push(chunk.part);
      return;
    }
    const p = chunk.part;
    if (p.type !== "lit") {
      // Non-literal chunks fully inside the index region stay structured.
      if (ci > openLoc.chunk && ci < closeLoc.chunk) index.push(chunk.part);
      return;
    }
    const from = ci === openLoc.chunk ? openLoc.offset + 1 : 0;
    const to = ci === closeLoc.chunk ? closeLoc.offset : p.value.length;
    const idx = sliceLitPart(p, from, to);
    if (idx) index.push(idx);
    if (ci === eqLoc.chunk) {
      const val = sliceLitPart(p, eqLoc.offset + 1, p.value.length);
      if (val) value.push(val);
    }
  });
  if (index.length === 0) return undefined;
  return { index, value };
}

/** True for parts that carry only literal/quoted text (no expansions). */
function isQuotablePart(part: TokenWordPart): boolean {
  switch (part.type) {
    case "lit":
    case "sgl":
      return true;
    case "dbl":
      return part.parts.every(isQuotablePart);
    default:
      return false;
  }
}

/** Decoded text of a quotable part (what arithmetic evaluation sees). */
function quotableText(part: TokenWordPart): string {
  switch (part.type) {
    case "lit":
    case "sgl":
      return part.value;
    case "dbl":
      return part.parts.map(quotableText).join("");
    default:
      return "";
  }
}

/** Decl variants whose indexed-assignment operands bash evaluates as
 * arithmetic, surfacing substitutions hidden by quoting. */
export const ARITH_DECL_VARIANTS = new Set(["declare", "typeset", "local"]);

/**
 * Wrap a raw substring (e.g. a slice offset or a replacement pattern) as a
 * single-literal Word. Only used when the string cannot contain expansions;
 * strings captured from user source go through `wordFromShellSource`.
 */
export function strToWord(value: string): Word {
  return { type: "Word", parts: [{ type: "Literal", value }] };
}

export function convertWordPart(
  part: TokenWordPart,
  options?: ParseOptions,
  base?: Pos,
): WordPart {
  const anchor = (pos: Pos): Pos => (base ? rebasePos(pos, base) : pos);
  switch (part.type) {
    case "lit":
      return {
        type: "Literal",
        value: part.value,
        pos: anchor(part.pos),
        end: anchor(part.end),
      };
    case "sgl":
      return {
        type: "SglQuoted",
        value: part.value,
        pos: anchor(part.pos),
        end: anchor(part.end),
      };
    case "dbl":
      return {
        type: "DblQuoted",
        parts: part.parts.map((p) => convertWordPart(p, options, base)),
        pos: anchor(part.pos),
        end: anchor(part.end),
      };
    case "param":
      return convertParamExp(part, options, base);
    case "cmd-subst": {
      const node: CmdSubst = {
        type: "CmdSubst",
        stmts: parseSubstBody(part.raw, part, options, base),
        pos: anchor(part.pos),
        end: anchor(part.end),
      };
      substOpenLen.set(node, part.innerOffset - part.pos.offset);
      return node;
    }
    case "arith-exp": {
      const pos = anchor(part.pos);
      const x = parseArithmetic(part.raw, {
        offset: pos.offset + (part.innerOffset - part.pos.offset),
        line: pos.line,
        col: pos.col + 3,
      });
      if (!x) {
        throw new Error("Empty arithmetic expansion");
      }
      return {
        type: "ArithExp",
        x,
        pos,
        end: anchor(part.end),
      };
    }
    case "proc-subst": {
      const node: ProcSubst = {
        type: "ProcSubst",
        op: part.op,
        stmts: parseSubstBody(part.raw, part, options, base),
        pos: anchor(part.pos),
        end: anchor(part.end),
      };
      substOpenLen.set(node, part.innerOffset - part.pos.offset);
      return node;
    }
    case "backtick": {
      // `body` (contract token-api.md §3) is the backtick-decoded inner
      // text; fall back to the verbatim `raw` for pre-contract tokens.
      // The body starts right after the opening backtick.
      const inner = typeof part.body === "string" ? part.body : part.raw;
      const origin = { pos: part.pos, innerOffset: part.pos.offset + 1 };
      const node: CmdSubst = {
        type: "CmdSubst",
        stmts: parseSubstBody(inner, origin, options, base),
        pos: anchor(part.pos),
        end: anchor(part.end),
      };
      substOpenLen.set(node, 1);
      return node;
    }
    case "ansi-c":
      return {
        type: "AnsiC",
        value: decodeAnsiC(part.value),
        raw: part.value,
        pos: anchor(part.pos),
        end: anchor(part.end),
      };
    case "locale-str":
      return {
        type: "LocaleStr",
        parts: part.parts.map((p) => convertWordPart(p, options, base)),
        pos: anchor(part.pos),
        end: anchor(part.end),
      };
    case "ext-glob": {
      const node: ExtGlob = {
        type: "ExtGlob",
        op: part.op,
        pattern: part.pattern,
        pos: anchor(part.pos),
        end: anchor(part.end),
      };
      // Parse the pattern structurally so expansions inside it surface.
      // The pattern starts right after the two-character operator.
      const patternBase: Pos = {
        offset: part.pos.offset + 2,
        line: part.pos.line,
        col: part.pos.col + 2,
      };
      const word = wordFromShellSource(
        part.pattern,
        options,
        anchor(patternBase),
      );
      const single = word.parts[0];
      if (!(word.parts.length === 1 && single?.type === "Literal")) {
        node.word = word;
      }
      return node;
    }
  }
}

/**
 * Parse a substitution body (`$(...)`, `<(...)`, backticks). When `base`
 * is given, the part lives in a reparsed fragment and every descendant
 * position is anchored to the source; the body starts at `innerOffset`.
 */
function parseSubstBody(
  raw: string,
  part: { pos: Pos; innerOffset: number },
  options: ParseOptions | undefined,
  base: Pos | undefined,
): Statement[] {
  const prog = parseInnerProgram(raw, options, innerBase(part));
  if (base) {
    rebaseTree(prog.body, rebasePos(innerBase(part), base));
  }
  return prog.body;
}

/**
 * Fold a raw source fragment (captured verbatim by the tokenizer, e.g. a
 * `${...}` operator operand or an extglob pattern) into a single Word by
 * re-tokenizing it. Expansions recover their structure; quotes merge back
 * into the literal text around them. When `base` is given, fragment
 * positions are anchored to the source.
 */
function wordFromShellSource(
  raw: string,
  options?: ParseOptions,
  base?: Pos,
): Word {
  const tokens = tokenize(raw, options);
  const map = new SourceMap(raw);
  const parts: WordPart[] = [];
  const anchor = (pos?: Pos): Pos | undefined =>
    pos && base ? rebasePos(pos, base) : pos;
  // Re-tokenization splits the fragment at whitespace and other gaps;
  // restore the exact source text between consecutive tokens so the
  // folded word stays faithful to the fragment.
  let lastEnd = 0;
  const pushGap = (upto: number) => {
    if (upto <= lastEnd) return;
    pushLiteral(
      parts,
      raw.slice(lastEnd, upto),
      anchor(map.posAt(lastEnd)),
      anchor(map.posAt(upto)),
    );
  };
  for (const tok of tokens) {
    pushGap(tok.pos.offset);
    lastEnd = tok.end.offset;
    switch (tok.type) {
      case "word":
        for (const part of tok.parts) {
          if (part.type === "lit") {
            pushLiteral(parts, part.value, anchor(part.pos), anchor(part.end));
          } else {
            parts.push(convertWordPart(part, options, base));
          }
        }
        break;
      case "op":
      case "symbol":
        pushLiteral(parts, tok.value, anchor(tok.pos), anchor(tok.end));
        break;
      case "redir":
        pushLiteral(
          parts,
          `${tok.fd ?? ""}${tok.op}`,
          anchor(tok.pos),
          anchor(tok.end),
        );
        break;
      case "comment":
        pushLiteral(parts, `#${tok.text}`, anchor(tok.pos), anchor(tok.end));
        break;
      default:
        // arith-cmd / heredoc-body cannot appear inside these fragments.
        break;
    }
  }
  pushGap(raw.length);
  return parts.length === 0 ? strToWord("") : { type: "Word", parts };
}

/**
 * Scan `text` for expansions only (no quote or word-splitting semantics):
 * `$name`, `${...}`, `$(...)`, `$((...))` and backticks become structured
 * parts; everything else stays literal. A backslash before `$`, `` ` `` or
 * `\` decodes to the literal character (heredoc-body rule). `escaped(i)`
 * marks characters that came from an escape-provenance literal part; they
 * never start an expansion.
 */
export function scanExpansionText(
  text: string,
  options: ParseOptions | undefined,
  opts: { base?: Pos; escaped?: (index: number) => boolean } = {},
): WordPart[] {
  const map = new SourceMap(text);
  const escaped = opts.escaped ?? (() => false);
  const anchor = (pos: Pos): Pos | undefined =>
    opts.base ? rebasePos(pos, opts.base) : undefined;
  const parts: WordPart[] = [];
  let lit = "";
  let litStart = 0;
  let i = 0;
  const flushLit = (endOffset: number) => {
    if (lit.length === 0) return;
    pushLiteral(
      parts,
      lit,
      anchor(map.posAt(litStart)),
      anchor(map.posAt(endOffset)),
    );
    lit = "";
  };
  while (i < text.length) {
    const c = text.charAt(i);
    if (!escaped(i) && c === "\\" && i + 1 < text.length) {
      const n = text.charAt(i + 1);
      if (n === "$" || n === "`" || n === "\\") {
        if (lit.length === 0) litStart = i;
        lit += n;
        i += 2;
        continue;
      }
    }
    if (!escaped(i) && (c === "$" || c === "`")) {
      const scanned =
        c === "$"
          ? scanExpansion(text, i, map, options)
          : scanBacktick(text, i, map);
      if (scanned) {
        flushLit(i);
        parts.push(convertWordPart(scanned.part, options, opts.base));
        i = scanned.end;
        continue;
      }
    }
    if (lit.length === 0) litStart = i;
    lit += c;
    i += 1;
  }
  flushLit(text.length);
  return parts;
}

/**
 * Bash evaluates the indexed-assignment operands of `let` and
 * `declare`/`typeset`/`local` as arithmetic text, and array-subscript
 * evaluation expands `$(...)`/backticks even when the operand was quoted.
 * Rebuild such operands so the substitutions surface as structured parts;
 * other operands stay plain.
 */
export function arithOperandWord(
  token: Token & { type: "word" },
  word: Word,
  options?: ParseOptions,
): Word {
  // Parts that are already structured surface substitutions already.
  if (!token.parts.every(isQuotablePart)) return word;
  const flat = token.parts.map(quotableText).join("");
  if (!/^[A-Za-z_][A-Za-z0-9_]*\[/.test(flat)) return word;
  const escapedSet = new Set<number>();
  let offset = 0;
  for (const part of token.parts) {
    const text = quotableText(part);
    if (part.type === "lit" && part.escaped === true) {
      for (let k = 0; k < text.length; k++) escapedSet.add(offset + k);
    }
    offset += text.length;
  }
  const scanned = scanExpansionText(flat, options, {
    escaped: (i) => escapedSet.has(i),
  });
  if (!scanned.some((p) => p.type !== "Literal")) return word;
  return { type: "Word", parts: scanned, pos: token.pos, end: token.end };
}

export function convertParamExp(
  part: TokenWordPart & { type: "param" },
  options?: ParseOptions,
  base?: Pos,
): ParamExp {
  const anchor = (pos: Pos): Pos => (base ? rebasePos(pos, base) : pos);
  const pos = anchor(part.pos);
  const out: ParamExp = {
    type: "ParamExp",
    short: !part.braced,
    param: { type: "Literal", value: part.name },
    pos,
    end: anchor(part.end),
  };
  if (part.length) out.length = true;
  if (part.excl) out.excl = true;
  // Fragments (index/slice/replace/operator word) are verbatim substrings
  // of the `${...}` source; each starts right after its syntactic marker.
  // Track the source text from the expansion start so base positions
  // account for newlines inside earlier fragments.
  let prefix = part.braced ? "${" : "$";
  if (part.length) prefix += "#";
  if (part.excl) prefix += "!";
  prefix += part.name;
  const baseAfter = (text: string): Pos => absPos(pos, text, text.length);
  if (part.index !== undefined) {
    out.index = wordFromShellSource(
      part.index,
      options,
      baseAfter(`${prefix}[`),
    );
    prefix += `[${part.index}]`;
  }
  if (part.slice) {
    const slice: ParamExp["slice"] = {
      offset: wordFromShellSource(
        part.slice.offset,
        options,
        baseAfter(`${prefix}:`),
      ),
    };
    if (part.slice.length !== undefined) {
      slice.length = wordFromShellSource(
        part.slice.length,
        options,
        baseAfter(`${prefix}:${part.slice.offset}:`),
      );
    }
    out.slice = slice;
  }
  if (part.replace) {
    const marker = `/${part.replace.all ? "/" : ""}${
      part.replace.prefix ? "#" : part.replace.suffix ? "%" : ""
    }`;
    const r: ParamExp["replace"] = {
      orig: wordFromShellSource(
        part.replace.orig,
        options,
        baseAfter(prefix + marker),
      ),
    };
    if (part.replace.with !== undefined)
      r.with = wordFromShellSource(
        part.replace.with,
        options,
        baseAfter(`${prefix + marker + part.replace.orig}/`),
      );
    if (part.replace.all) r.all = true;
    if (part.replace.prefix) r.prefix = true;
    if (part.replace.suffix) r.suffix = true;
    out.replace = r;
  }
  if (part.exp) {
    const exp: ParamExp["exp"] = {
      op: part.exp.op as ParamExpOp,
    };
    if (part.exp.value !== undefined)
      exp.word = wordFromShellSource(
        part.exp.value,
        options,
        baseAfter(prefix + part.exp.op),
      );
    out.exp = exp;
  }
  return out;
}

export function wordFromToken(
  token: Token & { type: "word" },
  options?: ParseOptions,
): Word {
  return {
    type: "Word",
    parts: mergeLiteralParts(
      token.parts.map((part) => convertWordPart(part, options)),
    ),
    pos: token.pos,
    end: token.end,
  };
}
