import type { ParseOptions, Statement, Word } from "./ast";
import { Parser } from "./parser";
import { tokenize } from "./tokenizer";

/**
 * Lazily parse `source` and yield each top-level statement as it becomes
 * available. Useful for streaming consumers (REPLs, progressive analysis
 * tools) that don't need the whole `Program` up front.
 *
 * Mirrors mvdan/sh's `Parser.StmtsSeq`.
 */
export function* parseStmtsSeq(
  source: string,
  options: ParseOptions = {},
): Generator<Statement> {
  const tokens = tokenize(source, options);
  const parser = new Parser(tokens, options);
  yield* parser.statementsSeq();
}

/**
 * Lazily parse `source` as a sequence of words (no statement structure),
 * yielding each one. Useful for argv-style inputs.
 *
 * Mirrors mvdan/sh's `Parser.WordsSeq`.
 */
export function* parseWordsSeq(
  source: string,
  options: ParseOptions = {},
): Generator<Word> {
  const tokens = tokenize(source, options);
  const parser = new Parser(tokens, options);
  yield* parser.wordsSeq();
}
