import type { TokenWordPart } from "./types";

export function scanBacktick(
  source: string,
  pos: number,
): { part: TokenWordPart; end: number } {
  let j = pos + 1;
  while (j < source.length && source.charAt(j) !== "`") {
    if (source.charAt(j) === "\\") j++;
    j++;
  }
  const raw = source.slice(pos + 1, j);
  return { part: { type: "backtick", raw }, end: j + 1 };
}
