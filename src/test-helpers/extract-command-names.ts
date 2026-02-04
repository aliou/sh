/**
 * Extract all command names (first word of each SimpleCommand) from
 * a parsed program, recursively walking the AST.
 */
export function extractCommandNames(node: unknown): string[] {
  if (!node || typeof node !== "object") return [];
  const n = node as Record<string, unknown>;
  const names: string[] = [];

  if (
    n.type === "SimpleCommand" &&
    Array.isArray(n.words) &&
    n.words.length > 0
  ) {
    const firstWord = n.words[0] as
      | { parts: Array<{ type: string; value?: string }> }
      | undefined;
    // Only extract if first word is a plain literal (no expansions)
    if (
      firstWord &&
      firstWord.parts.length === 1 &&
      firstWord.parts[0]?.type === "Literal"
    ) {
      names.push(firstWord.parts[0].value as string);
    }
  }

  for (const val of Object.values(n)) {
    if (Array.isArray(val)) {
      for (const item of val) {
        names.push(...extractCommandNames(item));
      }
    } else if (val && typeof val === "object") {
      names.push(...extractCommandNames(val));
    }
  }
  return names;
}
