import type {
  ArithCmd,
  ArrayElem,
  Assignment,
  Command,
  CoprocClause,
  FunctionDecl,
  Pos,
  Redirect,
  SimpleCommand,
  Statement,
  TimeClause,
  Word,
} from "../ast";
import { checkLang, isZsh } from "../dialect";
import type { Token } from "../tokenizer";
import { tokenPartsText } from "../tokenizer";
import { parseArithmetic } from "./arith-parser";
import { isCaseItemEnd, parseCaseClause } from "./case";
import {
  parseBlock,
  parseIfClause,
  parseSubshell,
  parseWhileClause,
} from "./clauses";
import { matchDeclKeyword, parseDeclClause, parseLetClause } from "./decl-let";
import { parseForOrCStyleLoop, parseSelectClause } from "./iterators";
import {
  parseRedirect,
  parseTrailingRedirects,
  withSuppressedTrailingRedirects,
} from "./redirects";
import { type ParserState, PositionedError, ZERO_POS } from "./state";
import { parseTestClause } from "./test-clause";
import { wordFromToken } from "./words";

/** Wrap a command node in a Statement. */
export function wrapStatement(command: Command): Statement {
  return {
    type: "Statement",
    command,
    pos: command.pos ?? ZERO_POS,
    end: command.end ?? ZERO_POS,
  };
}

/** Parse one statement: optional `!` negation, a pipeline chain, and an
 * optional `&` background marker. */
export function parseStatement(s: ParserState): Statement {
  const startTok = s.peek();
  const startPos = startTok?.pos ?? ZERO_POS;
  let negated = false;
  if (s.matchOp("!")) {
    s.consume();
    // Newlines and comments may follow the negation (`! # c\nfoo`),
    // matching bash.
    s.skipSeparators();
    negated = true;
  }
  const command = parseLogical(s);
  let background = false;
  if (s.matchOp("&")) {
    s.consume();
    background = true;
    if (s.matchOp(";") && !isCaseItemEnd(s) && !isZsh(s.options.dialect)) {
      // bash rejects `foo & ; bar`: only newlines may follow `&`. The
      // first `;` of a `;;` case terminator is fine (`foo & ;; esac`).
      throw new Error("`&` cannot be followed by `;`");
    }
  }
  const endPos = s.lastEnd() ?? startPos;
  const statement: Statement = {
    type: "Statement",
    command,
    pos: startPos,
    end: endPos,
  };
  if (background) {
    statement.background = true;
  }
  if (negated) {
    statement.negated = true;
  }
  return statement;
}

/** Parse `&&` / `||` chains of pipelines. */
export function parseLogical(s: ParserState): Command {
  let leftCommand = parsePipeline(s);
  while (s.matchOp("&&") || s.matchOp("||")) {
    const opToken = s.consume();
    if (opToken.type !== "op") {
      throw new Error("Expected logical operator");
    }
    const rightCommand = parseContinuationCommand(s, opToken, () =>
      parsePipeline(s),
    );
    const left = wrapStatement(leftCommand);
    const right = wrapStatement(rightCommand);
    leftCommand = {
      type: "Logical",
      op: opToken.value === "&&" ? "and" : "or",
      left,
      right,
      pos: left.pos ?? ZERO_POS,
      end: right.end ?? ZERO_POS,
    };
  }
  return leftCommand;
}

/** Parse `|` chains of command atoms. */
export function parsePipeline(s: ParserState): Command {
  const first = parseCommandAtom(s);
  if (!s.matchOp("|")) {
    return first;
  }
  const firstStmt = wrapStatement(first);
  const commands: Statement[] = [firstStmt];
  while (s.matchOp("|")) {
    const opToken = s.consume();
    if (opToken.type !== "op") {
      throw new Error("Expected pipe operator");
    }
    const next = parseContinuationCommand(s, opToken, () =>
      parseCommandAtom(s),
    );
    commands.push(wrapStatement(next));
  }
  const last = commands[commands.length - 1];
  return {
    type: "Pipeline",
    commands,
    pos: firstStmt.pos ?? ZERO_POS,
    end: last?.end ?? firstStmt.end ?? ZERO_POS,
  };
}

