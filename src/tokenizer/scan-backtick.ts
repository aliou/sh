import type { SourceMap } from "./cursor";
import type { TokenWordPart } from "./types";

export function scanBacktick(
  source: string,
  pos: number,
  map: SourceMap,
): { part: TokenWordPart; end: number } {
  let j = pos + 1;
  while (j < source.length && source.charAt(j) !== "`") {
    if (source.charAt(j) === "\\") j++;
    j++;
  }
  const raw = source.slice(pos + 1, j);
  return {
    part: {
      type: "backtick",
      raw,
      innerOffset: pos + 1,
      pos: map.posAt(pos),
      end: map.posAt(j + 1),
    },
    end: j + 1,
  };
}
