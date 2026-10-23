import type { BinaryTestOp, TestClause, TestExpr, UnaryTestOp } from "../ast";
import { checkLang } from "../dialect";
import { tokenPartsText } from "../tokenizer";
import { parseTrailingRedirects } from "./redirects";
import { type ParserState, ZERO_POS } from "./state";
import { wordFromToken } from "./words";

const TEST_UNARY_OPS = new Set<string>([
  "-e",
  "-f",
  "-d",
  "-r",
  "-w",
  "-x",
  "-z",
  "-n",
  "-s",
  "-a",
  "-o",
  "-S",
  "-c",
  "-b",
  "-p",
  "-h",
  "-L",
  "-N",
  "-O",
  "-G",
  "-u",
  "-g",
  "-k",
  "-t",
  "-v",
  "-R",
]);

const TEST_BINARY_OPS = new Set<string>([
  "==",
  "!=",
  "<",
  "<=",
  ">",
  ">=",
  "=~",
  "=",
  "-ef",
  "-nt",
  "-ot",
]);

/** Parse an extended test clause `[[ ... ]]`. */
export function parseTestClause(s: ParserState): TestClause {
  const open = s.consumeKeyword("[[");
  checkLang(s.options.dialect, open.pos, "[[", ["bash", "mksh", "zsh"]);
  const x = parseTestExpr(s, 0);
  const close = s.consumeKeyword("]]");
  const node: TestClause = {
    type: "TestClause",
    x,
    pos: open.pos,
    end: close.end,
  };
  parseTrailingRedirects(s, node);
  return node;
}

function parseTestExpr(s: ParserState, minPrec: number): TestExpr {
  let left = parseTestPrimary(s);
  while (true) {
    const op = peekTestBinaryOp(s);
    if (!op) break;
    const prec = op === "||" ? 1 : op === "&&" ? 2 : 3;
    if (prec < minPrec) break;
    consumeTestOp(s, op);
    const right = parseTestExpr(s, prec + 1);
    left = {
      type: "BinaryTest",
      op,
      x: left,
      y: right,
      pos: left.pos ?? ZERO_POS,
      end: right.end ?? ZERO_POS,
    };
  }
  return left;
}

function parseTestPrimary(s: ParserState): TestExpr {
  // Negation
  if (s.matchOp("!")) {
    const op = s.consume();
    const x = parseTestPrimary(s);
    return {
      type: "UnaryTest",
      op: "!",
      x,
      pos: op.pos,
      end: x.end ?? op.end,
    };
  }
  // Parenthesized
  if (s.matchSymbol("(")) {
    const open = s.consumeSymbol("(");
    const x = parseTestExpr(s, 0);
    const close = s.consumeSymbol(")");
    return { type: "ParenTest", x, pos: open.pos, end: close.end };
  }
  // Unary file/string ops: a single token like `-e`/`-z`/...
  const head = s.peek();
  if (head && head.type === "word") {
    const text = tokenPartsText(head.parts);
    if (TEST_UNARY_OPS.has(text)) {
      s.consume();
      const arg = parseTestPrimary(s);
      return {
        type: "UnaryTest",
        op: text as UnaryTestOp,
        x: arg,
        pos: head.pos,
        end: arg.end ?? head.end,
      };
    }
  }
  // Otherwise a Word leaf (possibly followed by a binary op).
  if (s.matchWord()) {
    const tok = s.consume();
    if (tok.type !== "word") throw new Error("expected word in [[ ]]");
    return wordFromToken(tok);
  }
  throw new Error("Expected expression inside [[ ]]");
}

function peekTestBinaryOp(s: ParserState): BinaryTestOp | undefined {
  const tok = s.peek();
  if (!tok) return undefined;
  if (tok.type === "op" && (tok.value === "&&" || tok.value === "||")) {
    return tok.value;
  }
  if (tok.type === "word") {
    const text = tokenPartsText(tok.parts);
    if (TEST_BINARY_OPS.has(text)) return text as BinaryTestOp;
  }
  return undefined;
}

function consumeTestOp(s: ParserState, op: BinaryTestOp): void {
  const tok = s.consume();
  if (tok.type === "op" && tok.value === op) return;
  if (tok.type === "word" && tokenPartsText(tok.parts) === op) return;
  throw new Error(`expected test op ${op}`);
}