/**
 * Parse the statement that must follow a binary operator (`&&`, `||`,
 * `|`), and anchor its failure at the operator.
 *
 * When the continuation cannot produce any statement at all — EOF, a
 * comment or newline skipped after the operator, or a non-statement
 * token such as a literal `;` blocking it — the deep "Expected a command
 * word" is replaced by `` `&&` must be followed by a statement ``
 * positioned at the operator, matching mvdan/sh. Failures after the
 * continuation has started (a partially-parsed statement) are re-thrown
 * unchanged, so deeper errors keep their own messages and positions.
 * See aliou/sh#25.
 */
function parseContinuationCommand(
  s: ParserState,
  opToken: Token & { type: "op" },
  parse: () => Command,
): Command {
  // Comments and newlines are legal here (`cmd && # note\nnext`); a
  // literal `;` is not (`cmd && ; next` stays an error).
  s.skipSeparators({ semicolon: false });
  const afterSkip = s.index;
  try {
    return parse();
  } catch (e) {
    if (e instanceof Error && s.index === afterSkip) {
      // Zero tokens consumed: the operator is missing its right-hand
      // side, so the failure is the operator's, not the statement's.
      throw new PositionedError(
        `\`${opToken.value}\` must be followed by a statement`,
        opToken.pos,
      );
    }
    throw e;
  }
}

/** Dispatch on the first token to the right command production. */
export function parseCommandAtom(s: ParserState): Command {
  if (s.matchKeyword("if")) {
    return parseIfClause(s);
  }
  if (s.matchKeyword("while")) {
    return parseWhileClause(s, false);
  }
  if (s.matchKeyword("until")) {
    return parseWhileClause(s, true);
  }
  if (s.matchKeyword("for")) {
    return parseForOrCStyleLoop(s);
  }
  if (s.matchKeyword("select")) {
    return parseSelectClause(s);
  }
  if (s.matchKeyword("case")) {
    return parseCaseClause(s);
  }
  if (s.matchKeyword("time")) {
    return parseTimeClause(s);
  }
  if (s.matchKeyword("coproc")) {
    return parseCoprocClause(s);
  }
  if (s.matchKeyword("[[")) {
    return parseTestClause(s);
  }
  if (s.matchKeyword("function") || looksLikeFuncDecl(s)) {
    return parseFunctionDecl(s);
  }
  if (s.peek()?.type === "arith-cmd") {
    return consumeArithCmd(s);
  }
  if (s.matchSymbol("(")) {
    return parseSubshell(s);
  }
  if (s.matchSymbol("{")) {
    return parseBlock(s);
  }
  if (matchDeclKeyword(s)) {
    return parseDeclClause(s);
  }
  if (s.matchKeyword("let")) {
    return parseLetClause(s);
  }
  return parseSimpleCommand(s);
}

/** Parse an arithmetic command `(( ... ))`. */
function consumeArithCmd(s: ParserState): ArithCmd {
  const token = s.consume();
  if (token.type !== "arith-cmd")
    throw new Error("Expected arithmetic command");
  checkLang(s.options.dialect, token.pos, "(( ))", ["bash", "mksh", "zsh"]);
  const x = parseArithmetic(token.expr, {
    offset: token.innerOffset,
    line: token.pos.line,
    col: token.pos.col + 2,
  });
  const cmd: ArithCmd = {
    type: "ArithCmd",
    pos: token.pos,
    end: token.end,
  };
  if (x) cmd.x = x;
  return cmd;
}

/** Parse a `time` clause. */
function parseTimeClause(s: ParserState): TimeClause {
  const head = s.consumeKeyword("time");
  const command = parseStatement(s);
  return {
    type: "TimeClause",
    command,
    pos: head.pos,
    end: command.end ?? head.end,
  };
}

