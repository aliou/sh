import type { CaseClause, CaseItem, Statement, Word } from "../ast";
import { isZsh } from "../dialect";
import { parseStatement } from "./commands";
import {
  allowNestedTrailingRedirects,
  parseTrailingRedirects,
} from "./redirects";
import type { ParserState } from "./state";
import { wordFromToken } from "./words";

export function parseCaseClause(s: ParserState): CaseClause {
  const head = s.consumeKeyword("case");
  const wordToken = s.consume();
  if (wordToken.type !== "word") {
    throw new Error("Expected case word");
  }
  const word = wordFromToken(wordToken, s.options);
  s.consumeKeyword("in");
  const items: CaseItem[] = [];
  s.skipSeparators({ semicolon: isZsh(s.options.dialect) });
  while (!s.matchKeyword("esac")) {
    const itemStart = s.peek()?.pos ?? head.pos;
    const patterns: Word[] = [];
    while (!s.matchSymbol(")")) {
      if (s.matchWord()) {
        const patternToken = s.consume();
        if (patternToken.type !== "word") {
          throw new Error("Expected case pattern");
        }
        patterns.push(wordFromToken(patternToken, s.options));
        continue;
      }
      if (s.matchOp("|")) {
        s.consume();
        continue;
      }
      throw new Error("Expected case pattern or )");
    }
    s.consumeSymbol(")");
    const body = parseCaseItemBody(s);
    const itemEnd = s.lastEnd() ?? itemStart;
    items.push({
      type: "CaseItem",
      patterns,
      body,
      pos: itemStart,
      end: itemEnd,
    });
    if (isCaseItemEnd(s)) {
      s.consume();
      s.consume();
    }
    s.skipSeparators({ semicolon: isZsh(s.options.dialect) });
  }
  const esac = s.consumeKeyword("esac");
  const node: CaseClause = {
    type: "CaseClause",
    word,
    items,
    pos: head.pos,
    end: esac.end,
  };
  parseTrailingRedirects(s, node);
  return node;
}

function parseCaseItemBody(s: ParserState): Statement[] {
  return allowNestedTrailingRedirects(s, () => {
    const body: Statement[] = [];
    s.skipSeparators({
      semicolon: isZsh(s.options.dialect) ? "single" : false,
    });
    while (!s.matchKeyword("esac") && !isCaseItemEnd(s)) {
      body.push(parseStatement(s));
      if (isCaseItemEnd(s)) {
        break;
      }
      skipCaseStatementSeparators(s);
    }
    return body;
  });
}

function skipCaseStatementSeparators(s: ParserState): void {
  if (isZsh(s.options.dialect)) {
    s.skipSeparators({ semicolon: "single" });
    return;
  }
  if (s.matchOp(";") && !isCaseItemEnd(s)) {
    s.consume();
  }
  s.skipSeparators();
}

export function isCaseItemEnd(s: ParserState): boolean {
  if (!s.matchOp(";") || !s.peekOp(";")) return false;
  if (isZsh(s.options.dialect)) return true;
  const tok = s.peek();
  const next = s.peekToken(1);
  return (
    tok?.type === "op" &&
    next?.type === "op" &&
    next.pos.offset === tok.end.offset
  );
}
