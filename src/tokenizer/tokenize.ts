import type { ParseOptions } from "../ast";
import { checkLang } from "../dialect";
import {
  isDigit,
  isNameChar,
  isNameStart,
  operatorChars,
  redirChars,
  symbolChars,
} from "./charsets";
import { SourceMap } from "./cursor";
import { scanBacktick } from "./scan-backtick";
import { scanExpansion } from "./scan-expansion";
import { scanExtGlob } from "./scan-extglob";
import { tryRedirOp } from "./scan-redir";
import type { SymbolTokenValue, Token, TokenWordPart } from "./types";
import { tokenPartsText } from "./utils";

export function tokenize(source: string, options: ParseOptions = {}): Token[] {
  const map = new SourceMap(source);
  const tokens: Token[] = [];
  let i = 0;
  let atBoundary = true;
  // Heredocs whose delimiter has been seen but body hasn't been collected yet,
  // in order. Drained on each newline. Replaces an earlier O(n²) per-newline
  // scan over all tokens.
  const heredocQueue: { strip: boolean; delimiter: string }[] = [];

  // Track whether we are inside a [[ ... ]] test clause. '#' has no comment
  // meaning inside such tests, so we suppress comment tokenization there.
  const supportsTestClause = options.dialect !== "posix";
  let testDepth = 0;

  const isTestOpenToken = (parts: TokenWordPart[]): boolean =>
    parts.length === 1 && parts[0]?.type === "lit" && parts[0].value === "[[";

  const isTestCloseToken = (parts: TokenWordPart[]): boolean =>
    parts.length === 1 && parts[0]?.type === "lit" && parts[0].value === "]]";

  const canStartTestClause = (): boolean => {
    const prev = tokens[tokens.length - 1];
    if (!prev) return true;
    if (prev.type === "op") return true;
    if (prev.type === "symbol" && (prev.value === "(" || prev.value === "{")) {
      return true;
    }
    if (
      prev.type === "comment" ||
      prev.type === "heredoc-body" ||
      prev.type === "arith-cmd"
    )
      return true;
    return false;
  };

  // Whenever a `<<` or `<<-` redir is followed by a delimiter word, queue it
  // for the next newline.
  const queueHeredocIfPending = () => {
    const last = tokens[tokens.length - 1];
    const prev = tokens[tokens.length - 2];
    if (
      prev &&
      last &&
      last.type === "word" &&
      prev.type === "redir" &&
      (prev.op === "<<" || prev.op === "<<-")
    ) {
      heredocQueue.push({
        strip: prev.op === "<<-",
        delimiter: tokenPartsText(last.parts),
      });
    }
  };

  while (i < source.length) {
    const ch = source.charAt(i);

    if (ch === " " || ch === "\t" || ch === "\r") {
      atBoundary = true;
      i += 1;
      continue;
    }

    if (ch === "\\" && source.charAt(i + 1) === "\n") {
      atBoundary = true;
      i += 2;
      continue;
    }

    if (ch === "\\" && source.charAt(i + 1) === "\r") {
      if (source.charAt(i + 2) === "\n") {
        atBoundary = true;
        i += 3;
        continue;
      }
    }

    if (ch === "\n") {
      tokens.push({
        type: "op",
        value: ";",
        pos: map.posAt(i),
        end: map.posAt(i + 1),
      });
      atBoundary = true;
      i += 1;

      // Drain any heredocs queued since the previous newline, in order.
      while (heredocQueue.length > 0) {
        const hd = heredocQueue.shift();
        if (!hd) break;
        const bodyStart = i;
        let body = "";
        while (i < source.length) {
          let lineEnd = source.indexOf("\n", i);
          if (lineEnd === -1) lineEnd = source.length;
          let realLineEnd = lineEnd;
          if (
            realLineEnd > i &&
            source.charCodeAt(realLineEnd - 1) === 13 /* \r */
          ) {
            realLineEnd -= 1;
          }
          const line = source.slice(i, realLineEnd);
          const processedLine = hd.strip ? line.replace(/^\t+/, "") : line;
          i = lineEnd < source.length ? lineEnd + 1 : lineEnd;
          if (processedLine === hd.delimiter) break;
          body += `${processedLine}\n`;
        }
        tokens.push({
          type: "heredoc-body",
          content: body,
          pos: map.posAt(bodyStart),
          end: map.posAt(i),
        });
      }

      continue;
    }

    if (ch === "#" && atBoundary && testDepth === 0) {
      const startOffset = i;
      const start = i + 1;
      i += 1;
      while (i < source.length && source.charAt(i) !== "\n") {
        i += 1;
      }
      if (options.keepComments) {
        tokens.push({
          type: "comment",
          text: source.slice(start, i),
          pos: map.posAt(startOffset),
          end: map.posAt(i),
        });
      }
      continue;
    }

    if (ch === "!" && atBoundary) {
      const next = source.charAt(i + 1);
      // `!(` is extended glob — fall through to word parsing.
      // `!` is the negation operator only when followed by a separator
      // (space, tab, newline, EOF). Otherwise it's part of a word, e.g.
      // `!=` inside `[[ ... ]]` or `!foo` as a literal.
      const isNegation =
        next === "" ||
        next === " " ||
        next === "\t" ||
        next === "\n" ||
        next === "\r";
      if (next !== "(" && isNegation) {
        tokens.push({
          type: "op",
          value: "!",
          pos: map.posAt(i),
          end: map.posAt(i + 1),
        });
        atBoundary = true;
        i += 1;
        continue;
      }
    }

    if (ch === "{" && atBoundary && isNameStart(source.charAt(i + 1))) {
      let j = i + 2;
      while (j < source.length && isNameChar(source.charAt(j))) {
        j += 1;
      }
      if (source.charAt(j) === "}") {
        const redir = tryRedirOp(source, j + 1);
        if (redir) {
          checkLang(options.dialect, map.posAt(i), "`{varname}` redirects", [
            "bash",
            "zsh",
          ]);
          tokens.push({
            type: "redir",
            op: redir.op,
            fd: source.slice(i, j + 1),
            pos: map.posAt(i),
            end: map.posAt(j + 1 + redir.len),
          });
          i = j + 1 + redir.len;
          atBoundary = true;
          continue;
        }
      }
    }

    if (isDigit(ch)) {
      let j = i;
      while (j < source.length && isDigit(source.charAt(j))) {
        j += 1;
      }
      const redir = tryRedirOp(source, j);
      if (redir) {
        tokens.push({
          type: "redir",
          op: redir.op,
          fd: source.slice(i, j),
          pos: map.posAt(i),
          end: map.posAt(j + redir.len),
        });
        i = j + redir.len;
        atBoundary = true;
        continue;
      }
    }

    if (ch === "(" && source.charAt(i + 1) === "(" && atBoundary) {
      let j = i + 2;
      let depth = 0;
      while (j < source.length) {
        const c = source.charAt(j);
        if (c === ")" && source.charAt(j + 1) === ")" && depth === 0) break;
        if (c === "(") depth++;
        if (c === ")") depth--;
        j++;
      }
      tokens.push({
        type: "arith-cmd",
        expr: source.slice(i + 2, j),
        innerOffset: i + 2,
        pos: map.posAt(i),
        end: map.posAt(j + 2),
      });
      i = j + 2;
      atBoundary = true;
      continue;
    }

    if (
      (ch === "<" || ch === ">") &&
      source.charAt(i + 1) === "(" &&
      atBoundary
    ) {
      checkLang(options.dialect, map.posAt(i), "process substitution", [
        "bash",
        "mksh",
        "zsh",
      ]);
      const op = ch as "<" | ">";
      let j = i + 2;
      let depth = 1;
      while (j < source.length && depth > 0) {
        if (source.charAt(j) === "(") depth++;
        if (source.charAt(j) === ")") depth--;
        j++;
      }
      const raw = source.slice(i + 2, j - 1);
      const partPos = map.posAt(i);
      const partEnd = map.posAt(j);
      tokens.push({
        type: "word",
        parts: [
          {
            type: "proc-subst",
            op,
            raw,
            innerOffset: i + 2,
            pos: partPos,
            end: partEnd,
          },
        ],
        pos: partPos,
        end: partEnd,
      });
      i = j;
      atBoundary = false;
      continue;
    }

    {
      const redir = tryRedirOp(source, i);
      if (redir) {
        if (redir.op === "&>" || redir.op === "&>>" || redir.op === "<<<") {
          checkLang(options.dialect, map.posAt(i), redir.op, [
            "bash",
            "mksh",
            "zsh",
          ]);
        }
        tokens.push({
          type: "redir",
          op: redir.op,
          pos: map.posAt(i),
          end: map.posAt(i + redir.len),
        });
        i += redir.len;
        atBoundary = true;
        continue;
      }
    }

    if (symbolChars.has(ch)) {
      // `{` is only a block-start when at a boundary AND followed by a
      // separator (whitespace, `;`, newline, EOF). Otherwise it's part of
      // a word — for example a brace expansion like `{a,b}`. `}` is only a
      // symbol at a boundary; mid-word it's a literal char that scanning
      // continues through.
      if (ch === "{") {
        const next = source.charAt(i + 1);
        const isBlockOpen =
          atBoundary &&
          (next === "" ||
            next === " " ||
            next === "\t" ||
            next === "\n" ||
            next === "\r" ||
            next === ";");
        if (!isBlockOpen) {
          // Fall through to word parsing.
        } else {
          tokens.push({
            type: "symbol",
            value: "{",
            pos: map.posAt(i),
            end: map.posAt(i + 1),
          });
          atBoundary = true;
          i += 1;
          continue;
        }
      } else {
        tokens.push({
          type: "symbol",
          value: ch as SymbolTokenValue,
          pos: map.posAt(i),
          end: map.posAt(i + 1),
        });
        atBoundary = true;
        i += 1;
        continue;
      }
    }

    if (source.startsWith("&&", i)) {
      tokens.push({
        type: "op",
        value: "&&",
        pos: map.posAt(i),
        end: map.posAt(i + 2),
      });
      atBoundary = true;
      i += 2;
      continue;
    }

    if (source.startsWith("||", i)) {
      tokens.push({
        type: "op",
        value: "||",
        pos: map.posAt(i),
        end: map.posAt(i + 2),
      });
      atBoundary = true;
      i += 2;
      continue;
    }

    if (operatorChars.has(ch)) {
      tokens.push({
        type: "op",
        value: ch as ";" | "|" | "&",
        pos: map.posAt(i),
        end: map.posAt(i + 1),
      });
      atBoundary = true;
      i += 1;
      continue;
    }

    const wordStart = i;
    const parts: TokenWordPart[] = [];
    let current = "";
    let litStart = i;

    const flushLit = () => {
      if (current.length > 0) {
        parts.push({
          type: "lit",
          value: current,
          pos: map.posAt(litStart),
          end: map.posAt(i),
        });
        current = "";
      }
      litStart = i;
    };

    while (i < source.length) {
      const currentChar = source.charAt(i);

      if (currentChar === "\\" && source.charAt(i + 1) === "\n") {
        i += 2;
        if (current.length === 0) {
          litStart = i;
        }
        continue;
      }

      if (currentChar === "\\" && source.charAt(i + 1) === "\r") {
        if (source.charAt(i + 2) === "\n") {
          i += 3;
          if (current.length === 0) {
            litStart = i;
          }
          continue;
        }
      }

      if (currentChar === "\\" && i + 1 < source.length) {
        current += source.charAt(i + 1);
        i += 2;
        continue;
      }

      // Try to recognize an extended glob (`?(`, `*(`, `+(`, `@(`, `!(`)
      // before the break check, since `(` is otherwise a word terminator.
      if (
        (currentChar === "?" ||
          currentChar === "*" ||
          currentChar === "+" ||
          currentChar === "@" ||
          currentChar === "!") &&
        source.charAt(i + 1) === "("
      ) {
        const eg = scanExtGlob(source, i, map);
        if (eg) {
          checkLang(options.dialect, map.posAt(i), "extended globbing", [
            "bash",
            "mksh",
            "zsh",
          ]);
          flushLit();
          parts.push(eg.part);
          i = eg.end;
          litStart = i;
          continue;
        }
      }

      if (
        currentChar === " " ||
        currentChar === "\t" ||
        currentChar === "\r" ||
        currentChar === "\n" ||
        operatorChars.has(currentChar) ||
        redirChars.has(currentChar) ||
        currentChar === "(" ||
        currentChar === ")"
      ) {
        break;
      }
      // `{` and `}` are deliberately NOT word-terminators: mid-word braces
      // are part of the literal (a brace expansion candidate). Block
      // delimiters are detected at the outer loop based on context.

      if (currentChar === "'") {
        flushLit();
        const sglStart = i;
        i += 1;
        const start = i;
        while (i < source.length && source.charAt(i) !== "'") {
          i += 1;
        }
        if (i >= source.length) {
          throw new Error("Unclosed single quote");
        }
        parts.push({
          type: "sgl",
          value: source.slice(start, i),
          pos: map.posAt(sglStart),
          end: map.posAt(i + 1),
        });
        i += 1;
        litStart = i;
        continue;
      }

      if (currentChar === '"') {
        flushLit();
        const dblStart = i;
        i += 1;
        const dblParts: TokenWordPart[] = [];
        let dblBuf = "";
        let dblLitStart = i;
        const flushDblLit = () => {
          if (dblBuf.length > 0) {
            dblParts.push({
              type: "lit",
              value: dblBuf,
              pos: map.posAt(dblLitStart),
              end: map.posAt(i),
            });
            dblBuf = "";
          }
          dblLitStart = i;
        };
        let closed = false;
        while (i < source.length) {
          const dqChar = source.charAt(i);
          if (dqChar === "\\" && source.charAt(i + 1) === "\n") {
            i += 2;
            continue;
          }
          if (dqChar === "\\" && source.charAt(i + 1) === "\r") {
            if (source.charAt(i + 2) === "\n") {
              i += 3;
              continue;
            }
          }
          if (dqChar === "\\" && i + 1 < source.length) {
            dblBuf += dqChar + source.charAt(i + 1);
            i += 2;
            continue;
          }
          if (dqChar === "$") {
            flushDblLit();
            const exp = scanExpansion(source, i, map, options);
            if (exp) {
              dblParts.push(exp.part);
              i = exp.end;
              dblLitStart = i;
              continue;
            }
            dblBuf += dqChar;
            i += 1;
            continue;
          }
          if (dqChar === "`") {
            flushDblLit();
            const bt = scanBacktick(source, i, map);
            dblParts.push(bt.part);
            i = bt.end;
            dblLitStart = i;
            continue;
          }
          if (dqChar === '"') {
            i += 1;
            closed = true;
            break;
          }
          dblBuf += dqChar;
          i += 1;
        }
        if (!closed) {
          throw new Error("Unclosed double quote");
        }
        flushDblLit();
        parts.push({
          type: "dbl",
          parts: dblParts,
          pos: map.posAt(dblStart),
          end: map.posAt(i),
        });
        litStart = i;
        continue;
      }

      if (currentChar === "$") {
        const exp = scanExpansion(source, i, map, options);
        if (exp) {
          flushLit();
          parts.push(exp.part);
          i = exp.end;
          litStart = i;
          continue;
        }
        // Bare $ — treat as literal char.
        current += currentChar;
        i += 1;
        continue;
      }

      if (currentChar === "`") {
        flushLit();
        const bt = scanBacktick(source, i, map);
        parts.push(bt.part);
        i = bt.end;
        litStart = i;
        continue;
      }

      current += currentChar;
      i += 1;
    }

    flushLit();

    if (parts.length === 0) {
      throw new Error("Unexpected character");
    }

    const canStartTest = canStartTestClause();
    tokens.push({
      type: "word",
      parts,
      pos: map.posAt(wordStart),
      end: map.posAt(i),
    });

    if (supportsTestClause) {
      if (isTestOpenToken(parts) && canStartTest) {
        testDepth++;
      } else if (isTestCloseToken(parts) && testDepth > 0) {
        testDepth--;
      }
    }

    queueHeredocIfPending();
    atBoundary = false;
  }

  return tokens;
}