/** Parse a `coproc` clause, with or without an explicit name. */
function parseCoprocClause(s: ParserState): CoprocClause {
  const head = s.consumeKeyword("coproc");
  checkLang(s.options.dialect, head.pos, "coproc", ["bash", "zsh"]);
  if (s.matchWord() && s.peekToken(1)?.type === "symbol") {
    const nameToken = s.peek();
    if (
      nameToken?.type === "word" &&
      s.peekToken(1)?.type === "symbol" &&
      (s.peekToken(1) as { value: string }).value === "{"
    ) {
      const name = tokenPartsText(nameToken.parts);
      s.consume();
      const body = withSuppressedTrailingRedirects(s, () => parseStatement(s));
      const node: CoprocClause = {
        type: "CoprocClause",
        name,
        body,
        pos: head.pos,
        end: body.end ?? head.end,
      };
      parseTrailingRedirects(s, node);
      return node;
    }
  }
  const body = withSuppressedTrailingRedirects(s, () => parseStatement(s));
  const node: CoprocClause = {
    type: "CoprocClause",
    body,
    pos: head.pos,
    end: body.end ?? head.end,
  };
  parseTrailingRedirects(s, node);
  return node;
}

/**
 * Whether the cursor is on a function declaration in the `name() { ... }`
 * form. Comments and newlines may sit between the `()` and the body block
 * (`x() # c\n{ ... }`); anything else means this is not a declaration.
 */
function looksLikeFuncDecl(s: ParserState): boolean {
  const name = s.peek();
  const next = s.peekToken(1);
  const nextNext = s.peekToken(2);
  if (
    name?.type !== "word" ||
    next?.type !== "symbol" ||
    next.value !== "(" ||
    nextNext?.type !== "symbol" ||
    nextNext.value !== ")"
  ) {
    return false;
  }
  for (let i = 3; ; i++) {
    const tok = s.peekToken(i);
    if (!tok) return false;
    if (tok.type === "comment" || tok.type === "newline") continue;
    return tok.type === "symbol" && tok.value === "{";
  }
}

/** Parse a function declaration (both `function name` and `name()` forms). */
function parseFunctionDecl(s: ParserState): FunctionDecl {
  let startPos: Pos | undefined;
  if (s.matchKeyword("function")) {
    const fk = s.consumeKeyword("function");
    checkLang(s.options.dialect, fk.pos, "function", ["bash", "mksh", "zsh"]);
    startPos = fk.pos;
  }
  const nameToken = s.consume();
  if (nameToken.type !== "word") {
    throw new Error("Expected function name");
  }
  if (!startPos) startPos = nameToken.pos;
  const name = tokenPartsText(nameToken.parts);
  if (s.matchSymbol("(")) {
    s.consumeSymbol("(");
    s.consumeSymbol(")");
  }
  // Comments and newlines may precede the body block (`x() # c\n{ ... }`).
  s.skipSeparators();
  if (s.matchSymbol("{")) {
    // Redirects after the body block belong to the FunctionDecl, not the
    // (inlined) Block, so capture them here.
    const block = withSuppressedTrailingRedirects(s, () => parseBlock(s));
    const node: FunctionDecl = {
      type: "FunctionDecl",
      name,
      body: block.body,
      pos: startPos,
      end: block.end ?? startPos,
    };
    parseTrailingRedirects(s, node);
    return node;
  }
  throw new Error("Expected function body block");
}

/** Parse a simple command: words, assignments, and redirects. */
export function parseSimpleCommand(s: ParserState): SimpleCommand {
  const startPos = s.peek()?.pos ?? ZERO_POS;
  const words: Word[] = [];
  const assignments: Assignment[] = [];
  const redirects: Redirect[] = [];
  let sawWord = false;

  while (true) {
    if (s.matchWord()) {
      const token = s.peek();
      if (token?.type !== "word") {
        throw new Error("Expected word token");
      }

      if (!sawWord) {
        const assignment = tryParseAssignment(s, token);
        if (assignment) {
          assignments.push(assignment);
          continue;
        }
      }

      s.consume();
      sawWord = true;
      words.push(wordFromToken(token, s.options));
      continue;
    }

    if (s.matchRedir()) {
      redirects.push(parseRedirect(s));
      continue;
    }

    break;
  }

  if (
    words.length === 0 &&
    assignments.length === 0 &&
    redirects.length === 0
  ) {
    throw new Error("Expected a command word");
  }

  const endPos = s.lastEnd() ?? startPos;
  const command: SimpleCommand = {
    type: "SimpleCommand",
    pos: startPos,
    end: endPos,
  };
  if (words.length > 0) {
    command.words = words;
  }
  if (assignments.length > 0) {
    command.assignments = assignments;
  }
  if (redirects.length > 0) {
    command.redirects = redirects;
  }
  return command;
}

