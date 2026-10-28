/**
 * Recursively walk any node (AST or fragment) and report whether it
 * contains a CmdSubst or ProcSubst anywhere — mirrors the walker
 * documented in skills/sh-ast/SKILL.md.
 */
export function hasSubstitution(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const obj = node as Record<string, unknown>;
  if (obj.type === "CmdSubst" || obj.type === "ProcSubst") return true;
  for (const val of Object.values(obj)) {
    if (Array.isArray(val)) {
      if (val.some(hasSubstitution)) return true;
    } else if (val && typeof val === "object") {
      if (hasSubstitution(val)) return true;
    }
  }
  return false;
}
