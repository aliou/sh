import type { ParseOptions } from "../ast";
import { checkLang } from "../dialect";
import { isDigit, isNameChar, isNameStart, specialParams } from "./charsets";
import type { SourceMap } from "./cursor";
import type { TokenWordPart } from "./types";

export function scanExpansion(
  source: string,
  pos: number,
  map: SourceMap,
  options: ParseOptions = {},
): { part: TokenWordPart; end: number } | null {
  if (source.charAt(pos) !== "$") return null;
  const next = source.charAt(pos + 1);

  // $((expr)) arithmetic expansion
  if (next === "(" && source.charAt(pos + 2) === "(") {
    let j = pos + 3;
    let depth = 0;
    while (j < source.length) {
      if (
        source.charAt(j) === ")" &&
        source.charAt(j + 1) === ")" &&
        depth === 0
      )
        break;
      if (source.charAt(j) === "(") depth++;
      if (source.charAt(j) === ")") depth--;
      j++;
    }
    const expr = source.slice(pos + 3, j).trim();
    return {
      part: {
        type: "arith-exp",
        raw: expr,
        innerOffset: pos + 3,
        pos: map.posAt(pos),
        end: map.posAt(j + 2),
      },
      end: j + 2,
    };
  }

  // $(cmd) command substitution
  if (next === "(") {
    let j = pos + 2;
    let depth = 1;
    while (j < source.length && depth > 0) {
      if (source.charAt(j) === "(") depth++;
      if (source.charAt(j) === ")") depth--;
      j++;
    }
    const raw = source.slice(pos + 2, j - 1);
    return {
      part: {
        type: "cmd-subst",
        raw,
        innerOffset: pos + 2,
        pos: map.posAt(pos),
        end: map.posAt(j),
      },
      end: j,
    };
  }

  // ${...} braced parameter expansion
  if (next === "{") {
    let j = pos + 2;
    let depth = 1;
    while (j < source.length && depth > 0) {
      if (source.charAt(j) === "{") depth++;
      if (source.charAt(j) === "}") depth--;
      j++;
    }
    const inner = source.slice(pos + 2, j - 1);
    if (
      inner.charAt(0) === "!" &&
      /^![A-Za-z_][A-Za-z0-9_]*[*@]$/.test(inner)
    ) {
      checkLang(options.dialect, map.posAt(pos), "${!name*}", ["bash", "zsh"]);
    }
    const part = parseBracedParam(inner, map.posAt(pos), map.posAt(j));
    return { part, end: j };
  }

  // $name (long), $N (digit), or $@/$?/$# (special)
  if (isNameStart(next)) {
    let j = pos + 2;
    while (j < source.length && isNameChar(source.charAt(j))) j++;
    return shortParam(source.slice(pos + 1, j), pos, j, map);
  }
  if (isDigit(next) || specialParams.has(next)) {
    return shortParam(next, pos, pos + 2, map);
  }

  return null;
}

function shortParam(
  name: string,
  start: number,
  end: number,
  map: SourceMap,
): { part: TokenWordPart; end: number } {
  return {
    part: {
      type: "param",
      name,
      braced: false,
      pos: map.posAt(start),
      end: map.posAt(end),
    },
    end,
  };
}

/**
 * Parse the inner of `${...}` into a structured `param` token.
 * Forms supported:
 *   - ${name} / ${#name} (length) / ${!name} (indirect)
 *   - ${name[index]}
 *   - ${name OP word} where OP is `:- - := = :+ + :? ? :?`
 *   - ${name#pat} / ${name##pat} / ${name%pat} / ${name%%pat}
 *   - ${name^} / ${name^^} / ${name,} / ${name,,}
 *   - ${name@OP}
 *   - ${name:offset[:length]}
 *   - ${name/pat[/with]} / ${name//pat/with} / ${name/#pat/with} / ${name/%pat/with}
 */
