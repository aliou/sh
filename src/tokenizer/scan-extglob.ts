import type { SourceMap } from "./cursor";
import type { TokenWordPart } from "./types";

type ExtGlobOp = "?(" | "*(" | "+(" | "@(" | "!(";

const isExtGlobHead = (c: string): c is "?" | "*" | "+" | "@" | "!" =>
  c === "?" || c === "*" || c === "+" || c === "@" || c === "!";

/**
 * If `source[pos]` is the start of an extended glob (`?(`, `*(`, `+(`,
 * `@(`, or `!(`), scan to the matching `)` and return an `ext-glob` part.
 * Returns null otherwise. Properly handles nested parens.
 */
export function scanExtGlob(
  source: string,
  pos: number,
  map: SourceMap,
): { part: TokenWordPart; end: number } | null {
  const head = source.charAt(pos);
  if (!isExtGlobHead(head)) return null;
  if (source.charAt(pos + 1) !== "(") return null;

  const op = `${head}(` as ExtGlobOp;
  let j = pos + 2;
  let depth = 1;
  while (j < source.length) {
    const ch = source.charAt(j);
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        const pattern = source.slice(pos + 2, j);
        return {
          part: {
            type: "ext-glob",
            op,
            pattern,
            pos: map.posAt(pos),
            end: map.posAt(j + 1),
          },
          end: j + 1,
        };
      }
    }
    j++;
  }
  return null;
}
