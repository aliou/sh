import type { ParseOptions } from "../ast";
import { isDigit, operatorChars, redirChars, symbolChars } from "./charsets";
import { scanBacktick } from "./scan-backtick";
import { scanExpansion } from "./scan-expansion";
import { tryRedirOp } from "./scan-redir";
import type { SymbolTokenValue, Token, TokenWordPart } from "./types";
import { tokenPartsText } from "./utils";

export function tokenize(source: string, options: ParseOptions = {}): Token[] {
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
      tokens.push({ type: "op", value: ";" });
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
        let body = "";
        while (i < source.length) {
          let lineEnd = source.indexOf("\n", i);
          if (lineEnd === -1) lineEnd = source.length;
          const line = source.slice(i, lineEnd);
          const checkLine = hd.strip ? line.replace(/^\t+/, "") : line;
          i = lineEnd < source.length ? lineEnd + 1 : lineEnd;
          if (checkLine === hd.delimiter) break;
          const processedLine = hd.strip ? line.replace(/^\t+/, "") : line;
          body += `${processedLine}\n`;
        }
        tokens.push({ type: "heredoc-body", content: body });
      }

      continue;
    }

    if (ch === "#" && atBoundary) {
      const start = i + 1;
      i += 1;
      while (i < source.length && source.charAt(i) !== "\n") {
        i += 1;
      }
      if (options.keepComments) {
        tokens.push({ type: "comment", text: source.slice(start, i) });
      }
      continue;
    }

    if (ch === "!" && atBoundary) {
      tokens.push({ type: "op", value: "!" });
      atBoundary = true;
      i += 1;
      continue;
    }

    if (isDigit(ch)) {
      let j = i;
      while (j < source.length && isDigit(source.charAt(j))) {
        j += 1;
      }
      const redir = tryRedirOp(source, j);
      if (redir) {
        tokens.push({ type: "redir", op: redir.op, fd: source.slice(i, j) });
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
      tokens.push({ type: "arith-cmd", expr: source.slice(i + 2, j).trim() });
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
      tokens.push({
        type: "word",
        parts: [{ type: "proc-subst", op, raw }],
      });
      i = j;
      atBoundary = false;
      continue;
    }

    {
      const redir = tryRedirOp(source, i);
      if (redir) {
        tokens.push({ type: "redir", op: redir.op });
        i += redir.len;
        atBoundary = true;
        continue;
      }
    }

    if (symbolChars.has(ch)) {
      tokens.push({ type: "symbol", value: ch as SymbolTokenValue });
      atBoundary = true;
      i += 1;
      continue;
    }

    if (source.startsWith("&&", i)) {
      tokens.push({ type: "op", value: "&&" });
      atBoundary = true;
      i += 2;
      continue;
    }

    if (source.startsWith("||", i)) {
      tokens.push({ type: "op", value: "||" });
      atBoundary = true;
      i += 2;
      continue;
    }

    if (operatorChars.has(ch)) {
      tokens.push({ type: "op", value: ch as ";" | "|" | "&" });
      atBoundary = true;
      i += 1;
      continue;
    }

    const parts: TokenWordPart[] = [];
    let current = "";

    const flushLit = () => {
      if (current.length > 0) {
        parts.push({ type: "lit", value: current });
        current = "";
      }
    };

    while (i < source.length) {
      const currentChar = source.charAt(i);

      if (currentChar === "\\" && source.charAt(i + 1) === "\n") {
        i += 2;
        continue;
      }

      if (currentChar === "\\" && source.charAt(i + 1) === "\r") {
        if (source.charAt(i + 2) === "\n") {
          i += 3;
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
        symbolChars.has(currentChar)
      ) {
        break;
      }

      if (currentChar === "'") {
        flushLit();
        i += 1;
        const start = i;
        while (i < source.length && source.charAt(i) !== "'") {
          i += 1;
        }
        if (i >= source.length) {
          throw new Error("Unclosed single quote");
        }
        parts.push({ type: "sgl", value: source.slice(start, i) });
        i += 1;
        continue;
      }

      if (currentChar === '"') {
        flushLit();
        i += 1;
        const dblParts: TokenWordPart[] = [];
        let dblBuf = "";
        const flushDblLit = () => {
          if (dblBuf.length > 0) {
            dblParts.push({ type: "lit", value: dblBuf });
            dblBuf = "";
          }
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
            const exp = scanExpansion(source, i);
            if (exp) {
              dblParts.push(exp.part);
              i = exp.end;
              continue;
            }
            dblBuf += dqChar;
            i += 1;
            continue;
          }
          if (dqChar === "`") {
            flushDblLit();
            const bt = scanBacktick(source, i);
            dblParts.push(bt.part);
            i = bt.end;
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
        parts.push({ type: "dbl", parts: dblParts });
        continue;
      }

      if (currentChar === "$") {
        flushLit();
        const exp = scanExpansion(source, i);
        if (exp) {
          parts.push(exp.part);
          i = exp.end;
          continue;
        }
        current += currentChar;
        i += 1;
        continue;
      }

      if (currentChar === "`") {
        flushLit();
        const bt = scanBacktick(source, i);
        parts.push(bt.part);
        i = bt.end;
        continue;
      }

      current += currentChar;
      i += 1;
    }

    flushLit();

    if (parts.length === 0) {
      throw new Error("Unexpected character");
    }

    tokens.push({ type: "word", parts });
    atBoundary = false;
  }

  return tokens;
}
