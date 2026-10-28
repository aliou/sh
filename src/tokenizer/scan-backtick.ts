import type { SourceMap } from "./cursor";
import type { TokenWordPart } from "./types";

/** Decode backslash sequences bash resolves inside backquotes. */
function decodeBacktickBody(raw: string): string {
  let out = "";
  for (let k = 0; k < raw.length; k++) {
    const c = raw.charAt(k);
    const next = raw.charAt(k + 1);
    if (c === "\\" && (next === "`" || next === "\\" || next === "$")) {
      out += next;
      k += 1;
      continue;
    }
    out += c;
  }
  return out;
}

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
      body: decodeBacktickBody(raw),
      pos: map.posAt(pos),
      end: map.posAt(j + 1),
    },
    end: j + 1,
  };
}
