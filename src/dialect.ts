import type { Pos, ShellDialect } from "./ast";

/** Bash-like (Bash, Bats). mksh shares many but not all of these. */
export const isBashLike = (d: ShellDialect | undefined): boolean =>
  d === undefined || d === "bash";

/** Is the current dialect POSIX (the strictest mode)? */
export const isPosix = (d: ShellDialect | undefined): boolean => d === "posix";

/** Is the current dialect mksh? */
export const isMksh = (d: ShellDialect | undefined): boolean => d === "mksh";

/**
 * Throw a LangError-style error if the current dialect doesn't permit
 * `feature`. Allowed dialects are listed in `allowedIn`.
 *
 * Mirrors the contract of mvdan/sh's `Parser.checkLang`: error messages
 * follow the form `<feature> is a <allowed> feature`.
 */
export function checkLang(
  current: ShellDialect | undefined,
  pos: Pos | undefined,
  feature: string,
  allowedIn: ShellDialect[],
): void {
  const effective = current ?? "bash";
  if (allowedIn.includes(effective)) return;
  const allowedDesc =
    allowedIn.length === 1 ? allowedIn[0] : allowedIn.join("/");
  const where = pos ? ` at ${pos.line}:${pos.col}` : "";
  throw new Error(
    `${feature} is a ${allowedDesc} feature; tried parsing as ${effective}${where}`,
  );
}
