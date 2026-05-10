/**
 * Recursively strip `pos` and `end` fields from an AST or any value.
 * Returns a deep clone with those fields removed.
 */
export function stripPos<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripPos(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "pos" || k === "end") continue;
      out[k] = stripPos(v);
    }
    return out as unknown as T;
  }
  return value;
}
