export type ShellDialect = "posix" | "bash" | "mksh" | "zsh";

export type ParseOptions = {
  dialect?: ShellDialect;
  /** If true, keep comments as nodes/tokens in the output (future). */
  keepComments?: boolean;
};

export type ParseResult = {
  // Placeholder until we define the real AST.
  ast: unknown;
};

export function parse(
  _source: string,
  _options: ParseOptions = {},
): ParseResult {
  throw new Error("Not implemented yet");
}