/**
 * Try to parse an assignment from a word token.
 * Consumes tokens itself if it matches; returns undefined otherwise.
 */
export function tryParseAssignment(
  s: ParserState,
  token: Token & { type: "word" },
): Assignment | undefined {
  const parts = token.parts;
  if (parts.length !== 1) return undefined;
  const part = parts[0];
  if (part?.type !== "lit") return undefined;
  const raw = part.value;

  let append = false;
  let eqIndex = raw.indexOf("+=");
  if (eqIndex > 0) {
    append = true;
  } else {
    eqIndex = raw.indexOf("=");
  }
  if (eqIndex <= 0) return undefined;

  const name = raw.slice(0, eqIndex);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return undefined;

  const afterEq = raw.slice(eqIndex + (append ? 2 : 1));

  const nextToken = s.peekToken(1);
  if (
    afterEq === "" &&
    nextToken?.type === "symbol" &&
    (nextToken as { value: string }).value === "("
  ) {
    checkLang(s.options.dialect, token.pos, "array assignment", [
      "bash",
      "mksh",
      "zsh",
    ]);
    s.consume(); // consume the NAME= word
    return parseArrayAssignment(s, name, append, token.pos);
  }

  if (append) {
    checkLang(s.options.dialect, token.pos, "+=", ["bash", "mksh", "zsh"]);
  }

  s.consume();

  const assignment: Assignment = {
    type: "Assignment",
    name,
    pos: token.pos,
    end: token.end,
  };
  if (append) assignment.append = true;
  if (afterEq.length > 0) {
    assignment.value = {
      type: "Word",
      parts: [{ type: "Literal", value: afterEq }],
    };
  }
  return assignment;
}

/** Parse an array assignment value `name=( elem ... )`. */
function parseArrayAssignment(
  s: ParserState,
  name: string,
  append: boolean,
  startPos: Pos,
): Assignment {
  const open = s.consumeSymbol("(");
  const elems: ArrayElem[] = [];

  while (!s.matchSymbol(")")) {
    if (s.isEof()) {
      throw new Error("Unclosed array expression");
    }
    // Newlines and comments may separate array elements; a literal `;`
    // is not a separator inside an array (bash rejects `a=(1;2)`), but
    // zsh tolerates it.
    if (s.matchOp(";") && isZsh(s.options.dialect)) {
      s.consume();
      continue;
    }
    if (s.matchNewline()) {
      s.consume();
      continue;
    }
    if (s.matchComment()) {
      s.consumeComment();
      continue;
    }

    const token = s.consume();
    if (token.type !== "word") {
      throw new Error("Expected word in array expression");
    }

    const text = tokenPartsText(token.parts);

    // Check for [index]=value pattern
    const indexMatch = text.match(/^\[([^\]]+)\]=(.*)$/);
    if (indexMatch) {
      const indexStr = indexMatch[1] as string;
      const valStr = indexMatch[2] as string;
      const elem: ArrayElem = {
        type: "ArrayElem",
        index: {
          type: "Word",
          parts: [{ type: "Literal", value: indexStr }],
        },
        pos: token.pos,
        end: token.end,
      };
      if (valStr.length > 0) {
        elem.value = {
          type: "Word",
          parts: [{ type: "Literal", value: valStr }],
        };
      }
      elems.push(elem);
    } else {
      elems.push({
        type: "ArrayElem",
        value: wordFromToken(token, s.options),
        pos: token.pos,
        end: token.end,
      });
    }
  }

  const close = s.consumeSymbol(")");

  const assignment: Assignment = {
    type: "Assignment",
    name,
    array: {
      type: "ArrayExpr",
      elems,
      pos: open.pos,
      end: close.end,
    },
    pos: startPos,
    end: close.end,
  };
  if (append) assignment.append = true;
  return assignment;
}
