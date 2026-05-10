import type { ParseOptions } from "../ast";
import { isDigit, operatorChars, redirChars, symbolChars } from "./charsets";
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

      // Check for pending heredocs by scanning recent tokens
      const pendingHeredocs: { strip: boolean; delimiter: string }[] = [];
      for (let ti = 0; ti < tokens.length; ti++) {
        const t = tokens[ti];
        if (
          t &&
          t.type === "redir" &&
          (t.op === "<<" || t.op === "<<-") &&
          !Object.hasOwn(t, "_collected")
        ) {
          const delimTok = tokens[ti + 1];
          if (delimTok && delimTok.type === "word") {
            pendingHeredocs.push({
              strip: t.op === "<<-",
              delimiter: tokenPartsText(delimTok.parts),
            });
            (t as Record<string, unknown>)._collected = true;
          }
        }
      }

      // Collect heredoc bodies
      for (const hd of pendingHeredocs) {
        const bodyStart = i;
        let body = "";
        while (i < source.length) {
          let lineEnd = source.indexOf("\n", i);
          if (lineEnd === -1) lineEnd = source.length;
          // Strip an optional trailing CR for CRLF inputs.
          let realLineEnd = lineEnd;
          if (
            realLineEnd > i &&
            source.charCodeAt(realLineEnd - 1) === 13 /* \r */
          ) {
            realLineEnd -= 1;
          }
          const line = source.slice(i, realLineEnd);
          const checkLine = hd.strip ? line.replace(/^\t+/, "") : line;
          i = lineEnd < source.length ? lineEnd + 1 : lineEnd;
          if (checkLine === hd.delimiter) break;
          const processedLine = hd.strip ? line.replace(/^\t+/, "") : line;
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

    if (ch === "#" && atBoundary) {
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
      // Prefer the extended-glob form `!(...)` over the negation operator,
      // matching Bash where `!` only negates a command when it's a standalone
      // word.
      if (source.charAt(i + 1) !== "(") {
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
        expr: source.slice(i + 2, j).trim(),
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
        litStart = i;
        continue;
      }

      if (currentChar === "\\" && source.charAt(i + 1) === "\r") {
        if (source.charAt(i + 2) === "\n") {
          i += 3;
          litStart = i;
          continue;
        }
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
            const exp = scanExpansion(source, i, map);
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
        const exp = scanExpansion(source, i, map);
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

    tokens.push({
      type: "word",
      parts,
      pos: map.posAt(wordStart),
      end: map.posAt(i),
    });
    atBoundary = false;
  }

  return tokens;
}
