import type { RedirOp } from "../ast";

export function tryRedirOp(
  source: string,
  pos: number,
): { op: RedirOp; len: number } | null {
  if (source.startsWith("<<<", pos)) return { op: "<<<", len: 3 };
  if (source.startsWith("&>>", pos)) return { op: "&>>", len: 3 };
  if (source.startsWith("<<-", pos)) return { op: "<<-", len: 3 };
  if (source.startsWith(">>", pos)) return { op: ">>", len: 2 };
  if (source.startsWith(">&", pos)) return { op: ">&", len: 2 };
  if (source.startsWith(">|", pos)) return { op: ">|", len: 2 };
  if (source.startsWith("<>", pos)) return { op: "<>", len: 2 };
  if (source.startsWith("<&", pos)) return { op: "<&", len: 2 };
  if (source.startsWith("&>", pos)) return { op: "&>", len: 2 };
  if (source.startsWith("<<", pos)) return { op: "<<", len: 2 };
  if (source.charAt(pos) === ">") return { op: ">", len: 1 };
  if (source.charAt(pos) === "<") return { op: "<", len: 1 };
  return null;
}
