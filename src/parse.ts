import type { ParseError, ParseOptions, ParseResult } from "./ast";
import { Parser } from "./parser";
import { tokenize } from "./tokenizer";
import { SourceMap } from "./tokenizer/cursor";

export function parse(source: string, options: ParseOptions = {}): ParseResult {
  if (options.recoverErrors) {
    return parseRecovering(source, options);
  }
  const tokens = tokenize(source, options);
  const parser = new Parser(tokens, options);
  const ast = parser.parseProgram();
  parser.assertEof();
  return { ast };
}

function parseRecovering(source: string, options: ParseOptions): ParseResult {
  const errors: ParseError[] = [];
  let tokens: ReturnType<typeof tokenize>;
  try {
    tokens = tokenize(source, options);
  } catch (e) {
    errors.push({
      message: e instanceof Error ? e.message : String(e),
      pos: { offset: 0, line: 1, col: 1 },
    });
    const map = new SourceMap(source);
    return {
      ast: {
        type: "Program",
        body: [],
        pos: { offset: 0, line: 1, col: 1 },
        end: map.posAt(source.length),
      },
      errors,
    };
  }
  const parser = new Parser(tokens, options);
  const result = parser.parseProgramRecovering(errors);
  return errors.length > 0 ? { ast: result, errors } : { ast: result };
}
