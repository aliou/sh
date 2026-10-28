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
    // Only extract if every part of the first word is a plain literal (no
    // expansions). Adjacent literals join — the tokenizer may split literal
    // runs around backslash escapes without changing the command name.
    if (
      firstWord &&
      firstWord.parts.length > 0 &&
      firstWord.parts.every((p) => p.type === "Literal")
    ) {
      names.push(firstWord.parts.map((p) => p.value as string).join(""));
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
