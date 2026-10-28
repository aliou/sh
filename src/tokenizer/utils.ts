import type { TokenWordPart } from "./types";

/**
 * Find the offset of the unescaped closing `'` of an ANSI-C quote whose inner
 * text starts at `from`, or -1 when unterminated. `\\` and `\'` do not end
 * the string.
 */
export function findAnsiCEnd(source: string, from: number): number {
  let j = from;
  while (j < source.length) {
    const c = source.charAt(j);
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "'") return j;
    j += 1;
  }
  return -1;
}

/**
 * Derive the heredoc delimiter bash would match from the delimiter word's
 * original source span. Applies quote removal only: `'...'`/`"..."` content
 * is kept literally, backslash escapes resolve to the next character, and
 * everything else (`$x`, `$(...)`, backticks) is preserved verbatim.
 * `quoted` is true when the span contained any quoting (`'`, `"`, `\`),
 * which suppresses expansion of the heredoc body.
 */
export function heredocDelimiter(span: string): {
  delimiter: string;
  quoted: boolean;
} {
  let delimiter = "";
  let quoted = false;
  let k = 0;
  while (k < span.length) {
    const c = span.charAt(k);
    if (c === "'") {
      quoted = true;
      const close = span.indexOf("'", k + 1);
      if (close === -1) {
        delimiter += span.slice(k + 1);
        break;
      }
      delimiter += span.slice(k + 1, close);
      k = close + 1;
      continue;
    }
    if (c === '"') {
      quoted = true;
      k += 1;
      while (k < span.length && span.charAt(k) !== '"') {
        const dq = span.charAt(k);
        const next = span.charAt(k + 1);
        if (
          dq === "\\" &&
          (next === '"' ||
            next === "\\" ||
            next === "$" ||
            next === "`" ||
            next === "\n")
        ) {
          if (next !== "\n") delimiter += next;
          k += 2;
          continue;
        }
        delimiter += dq;
        k += 1;
      }
      k += 1; // closing quote
      continue;
    }
    if (c === "\\" && k + 1 < span.length) {
      quoted = true;
      delimiter += span.charAt(k + 1);
      k += 2;
      continue;
    }
    delimiter += c;
    k += 1;
  }
  return { delimiter, quoted };
}

export function tokenPartsText(parts: TokenWordPart[]): string {
  return parts
    .map((p) => {
      if (p.type === "lit") return p.value;
      if (p.type === "sgl") return p.value;
      if (p.type === "dbl")
        return p.parts
          .map((dp) => (dp.type === "lit" ? dp.value : ""))
          .join("");
      return "";
    })
    .join("");
}