function parseBracedParam(
  inner: string,
  pos: { offset: number; line: number; col: number },
  end: { offset: number; line: number; col: number },
): TokenWordPart {
  let i = 0;
  let length = false;
  let excl = false;

  if (inner.charAt(0) === "#") {
    // `${#name}` is length, but `${#}` is the special parameter `$#`.
    // Distinguish by checking whether the rest is an operator/empty.
    const rest = inner.slice(1);
    if (
      rest.length > 0 &&
      (isNameStart(rest.charAt(0)) ||
        isDigit(rest.charAt(0)) ||
        specialParams.has(rest.charAt(0)))
    ) {
      length = true;
      i = 1;
    }
  } else if (inner.charAt(0) === "!") {
    // `${!name}` is indirect; if rest is empty or just operator, treat as `$!`.
    const rest = inner.slice(1);
    if (
      rest.length > 0 &&
      (isNameStart(rest.charAt(0)) || isDigit(rest.charAt(0)))
    ) {
      excl = true;
      i = 1;
    }
  }

  const nameStart = i;
  while (i < inner.length && isNameChar(inner.charAt(i))) i++;
  let name: string;
  let rest: string;
  if (i === nameStart) {
    // No name part — could be a special param like `${@}`, `${?}`, etc.
    if (i < inner.length && specialParams.has(inner.charAt(i))) {
      name = inner.charAt(i);
      i += 1;
      rest = inner.slice(i);
    } else {
      // Fallback: treat the whole inner as the name.
      name = inner;
      rest = "";
      i = inner.length;
    }
  } else {
    name = inner.slice(nameStart, i);
    rest = inner.slice(i);
  }

  const part: TokenWordPart & { type: "param" } = {
    type: "param",
    name,
    braced: true,
    pos,
    end,
  };
  if (length) part.length = true;
  if (excl) part.excl = true;

  // Optional [index]
  if (rest.charAt(0) === "[") {
    const closeIdx = findMatching(rest, 0, "[", "]");
    if (closeIdx > 0) {
      part.index = rest.slice(1, closeIdx);
      rest = rest.slice(closeIdx + 1);
    }
  }

  if (rest.length === 0) return part;

  // Substring slice: `:offset[:length]`. The colon must NOT be followed by
  // `-`/`=`/`+`/`?` (those are :- := :+ :?).
  if (
    rest.charAt(0) === ":" &&
    rest.charAt(1) !== "-" &&
    rest.charAt(1) !== "=" &&
    rest.charAt(1) !== "+" &&
    rest.charAt(1) !== "?"
  ) {
    const after = rest.slice(1);
    const colon = findColonOutsideParens(after);
    if (colon === -1) {
      part.slice = { offset: after.trim() };
    } else {
      part.slice = {
        offset: after.slice(0, colon).trim(),
        length: after.slice(colon + 1).trim(),
      };
    }
    return part;
  }

  // Pattern replacement: `/pat[/with]` / `//pat/with` / `/#pat/with` / `/%pat/with`
  if (rest.charAt(0) === "/") {
    let r = rest.slice(1);
    let all = false;
    let prefix = false;
    let suffix = false;
    if (r.charAt(0) === "/") {
      all = true;
      r = r.slice(1);
    } else if (r.charAt(0) === "#") {
      prefix = true;
      r = r.slice(1);
    } else if (r.charAt(0) === "%") {
      suffix = true;
      r = r.slice(1);
    }
    const slash = findUnescapedSlash(r);
    const orig = slash === -1 ? r : r.slice(0, slash);
    const replace: NonNullable<typeof part.replace> = { orig };
    if (slash !== -1) replace.with = r.slice(slash + 1);
    if (all) replace.all = true;
    if (prefix) replace.prefix = true;
    if (suffix) replace.suffix = true;
    part.replace = replace;
    return part;
  }

  // Standard expansion operators. Order matters: longer matches first.
  const ops = [
    ":-",
    ":=",
    ":+",
    ":?",
    "##",
    "%%",
    "^^",
    ",,",
    "@U",
    "@u",
    "@L",
    "@Q",
    "@E",
    "@P",
    "@A",
    "@K",
    "@k",
    "@a",
    "-",
    "=",
    "+",
    "?",
    "#",
    "%",
    "^",
    ",",
  ];
  for (const op of ops) {
    if (rest.startsWith(op)) {
      const value = rest.slice(op.length);
      part.exp = value.length > 0 ? { op, value } : { op };
      return part;
    }
  }

  // Unknown trailing — leave as-is.
  return part;
}

function findMatching(
  s: string,
  from: number,
  open: string,
  close: string,
): number {
  let depth = 0;
  for (let i = from; i < s.length; i++) {
    if (s[i] === open) depth++;
    else if (s[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findColonOutsideParens(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (s[i] === ":" && depth === 0) return i;
  }
  return -1;
}

function findUnescapedSlash(s: string): number {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === "/") return i;
  }
  return -1;
}
