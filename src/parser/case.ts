import type { CaseClause, CaseItem, Statement, Word } from "../ast";
import { parseStatement } from "./commands";
import {
  allowNestedTrailingRedirects,
  parseTrailingRedirects,
} from "./redirects";
import type { ParserState } from "./state";
import { wordFromToken } from "./words";

/** Parse a `case ... esac` clause. */
export function parseCaseClause(s: ParserState): CaseClause {
  const head = s.consumeKeyword("case");
  const wordToken = s.consume();
  if (wordToken.type !== "word") {
    throw new Error("Expected case word");
  }
  const word = wordFromToken(wordToken);
  s.consumeKeyword("in");
  const items: CaseItem[] = [];
  s.skipSeparators();
  while (!s.matchKeyword("esac")) {
    const itemStart = s.peek()?.pos ?? head.pos;
    const patterns: Word[] = [];
    while (!s.matchSymbol(")")) {
      if (s.matchWord()) {
        const patternToken = s.consume();
        if (patternToken.type !== "word") {
          throw new Error("Expected case pattern");
        }
        patterns.push(wordFromToken(patternToken));
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
    if (s.matchOp(";") && s.peekOp(";")) {
      s.consume();
      s.consume();
    }
    s.skipSeparators();
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

/** Parse the body of one case item, up to its `;;` terminator or `esac`. */
function parseCaseItemBody(s: ParserState): Statement[] {
  return allowNestedTrailingRedirects(s, () => {
    const body: Statement[] = [];
    // Inside a case item body a single `;` separates statements, but `;;`
    // is the item terminator, so only "single" semicolons are skipped.
    s.skipSeparators({ semicolon: "single" });
    while (!s.matchKeyword("esac") && !isCaseItemEnd(s)) {
      body.push(parseStatement(s));
      if (isCaseItemEnd(s)) {
        break;
      }
      s.skipSeparators({ semicolon: "single" });
    }
    return body;
  });
}

/** Whether the cursor sits on a `;;` case-item terminator. */
export function isCaseItemEnd(s: ParserState): boolean {
  return s.matchOp(";") && s.peekOp(";");
}
