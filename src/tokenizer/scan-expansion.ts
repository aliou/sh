import { isDigit, isNameChar, isNameStart, specialParams } from "./charsets";
import type { SourceMap } from "./cursor";
import type { TokenWordPart } from "./types";

export function scanExpansion(
  source: string,
  pos: number,
  map: SourceMap,
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
    // Parse inner: name then optional op and value
    let nameEnd = 0;
    // Skip optional ! # prefix
    let prefix = "";
    if (inner.charAt(0) === "!" || inner.charAt(0) === "#") {
      prefix = inner.charAt(0);
      nameEnd = 1;
    }
    while (nameEnd < inner.length && isNameChar(inner.charAt(nameEnd))) {
      nameEnd++;
    }
    const name = inner.slice(prefix ? 1 : 0, nameEnd);
    const rest = inner.slice(nameEnd);
    const partPos = map.posAt(pos);
    const partEnd = map.posAt(j);
    if (rest.length > 0) {
      // Try to extract operator and value
      const opMatch = rest.match(
        /^(:-|:=|:\+|:\?|-|\+|=|\?|##|%%|#|%|\/\/|\/)/,
      );
      if (opMatch) {
        const op = opMatch[0];
        const value = rest.slice(op.length);
        return {
          part: {
            type: "param",
            name,
            braced: true,
            op,
            value,
            pos: partPos,
            end: partEnd,
          },
          end: j,
        };
      }
      // Slice or other complex syntax - store raw inner as the name.
      return {
        part: {
          type: "param",
          name: inner,
          braced: true,
          pos: partPos,
          end: partEnd,
        },
        end: j,
      };
    }
    return {
      part: {
        type: "param",
        name,
        braced: true,
        pos: partPos,
        end: partEnd,
      },
      end: j,
    };
  }

  // $name or $N or $@ etc
  if (isNameStart(next)) {
    let j = pos + 2;
    while (j < source.length && isNameChar(source.charAt(j))) {
      j++;
    }
    const name = source.slice(pos + 1, j);
    return {
      part: {
        type: "param",
        name,
        braced: false,
        pos: map.posAt(pos),
        end: map.posAt(j),
      },
      end: j,
    };
  }
  if (isDigit(next)) {
    return {
      part: {
        type: "param",
        name: next,
        braced: false,
        pos: map.posAt(pos),
        end: map.posAt(pos + 2),
      },
      end: pos + 2,
    };
  }
  if (specialParams.has(next)) {
    return {
      part: {
        type: "param",
        name: next,
        braced: false,
        pos: map.posAt(pos),
        end: map.posAt(pos + 2),
      },
      end: pos + 2,
    };
  }

  return null;
}
