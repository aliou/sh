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
import { findAnsiCEnd, heredocDelimiter } from "./utils";

export function tokenize(source: string, options: ParseOptions = {}): Token[] {
  const map = new SourceMap(source);
  const tokens: Token[] = [];
  let i = 0;
  let atBoundary = true;
  // Heredocs whose delimiter has been seen but body hasn't been collected yet,
  // in order. Drained on each newline. Replaces an earlier O(n²) per-newline
  // scan over all tokens.
  const heredocQueue: {
    strip: boolean;
    delimiter: string;
    quoted: boolean;
  }[] = [];

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
  // for the next newline. The delimiter is derived from the word's ORIGINAL
  // SOURCE SPAN with quote removal only, so expansion-looking text (`$x`,
  // `$(...)`, backticks) is preserved literally.
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
      const { delimiter, quoted } = heredocDelimiter(
        source.slice(last.pos.offset, last.end.offset),
      );
      heredocQueue.push({ strip: prev.op === "<<-", delimiter, quoted });
    }
  };

  while (i < source.length) {
    const ch = source.charAt(i);

    if (ch === " " || ch === "\t") {
      atBoundary = true;
      i += 1;
      continue;
    }

    // `\r` is an ordinary character (bash semantics), not whitespace and not
    // a word terminator. Only backslash-LF folds; backslash-CRLF does not.
    if (ch === "\\" && source.charAt(i + 1) === "\n") {
      atBoundary = true;
      i += 2;
      continue;
    }

    if (ch === "\n") {
      tokens.push({
        type: "op",
        value: ";",
        newline: true,
        pos: map.posAt(i),
        end: map.posAt(i + 1),
      });
      atBoundary = true;
      i += 1;

      // Drain any heredocs queued since the previous newline, in order.
      // Track the newline terminating the last delimiter line we consume:
      // that newline also terminates the command line, so it must be
      // re-emitted as a separator after the heredoc bodies. Otherwise the
      // next word would merge into the heredoc-opening command.
      let delimiterNewline = -1;
      while (heredocQueue.length > 0) {
        const hd = heredocQueue.shift();
        if (!hd) break;
        const bodyStart = i;
        let body = "";
        // Physical lines accumulated under backslash-newline folding
        // (unquoted delimiters only). CR bytes stay verbatim in lines.
        let pending = "";
        let terminated = false;
        delimiterNewline = -1;
        while (i < source.length) {
          let lineEnd = source.indexOf("\n", i);
          if (lineEnd === -1) lineEnd = source.length;
          const hasNewline = lineEnd < source.length;
          let line = source.slice(i, lineEnd);
          i = hasNewline ? lineEnd + 1 : lineEnd;
          if (hd.strip) line = line.replace(/^\t+/, "");
          const logical = pending + line;
          // Fold only an ODD trailing backslash run: a single trailing `\`
          // before LF is a line continuation, while `\\` before LF is an
          // escaped backslash followed by LF and terminates the line.
          let trailingBackslashes = 0;
          while (
            logical.charCodeAt(logical.length - 1 - trailingBackslashes) === 92
          ) {
            trailingBackslashes += 1;
          }
          if (!hd.quoted && hasNewline && trailingBackslashes % 2 === 1) {
            pending = logical.slice(0, -1);
            continue;
          }
          pending = "";
          if (logical === hd.delimiter) {
            terminated = true;
            if (hasNewline) delimiterNewline = lineEnd;
            break;
          }
          body += `${logical}\n`;
        }
        if (!terminated) {
          throw new Error(`Unclosed heredoc "${hd.delimiter}"`);
        }
        tokens.push({
          type: "heredoc-body",
          content: body,
          expand: !hd.quoted,
          delimiter: hd.delimiter,
          quoted: hd.quoted,
          pos: map.posAt(bodyStart),
          end: map.posAt(i),
        });
      }

      if (delimiterNewline >= 0) {
        tokens.push({
          type: "op",
          value: ";",
          newline: true,
          pos: map.posAt(delimiterNewline),
          end: map.posAt(delimiterNewline + 1),
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
        next === "" || next === " " || next === "\t" || next === "\n";
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

    // `{varname}` file descriptor redirects, e.g. `foo {fd}<file`. Only a
    // valid name wrapped in braces and immediately followed by a redirect
    // operator counts; anything else falls through to word parsing.
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

      // Backslash escape in a bare word: decode to the escaped character and
      // emit it as its own part so provenance (escaped vs plain) survives.
      if (currentChar === "\\" && i + 1 < source.length) {
        flushLit();
        parts.push({
          type: "lit",
          value: source.charAt(i + 1),
          pos: map.posAt(i),
          end: map.posAt(i + 2),
          escaped: true,
        });
        i += 2;
        litStart = i;
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
        const dbl = scanDoubleQuoted(source, i + 1, map, options);
        parts.push({
          type: "dbl",
          parts: dbl.parts,
          pos: map.posAt(dblStart),
          end: map.posAt(dbl.end),
        });
        i = dbl.end;
        litStart = i;
        continue;
      }

      if (currentChar === "$" && source.charAt(i + 1) === "'") {
        flushLit();
        const ansiStart = i;
        const close = findAnsiCEnd(source, i + 2);
        if (close === -1) {
          throw new Error("Unclosed ANSI-C quote");
        }
        parts.push({
          type: "ansi-c",
          value: source.slice(i + 2, close),
          raw: source.slice(i, close + 1),
          pos: map.posAt(ansiStart),
          end: map.posAt(close + 1),
        });
        i = close + 1;
        litStart = i;
        continue;
      }

      if (currentChar === "$" && source.charAt(i + 1) === '"') {
        flushLit();
        const locStart = i;
        const loc = scanDoubleQuoted(source, i + 2, map, options);
        parts.push({
          type: "locale-str",
          parts: loc.parts,
          pos: map.posAt(locStart),
          end: map.posAt(loc.end),
        });
        i = loc.end;
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

  // A `<<`/`<<-` delimiter line never followed by a body newline means the
  // heredoc body is empty and the terminator never appears.
  const pendingHeredoc = heredocQueue[0];
  if (pendingHeredoc) {
    throw new Error(`Unclosed heredoc "${pendingHeredoc.delimiter}"`);
  }

  return tokens;
}

/**
 * Scan a double-quoted region starting just past the opening `"` (at `from`)
 * and ending just past the closing `"`. Shared by `"..."` word parts and
 * `$"..."` locale strings, which use the same inner grammar: backslash-LF
 * folds (backslash-CRLF does NOT), `$` expansions and backticks are scanned,
 * every other character stays literal.
 */
function scanDoubleQuoted(
  source: string,
  from: number,
  map: SourceMap,
  options: ParseOptions,
): { parts: TokenWordPart[]; end: number } {
  const parts: TokenWordPart[] = [];
  let buf = "";
  let litStart = from;
  let i = from;
  const flushLit = () => {
    if (buf.length > 0) {
      parts.push({
        type: "lit",
        value: buf,
        pos: map.posAt(litStart),
        end: map.posAt(i),
      });
      buf = "";
    }
    litStart = i;
  };
  while (i < source.length) {
    const ch = source.charAt(i);
    if (ch === "\\" && source.charAt(i + 1) === "\n") {
      i += 2;
      continue;
    }
    if (ch === "\\" && i + 1 < source.length) {
      buf += ch + source.charAt(i + 1);
      i += 2;
      continue;
    }
    if (ch === "$") {
      flushLit();
      const exp = scanExpansion(source, i, map, options);
      if (exp) {
        parts.push(exp.part);
        i = exp.end;
        litStart = i;
        continue;
      }
      buf += ch;
      i += 1;
      continue;
    }
    if (ch === "`") {
      flushLit();
      const bt = scanBacktick(source, i, map);
      parts.push(bt.part);
      i = bt.end;
      litStart = i;
      continue;
    }
    if (ch === '"') {
      i += 1;
      flushLit();
      return { parts, end: i };
    }
    buf += ch;
    i += 1;
  }
  throw new Error("Unclosed double quote");
}
