import type { ParseOptions, ParseResult } from "./ast";
import { Parser } from "./parser";
import { tokenize } from "./tokenizer";

export function parse(source: string, options: ParseOptions = {}): ParseResult {
  const tokens = tokenize(source, options);
  const parser = new Parser(tokens, options);
  const ast = parser.parseProgram();
  parser.assertEof();
  return { ast };
}
