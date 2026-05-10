import type { Pos } from "../ast";

/**
 * A read-only cursor over the source string that tracks byte offset, line, and column.
 * Lines are 1-indexed; columns are 1-indexed; offset is 0-indexed.
 *
 * The tokenizer mutates `i` directly for legacy reasons; `posAt(i)` is used to recover
 * the (line, col) for any offset on demand.
 */
export class SourceMap {
  /** Sorted list of offsets where each line starts. lineStarts[0] is always 0. */
  private readonly lineStarts: number[];

  constructor(public readonly source: string) {
    this.lineStarts = [0];
    for (let i = 0; i < source.length; i++) {
      if (source.charCodeAt(i) === 10 /* \n */) {
        this.lineStarts.push(i + 1);
      }
    }
  }

  posAt(offset: number): Pos {
    // Binary search for the largest lineStart <= offset.
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      const start = this.lineStarts[mid];
      if (start !== undefined && start <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    const lineStart = this.lineStarts[lo] ?? 0;
    return { offset, line: lo + 1, col: offset - lineStart + 1 };
  }
}
