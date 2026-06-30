import type {
  ArithCmd,
  ArrayElem,
  Assignment,
  BinaryTestOp,
  Block,
  CaseClause,
  CaseItem,
  Command,
  CommentNode,
  CoprocClause,
  CStyleLoop,
  DeclClause,
  ForClause,
  FunctionDecl,
  IfClause,
  LetClause,
  ParamExp,
  ParamExpOp,
  ParseError,
  ParseOptions,
  Pos,
  Program,
  Redirect,
  SelectClause,
  SimpleCommand,
  Statement,
  Subshell,
  TestClause,
  TestExpr,
  TimeClause,
  UnaryTestOp,
  WhileClause,
  Word,
  WordPart,
} from "../ast";
import { checkLang, isZsh } from "../dialect";
import type {
  OpTokenValue,
  SymbolTokenValue,
  Token,
  TokenWordPart,
} from "../tokenizer";
import { tokenPartsText } from "../tokenizer";
import { SourceMap } from "../tokenizer/cursor";
import { tokenize } from "../tokenizer/tokenize";
import { parseArithmetic } from "./arith-parser";
import { DECL_KEYWORDS } from "./constants";

const ZERO_POS: Pos = { offset: 0, line: 1, col: 1 };

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

/**
 * Wrap a raw substring (e.g. a slice offset or a replacement pattern) as a
 * single-literal Word. The string was extracted from inside `${...}` so it
 * has no inner expansions to recurse into.
 */
function strToWord(value: string): Word {
  return { type: "Word", parts: [{ type: "Literal", value }] };
}

/** Human-readable description of a token, for error messages. */
function describeToken(token: Token | undefined): string {
  if (!token) return "";
  switch (token.type) {
    case "op":
      return token.value;
    case "redir":
      return token.op;
    case "symbol":
      return token.value;
    case "arith-cmd":
      return "(( ... ))";
    case "heredoc-body":
      return "<<heredoc>>";
    case "comment":
      return `#${token.text}`;
    case "word":
      return tokenPartsText(token.parts);
  }
}

type TopLevelPart = { raw: string; offset: number };

/** Split `s` on a single-char delimiter, ignoring delimiters in parentheses. */
function splitAtTopLevel(s: string, delim: string): TopLevelPart[] {
  const parts: TopLevelPart[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === delim && depth === 0) {
      parts.push(trimmedTopLevelPart(s, start, i));
      start = i + 1;
    }
  }
  parts.push(trimmedTopLevelPart(s, start, s.length));
  return parts;
}

function trimmedTopLevelPart(
  source: string,
  start: number,
  end: number,
): TopLevelPart {
  while (start < end && /\s/.test(source[start] as string)) start++;
  while (end > start && /\s/.test(source[end - 1] as string)) end--;
  return { raw: source.slice(start, end), offset: start };
}

export class Parser {
  private index = 0;
  private comments: CommentNode[] = [];

  constructor(
    private readonly tokens: Token[],
    private readonly options: ParseOptions = {},
  ) {}

  /** Yield each top-level statement as it's parsed. */
  *statementsSeq(): Generator<Statement> {
    this.skipSeparators();
    while (!this.isEof()) {
      yield this.parseStatement();
      this.skipSeparators();
    }
  }

  /** Yield each word token as a Word, ignoring statement structure. */
  *wordsSeq(): Generator<Word> {
    while (!this.isEof()) {
      const tok = this.peek();
      if (!tok) break;
      if (
        tok.type === "op" ||
        tok.type === "redir" ||
        tok.type === "symbol" ||
        tok.type === "heredoc-body" ||
        tok.type === "comment" ||
        tok.type === "arith-cmd"
      ) {
        // Skip non-word tokens; useful for argv-style sources where we
        // only care about the word stream.
        this.consume();
        continue;
      }
      this.consume();
      yield this.wordFromToken(tok);
    }
  }

  /**
   * Like `parseProgram` but never throws: parse errors are collected into
   * the provided array, and the parser advances past the offending token
   * to keep going. Used by the public `recoverErrors` mode.
   */
  parseProgramRecovering(errors: ParseError[]): Program {
    const body: Statement[] = [];
    this.skipSeparators();
    const startPos = this.peek()?.pos ?? ZERO_POS;
    while (!this.isEof()) {
      const before = this.index;
      try {
        body.push(this.parseStatement());
        this.skipSeparators();
      } catch (e) {
        const tok = this.tokens[before];
        errors.push({
          message: e instanceof Error ? e.message : String(e),
          pos: tok?.pos ?? this.lastEnd() ?? startPos,
        });
        // Advance past the offending token to avoid infinite looping.
        if (this.index === before) this.index += 1;
        this.skipSeparators();
      }
    }
    const endPos = this.lastEnd() ?? startPos;
    const program: Program = {
      type: "Program",
      body,
      pos: startPos,
      end: endPos,
    };
    if (this.options.keepComments && this.comments.length > 0) {
      program.comments = this.comments;
    }
    return program;
  }

  parseProgram(): Program {
    const body: Statement[] = [];
    this.skipSeparators();
    const startPos = this.peek()?.pos ?? ZERO_POS;
    while (!this.isEof()) {
      body.push(this.parseStatement());
      this.skipSeparators();
    }
    const endPos = this.lastEnd() ?? startPos;
    const program: Program = {
      type: "Program",
      body,
      pos: startPos,
      end: endPos,
    };
    if (this.options.keepComments && this.comments.length > 0) {
      program.comments = this.comments;
    }
    return program;
  }

  assertEof() {
    if (this.isEof()) return;
    throw new Error(`Unexpected token: ${describeToken(this.peek())}`);
  }

  private parseStatement(): Statement {
    const startTok = this.peek();
    const startPos = startTok?.pos ?? ZERO_POS;
    let negated = false;
    if (this.matchOp("!")) {
      this.consume();
      negated = true;
    }
    const command = this.parseLogical();
    let background = false;
    if (this.matchOp("&")) {
      this.consume();
      background = true;
    }
    const endPos = this.lastEnd() ?? startPos;
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

  private parseLogical(): Command {
    let leftCommand = this.parsePipeline();
    while (this.matchOp("&&") || this.matchOp("||")) {
      const opToken = this.consume();
      if (opToken.type !== "op") {
        throw new Error("Expected logical operator");
      }
      const rightCommand = this.parsePipeline();
      const left = this.wrapStatement(leftCommand);
      const right = this.wrapStatement(rightCommand);
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

  private parsePipeline(): Command {
    const first = this.parseCommandAtom();
    if (!this.matchOp("|")) {
      return first;
    }
    const firstStmt = this.wrapStatement(first);
    const commands: Statement[] = [firstStmt];
    while (this.matchOp("|")) {
      this.consume();
      const next = this.parseCommandAtom();
      commands.push(this.wrapStatement(next));
    }
    const last = commands[commands.length - 1];
    return {
      type: "Pipeline",
      commands,
      pos: firstStmt.pos ?? ZERO_POS,
      end: last?.end ?? firstStmt.end ?? ZERO_POS,
    };
  }

  private parseCommandAtom(): Command {
    if (this.matchKeyword("if")) {
      return this.parseIfClause();
    }
    if (this.matchKeyword("while")) {
      return this.parseWhileClause(false);
    }
    if (this.matchKeyword("until")) {
      return this.parseWhileClause(true);
    }
    if (this.matchKeyword("for")) {
      return this.parseForOrCStyleLoop();
    }
    if (this.matchKeyword("select")) {
      return this.parseSelectClause();
    }
    if (this.matchKeyword("case")) {
      return this.parseCaseClause();
    }
    if (this.matchKeyword("time")) {
      return this.parseTimeClause();
    }
    if (this.matchKeyword("coproc")) {
      return this.parseCoprocClause();
    }
    if (this.matchKeyword("[[")) {
      return this.parseTestClause();
    }
    if (this.matchKeyword("function") || this.looksLikeFuncDecl()) {
      return this.parseFunctionDecl();
    }
    if (this.matchArithCmd()) {
      return this.consumeArithCmd();
    }
    if (this.matchSymbol("(")) {
      return this.parseSubshell();
    }
    if (this.matchSymbol("{")) {
      return this.parseBlock();
    }
    if (this.matchDeclKeyword()) {
      return this.parseDeclClause();
    }
    if (this.matchKeyword("let")) {
      return this.parseLetClause();
    }
    return this.parseSimpleCommand();
  }

  private parseSubshell(): Subshell {
    const open = this.consumeSymbol("(");
    const body = this.parseStatementList("(", ")");
    const close = this.consumeSymbol(")");
    return { type: "Subshell", body, pos: open.pos, end: close.end };
  }

  private parseBlock(): Block {
    const open = this.consumeSymbol("{");
    const body = this.parseStatementList("{", "}");
    const close = this.consumeSymbol("}");
    return { type: "Block", body, pos: open.pos, end: close.end };
  }

  /**
   * Read an optional `in word1 word2 ...` clause used by `for` and `select`,
   * up to `do`. Returns `undefined` if there's no `in` keyword.
   */
  private collectLoopItems(): Word[] | undefined {
    if (!this.matchKeyword("in")) return undefined;
    this.consumeKeyword("in");
    const items: Word[] = [];
    while (this.matchWord() && !this.matchKeyword("do")) {
      const tok = this.consume();
      if (tok.type !== "word") throw new Error("Expected loop item word");
      items.push(this.wordFromToken(tok));
    }
    return items.length > 0 ? items : undefined;
  }

  private parseStatementList(
    left: string,
    endSymbol: SymbolTokenValue,
  ): Statement[] {
    const body: Statement[] = [];
    this.skipSeparators();
    while (!this.matchSymbol(endSymbol)) {
      if (this.isEof()) {
        throw new Error(
          `Unexpected end of input while looking for ${endSymbol}`,
        );
      }
      body.push(this.parseStatement());
      this.skipSeparators();
    }
    if (body.length === 0 && !isZsh(this.options.dialect)) {
      throw new Error(`"${left}" must be followed by a statement list`);
    }
    return body;
  }

  /**
   * Parse an `if`/`elif` chain starting at the head keyword. The caller has
   * already verified the head is `head` (either `"if"` or `"elif"`). The
   * outermost call consumes the trailing `fi`; recursive elif calls don't.
   */
  private parseIfChain(head: "if" | "elif"): IfClause {
    const headTok = this.consumeKeyword(head);
    const cond = this.parseStatementsUntilKeyword(head, ["then"]);
    this.consumeKeyword("then");
    const thenBranch = this.parseStatementsUntilKeyword("then", [
      "else",
      "elif",
      "fi",
    ]);
    let elseBranch: Statement[] | undefined;
    if (this.matchKeyword("elif")) {
      const inner = this.parseIfChain("elif");
      elseBranch = [this.wrapStatement(inner)];
    } else if (this.matchKeyword("else")) {
      this.consumeKeyword("else");
      elseBranch = this.parseStatementsUntilKeyword("else", ["fi"]);
    }
    // Only the outermost `if` consumes `fi`; recursive `elif` rides on the
    // outer call's eventual consumption.
    const endPos =
      head === "if"
        ? this.consumeKeyword("fi").end
        : (this.lastEnd() ?? headTok.end);
    const node: IfClause = {
      type: "IfClause",
      cond,
      // biome-ignore lint/suspicious/noThenProperty: shell AST field
      then: thenBranch,
      pos: headTok.pos,
      end: endPos,
    };
    if (elseBranch) node.else = elseBranch;
    return node;
  }

  private parseIfClause(): IfClause {
    return this.parseIfChain("if");
  }

  private parseWhileClause(until: boolean): WhileClause {
    const head = this.consumeKeyword(until ? "until" : "while");
    const keyword = until ? "until" : "while";
    const cond = this.parseStatementsUntilKeyword(keyword, ["do"]);
    this.consumeKeyword("do");
    const body = this.parseStatementsUntilKeyword("do", ["done"]);
    const done = this.consumeKeyword("done");
    return until
      ? {
          type: "WhileClause",
          cond,
          body,
          until: true,
          pos: head.pos,
          end: done.end,
        }
      : {
          type: "WhileClause",
          cond,
          body,
          pos: head.pos,
          end: done.end,
        };
  }

  private parseForOrCStyleLoop(): ForClause | CStyleLoop {
    const forTok = this.consumeKeyword("for");

    // C-style: for (( init; cond; post ))
    if (this.matchArithCmd()) {
      return this.parseCStyleLoop(forTok.pos);
    }

    const nameToken = this.consume();
    if (nameToken.type !== "word") {
      throw new Error("Expected loop variable name");
    }
    const name = tokenPartsText(nameToken.parts);
    const items = this.collectLoopItems();
    if (this.matchOp(";")) {
      this.consume();
    }
    this.skipSeparators();
    this.consumeKeyword("do");
    const body = this.parseStatementsUntilKeyword("do", ["done"]);
    const done = this.consumeKeyword("done");
    return items
      ? { type: "ForClause", name, items, body, pos: forTok.pos, end: done.end }
      : { type: "ForClause", name, body, pos: forTok.pos, end: done.end };
  }

  private parseCStyleLoop(startPos: Pos): CStyleLoop {
    const token = this.consume();
    if (token.type !== "arith-cmd") {
      throw new Error("Expected (( )) in c-style for");
    }
    checkLang(this.options.dialect, startPos, "for ((", [
      "bash",
      "mksh",
      "zsh",
    ]);

    // Split inner on `;` boundaries (top-level only) and parse each piece
    // as its own arithmetic expression. Empty clauses are allowed.
    const base = {
      offset: token.innerOffset,
      line: token.pos.line,
      col: token.pos.col + 2,
    };
    const partMap = new SourceMap(token.expr);
    const [initPart, condPart, postPart] = splitAtTopLevel(token.expr, ";");
    const baseFor = (part: TopLevelPart) => {
      const inner = partMap.posAt(part.offset);
      return {
        offset: base.offset + part.offset,
        line: base.line + inner.line - 1,
        col: inner.line === 1 ? base.col + inner.col - 1 : inner.col,
      };
    };
    const init = initPart?.raw
      ? parseArithmetic(initPart.raw, baseFor(initPart))
      : undefined;
    const cond = condPart?.raw
      ? parseArithmetic(condPart.raw, baseFor(condPart))
      : undefined;
    const post = postPart?.raw
      ? parseArithmetic(postPart.raw, baseFor(postPart))
      : undefined;

    if (this.matchOp(";")) {
      this.consume();
    }
    this.skipSeparators();
    this.consumeKeyword("do");
    const body = this.parseStatementsUntilKeyword("do", ["done"]);
    const done = this.consumeKeyword("done");
    const loop: CStyleLoop = {
      type: "CStyleLoop",
      body,
      pos: startPos,
      end: done.end,
    };
    if (init !== undefined) loop.init = init;
    if (cond !== undefined) loop.cond = cond;
    if (post !== undefined) loop.post = post;
    return loop;
  }

  private parseSelectClause(): SelectClause {
    const head = this.consumeKeyword("select");
    checkLang(this.options.dialect, head.pos, "select", [
      "bash",
      "mksh",
      "zsh",
    ]);
    const nameToken = this.consume();
    if (nameToken.type !== "word") {
      throw new Error("Expected select variable name");
    }
    const name = tokenPartsText(nameToken.parts);
    let items: Word[] | undefined;
    if (this.matchKeyword("in")) {
      this.consumeKeyword("in");
      const collected: Word[] = [];
      while (this.matchWord() && !this.matchKeyword("do")) {
        const itemToken = this.consume();
        if (itemToken.type !== "word") {
          throw new Error("Expected select item word");
        }
        collected.push(this.wordFromToken(itemToken));
      }
      if (collected.length > 0) {
        items = collected;
      }
    }
    if (this.matchOp(";")) {
      this.consume();
    }
    this.skipSeparators();
    this.consumeKeyword("do");
    const body = this.parseStatementsUntilKeyword("do", ["done"]);
    const done = this.consumeKeyword("done");
    return items
      ? {
          type: "SelectClause",
          name,
          items,
          body,
          pos: head.pos,
          end: done.end,
        }
      : { type: "SelectClause", name, body, pos: head.pos, end: done.end };
  }

  private parseFunctionDecl(): FunctionDecl {
    let startPos: Pos | undefined;
    if (this.matchKeyword("function")) {
      const fk = this.consumeKeyword("function");
      checkLang(this.options.dialect, fk.pos, "function", [
        "bash",
        "mksh",
        "zsh",
      ]);
      startPos = fk.pos;
    }
    const nameToken = this.consume();
    if (nameToken.type !== "word") {
      throw new Error("Expected function name");
    }
    if (!startPos) startPos = nameToken.pos;
    const name = tokenPartsText(nameToken.parts);
    if (this.matchSymbol("(")) {
      this.consumeSymbol("(");
      this.consumeSymbol(")");
    }
    if (this.matchSymbol("{")) {
      const block = this.parseBlock();
      return {
        type: "FunctionDecl",
        name,
        body: block.body,
        pos: startPos,
        end: block.end ?? startPos,
      };
    }
    throw new Error("Expected function body block");
  }

  private parseCaseClause(): CaseClause {
    const head = this.consumeKeyword("case");
    const wordToken = this.consume();
    if (wordToken.type !== "word") {
      throw new Error("Expected case word");
    }
    const word = this.wordFromToken(wordToken);
    this.consumeKeyword("in");
    const items: CaseItem[] = [];
    this.skipSeparators();
    while (!this.matchKeyword("esac")) {
      const itemStart = this.peek()?.pos ?? head.pos;
      const patterns: Word[] = [];
      while (!this.matchSymbol(")")) {
        if (this.matchWord()) {
          const patternToken = this.consume();
          if (patternToken.type !== "word") {
            throw new Error("Expected case pattern");
          }
          patterns.push(this.wordFromToken(patternToken));
          continue;
        }
        if (this.matchOp("|")) {
          this.consume();
          continue;
        }
        throw new Error("Expected case pattern or )");
      }
      this.consumeSymbol(")");
      const body = this.parseCaseItemBody();
      const itemEnd = this.lastEnd() ?? itemStart;
      items.push({
        type: "CaseItem",
        patterns,
        body,
        pos: itemStart,
        end: itemEnd,
      });
      if (this.matchOp(";") && this.peekOp(";")) {
        this.consume();
        this.consume();
      }
      this.skipSeparators();
    }
    const esac = this.consumeKeyword("esac");
    return {
      type: "CaseClause",
      word,
      items,
      pos: head.pos,
      end: esac.end,
    };
  }

  private parseTimeClause(): TimeClause {
    const head = this.consumeKeyword("time");
    const command = this.parseStatement();
    return {
      type: "TimeClause",
      command,
      pos: head.pos,
      end: command.end ?? head.end,
    };
  }

  private parseTestClause(): TestClause {
    const open = this.consumeKeyword("[[");
    checkLang(this.options.dialect, open.pos, "[[", ["bash", "mksh", "zsh"]);
    const x = this.parseTestExpr(0);
    const close = this.consumeKeyword("]]");
    return {
      type: "TestClause",
      x,
      pos: open.pos,
      end: close.end,
    };
  }

  private parseTestExpr(minPrec: number): TestExpr {
    let left = this.parseTestPrimary();
    while (true) {
      const op = this.peekTestBinaryOp();
      if (!op) break;
      const prec = op === "||" ? 1 : op === "&&" ? 2 : 3;
      if (prec < minPrec) break;
      this.consumeTestOp(op);
      const right = this.parseTestExpr(prec + 1);
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

  private parseTestPrimary(): TestExpr {
    // Negation
    if (this.matchOp("!")) {
      const op = this.consume();
      const x = this.parseTestPrimary();
      return {
        type: "UnaryTest",
        op: "!",
        x,
        pos: op.pos,
        end: x.end ?? op.end,
      };
    }
    // Parenthesized
    if (this.matchSymbol("(")) {
      const open = this.consumeSymbol("(");
      const x = this.parseTestExpr(0);
      const close = this.consumeSymbol(")");
      return { type: "ParenTest", x, pos: open.pos, end: close.end };
    }
    // Unary file/string ops: a single token like `-e`/`-z`/...
    const head = this.peek();
    if (head && head.type === "word") {
      const text = tokenPartsText(head.parts);
      if (TEST_UNARY_OPS.has(text)) {
        this.consume();
        const arg = this.parseTestPrimary();
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
    if (this.matchWord()) {
      const tok = this.consume();
      if (tok.type !== "word") throw new Error("expected word in [[ ]]");
      return this.wordFromToken(tok);
    }
    throw new Error("Expected expression inside [[ ]]");
  }

  private peekTestBinaryOp(): BinaryTestOp | undefined {
    const tok = this.peek();
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

  private consumeTestOp(op: BinaryTestOp): void {
    const tok = this.consume();
    if (tok.type === "op" && tok.value === op) return;
    if (tok.type === "word" && tokenPartsText(tok.parts) === op) return;
    throw new Error(`expected test op ${op}`);
  }

  private matchArithCmd(): boolean {
    return this.peek()?.type === "arith-cmd";
  }

  private consumeArithCmd(): ArithCmd {
    const token = this.consume();
    if (token.type !== "arith-cmd")
      throw new Error("Expected arithmetic command");
    checkLang(this.options.dialect, token.pos, "(( ))", [
      "bash",
      "mksh",
      "zsh",
    ]);
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

  private parseCoprocClause(): CoprocClause {
    const head = this.consumeKeyword("coproc");
    checkLang(this.options.dialect, head.pos, "coproc", ["bash", "zsh"]);
    if (this.matchWord() && this.peekToken(1)?.type === "symbol") {
      const nameToken = this.peek();
      if (
        nameToken?.type === "word" &&
        this.peekToken(1)?.type === "symbol" &&
        (this.peekToken(1) as { value: string }).value === "{"
      ) {
        const name = tokenPartsText(nameToken.parts);
        this.consume();
        const body = this.parseStatement();
        return {
          type: "CoprocClause",
          name,
          body,
          pos: head.pos,
          end: body.end ?? head.end,
        };
      }
    }
    const body = this.parseStatement();
    return {
      type: "CoprocClause",
      body,
      pos: head.pos,
      end: body.end ?? head.end,
    };
  }

  private parseCaseItemBody(): Statement[] {
    const body: Statement[] = [];
    this.skipCaseSeparators();
    while (!this.matchKeyword("esac") && !this.isCaseItemEnd()) {
      body.push(this.parseStatement());
      if (this.isCaseItemEnd()) {
        break;
      }
      this.skipCaseSeparators();
    }
    return body;
  }

  private isCaseItemEnd(): boolean {
    return this.matchOp(";") && this.peekOp(";");
  }

  private parseStatementsUntilKeyword(
    left: string,
    endKeywords: string[],
  ): Statement[] {
    const body: Statement[] = [];
    this.skipSeparators();
    while (!this.matchKeywordIn(endKeywords)) {
      if (this.isEof()) {
        throw new Error(
          `Unexpected end of input while looking for ${endKeywords.join(", ")}`,
        );
      }
      body.push(this.parseStatement());
      this.skipSeparators();
    }
    if (body.length === 0 && !isZsh(this.options.dialect)) {
      throw new Error(`"${left}" must be followed by a statement list`);
    }
    return body;
  }

  private matchDeclKeyword(): boolean {
    const token = this.peek();
    if (token?.type !== "word" || token.parts.length !== 1) return false;
    const part = token.parts[0];
    return part?.type === "lit" && DECL_KEYWORDS.has(part.value);
  }

  private parseDeclClause(): DeclClause {
    const variantToken = this.consume();
    if (variantToken.type !== "word") {
      throw new Error("Expected decl keyword");
    }
    const variant = tokenPartsText(variantToken.parts) as DeclClause["variant"];
    // POSIX only standardizes `export` and `readonly`. Bash/mksh/zsh add the
    // others (`declare`, `local`, `typeset`, `nameref`).
    if (variant !== "export" && variant !== "readonly") {
      checkLang(this.options.dialect, variantToken.pos, variant, [
        "bash",
        "mksh",
        "zsh",
      ]);
    }

    const args: Word[] = [];
    const assigns: Assignment[] = [];
    const redirects: Redirect[] = [];

    while (true) {
      if (this.matchRedir()) {
        redirects.push(this.parseRedirect());
        continue;
      }

      if (this.matchWord()) {
        const token = this.peek();
        if (!token || token.type !== "word") break;

        const assignment = this.tryParseAssignment(token);
        if (assignment) {
          assigns.push(assignment);
          continue;
        }

        this.consume();
        args.push(this.wordFromToken(token));
        continue;
      }

      break;
    }

    const lastEnd = this.lastEnd() ?? variantToken.end;
    const decl: DeclClause = {
      type: "DeclClause",
      variant,
      pos: variantToken.pos,
      end: lastEnd,
    };
    if (args.length > 0) decl.args = args;
    if (assigns.length > 0) decl.assigns = assigns;
    if (redirects.length > 0) decl.redirects = redirects;
    return decl;
  }

  private parseLetClause(): LetClause {
    const letTok = this.consumeKeyword("let");
    checkLang(this.options.dialect, letTok.pos, "let", ["bash", "mksh", "zsh"]);
    const exprs: Word[] = [];
    const redirects: Redirect[] = [];

    while (true) {
      if (this.matchRedir()) {
        redirects.push(this.parseRedirect());
        continue;
      }

      if (this.matchWord()) {
        const token = this.consume();
        if (token.type !== "word") break;
        exprs.push(this.wordFromToken(token));
        continue;
      }

      break;
    }

    if (exprs.length === 0) {
      throw new Error("let requires at least one expression");
    }

    const clause: LetClause = {
      type: "LetClause",
      exprs,
      pos: letTok.pos,
      end: this.lastEnd() ?? letTok.end,
    };
    if (redirects.length > 0) clause.redirects = redirects;
    return clause;
  }

  private parseSimpleCommand(): SimpleCommand {
    const startPos = this.peek()?.pos ?? ZERO_POS;
    const words: Word[] = [];
    const assignments: Assignment[] = [];
    const redirects: Redirect[] = [];
    let sawWord = false;

    while (true) {
      if (this.matchWord()) {
        const token = this.peek();
        if (!token || token.type !== "word") {
          throw new Error("Expected word token");
        }

        if (!sawWord) {
          const assignment = this.tryParseAssignment(token);
          if (assignment) {
            assignments.push(assignment);
            continue;
          }
        }

        this.consume();
        sawWord = true;
        words.push(this.wordFromToken(token));
        continue;
      }

      if (this.matchRedir()) {
        redirects.push(this.parseRedirect());
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

    const endPos = this.lastEnd() ?? startPos;
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

  private parseRedirect(): Redirect {
    const token = this.consume();
    if (token.type !== "redir") {
      throw new Error("Expected redirect token");
    }
    const targetToken = this.consume();
    if (targetToken.type !== "word") {
      throw new Error("Redirect must be followed by a word");
    }
    const target = this.wordFromToken(targetToken);
    const redirect: Redirect = token.fd
      ? {
          type: "Redirect",
          op: token.op,
          fd: token.fd,
          target,
          pos: token.pos,
          end: target.end ?? targetToken.end,
        }
      : {
          type: "Redirect",
          op: token.op,
          target,
          pos: token.pos,
          end: target.end ?? targetToken.end,
        };
    if (token.op === "<<" || token.op === "<<-") {
      this.skipSeparators();
      if (this.peek()?.type === "heredoc-body") {
        const bodyToken = this.consume();
        if (bodyToken.type === "heredoc-body") {
          redirect.heredoc = {
            type: "Word",
            parts: [
              {
                type: "Literal",
                value: bodyToken.content,
                pos: bodyToken.pos,
                end: bodyToken.end,
              },
            ],
            pos: bodyToken.pos,
            end: bodyToken.end,
          };
          redirect.end = bodyToken.end;
        }
      }
    }
    return redirect;
  }

  private convertWordPart(part: TokenWordPart): WordPart {
    switch (part.type) {
      case "lit":
        return {
          type: "Literal",
          value: part.value,
          pos: part.pos,
          end: part.end,
        };
      case "sgl":
        return {
          type: "SglQuoted",
          value: part.value,
          pos: part.pos,
          end: part.end,
        };
      case "dbl":
        return {
          type: "DblQuoted",
          parts: part.parts.map((p) => this.convertWordPart(p)),
          pos: part.pos,
          end: part.end,
        };
      case "param":
        return this.convertParamExp(part);
      case "cmd-subst": {
        const innerTokens = tokenize(part.raw);
        const innerParser = new Parser(innerTokens);
        const prog = innerParser.parseProgram();
        return {
          type: "CmdSubst",
          stmts: prog.body,
          pos: part.pos,
          end: part.end,
        };
      }
      case "arith-exp": {
        const x = parseArithmetic(part.raw, {
          offset: part.innerOffset,
          line: part.pos.line,
          col: part.pos.col + 3,
        });
        if (!x) {
          throw new Error("Empty arithmetic expansion");
        }
        return {
          type: "ArithExp",
          x,
          pos: part.pos,
          end: part.end,
        };
      }
      case "proc-subst": {
        const innerTokens = tokenize(part.raw);
        const innerParser = new Parser(innerTokens);
        const prog = innerParser.parseProgram();
        return {
          type: "ProcSubst",
          op: part.op,
          stmts: prog.body,
          pos: part.pos,
          end: part.end,
        };
      }
      case "backtick": {
        const innerTokens = tokenize(part.raw);
        const innerParser = new Parser(innerTokens);
        const prog = innerParser.parseProgram();
        return {
          type: "CmdSubst",
          stmts: prog.body,
          pos: part.pos,
          end: part.end,
        };
      }
      case "ext-glob":
        return {
          type: "ExtGlob",
          op: part.op,
          pattern: part.pattern,
          pos: part.pos,
          end: part.end,
        };
    }
  }

  private convertParamExp(part: TokenWordPart & { type: "param" }): ParamExp {
    const out: ParamExp = {
      type: "ParamExp",
      short: !part.braced,
      param: { type: "Literal", value: part.name },
      pos: part.pos,
      end: part.end,
    };
    if (part.length) out.length = true;
    if (part.excl) out.excl = true;
    if (part.index !== undefined) {
      out.index = strToWord(part.index);
    }
    if (part.slice) {
      const slice: ParamExp["slice"] = {
        offset: strToWord(part.slice.offset),
      };
      if (part.slice.length !== undefined) {
        slice.length = strToWord(part.slice.length);
      }
      out.slice = slice;
    }
    if (part.replace) {
      const r: ParamExp["replace"] = {
        orig: strToWord(part.replace.orig),
      };
      if (part.replace.with !== undefined)
        r.with = strToWord(part.replace.with);
      if (part.replace.all) r.all = true;
      if (part.replace.prefix) r.prefix = true;
      if (part.replace.suffix) r.suffix = true;
      out.replace = r;
    }
    if (part.exp) {
      const exp: ParamExp["exp"] = {
        op: part.exp.op as ParamExpOp,
      };
      if (part.exp.value !== undefined) exp.word = strToWord(part.exp.value);
      out.exp = exp;
    }
    return out;
  }

  private wordFromToken(token: Token & { type: "word" }): Word {
    return {
      type: "Word",
      parts: token.parts.map((part) => this.convertWordPart(part)),
      pos: token.pos,
      end: token.end,
    };
  }

  /**
   * Try to parse an assignment from a word token.
   * Consumes tokens itself if it matches; returns undefined otherwise.
   */
  private tryParseAssignment(
    token: Token & { type: "word" },
  ): Assignment | undefined {
    const parts = token.parts;
    if (parts.length !== 1) return undefined;
    const part = parts[0];
    if (!part || part.type !== "lit") return undefined;
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

    const nextToken = this.peekToken(1);
    if (
      afterEq === "" &&
      nextToken?.type === "symbol" &&
      (nextToken as { value: string }).value === "("
    ) {
      checkLang(this.options.dialect, token.pos, "array assignment", [
        "bash",
        "mksh",
        "zsh",
      ]);
      this.consume(); // consume the NAME= word
      return this.parseArrayAssignment(name, append, token.pos);
    }

    if (append) {
      checkLang(this.options.dialect, token.pos, "+=", ["bash", "mksh", "zsh"]);
    }

    this.consume();

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

  private parseArrayAssignment(
    name: string,
    append: boolean,
    startPos: Pos,
  ): Assignment {
    const open = this.consumeSymbol("(");
    const elems: ArrayElem[] = [];

    while (!this.matchSymbol(")")) {
      if (this.isEof()) {
        throw new Error("Unclosed array expression");
      }
      if (this.matchOp(";")) {
        this.consume();
        continue;
      }
      if (this.matchComment()) {
        this.consumeComment();
        continue;
      }

      const token = this.consume();
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
          value: this.wordFromToken(token),
          pos: token.pos,
          end: token.end,
        });
      }
    }

    const close = this.consumeSymbol(")");

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

  private skipSeparators() {
    while (this.matchOp(";") || this.matchComment()) {
      if (this.matchComment()) {
        this.consumeComment();
      } else {
        this.consume();
      }
    }
  }

  private skipCaseSeparators() {
    while (this.matchOp(";") && !this.peekOp(";")) {
      this.consume();
    }
  }

  private wrapStatement(command: Command): Statement {
    return {
      type: "Statement",
      command,
      pos: command.pos ?? ZERO_POS,
      end: command.end ?? ZERO_POS,
    };
  }

  private matchOp(value: OpTokenValue) {
    const token = this.peek();
    return token?.type === "op" && token.value === value;
  }

  private matchWord() {
    return this.peek()?.type === "word";
  }

  private matchRedir() {
    return this.peek()?.type === "redir";
  }

  private matchKeyword(value: string) {
    const token = this.peek();
    if (token?.type !== "word" || token.parts.length !== 1) return false;
    const part = token.parts[0];
    return part?.type === "lit" && part.value === value;
  }

  private matchKeywordIn(values: string[]) {
    return values.some((value) => this.matchKeyword(value));
  }

  private looksLikeFuncDecl(): boolean {
    const name = this.peek();
    const next = this.peekToken(1);
    const nextNext = this.peekToken(2);
    const after = this.peekToken(3);
    return (
      name?.type === "word" &&
      next?.type === "symbol" &&
      next.value === "(" &&
      nextNext?.type === "symbol" &&
      nextNext.value === ")" &&
      after?.type === "symbol" &&
      after.value === "{"
    );
  }

  private matchSymbol(value: SymbolTokenValue) {
    const token = this.peek();
    return token?.type === "symbol" && token.value === value;
  }

  private consumeSymbol(value: SymbolTokenValue): Token & { type: "symbol" } {
    const token = this.consume();
    if (token.type !== "symbol" || token.value !== value) {
      throw new Error(`Expected symbol ${value}`);
    }
    return token;
  }

  private consumeKeyword(value: string): Token & { type: "word" } {
    const token = this.consume();
    if (
      token.type !== "word" ||
      token.parts.length !== 1 ||
      token.parts[0]?.type !== "lit" ||
      token.parts[0].value !== value
    ) {
      throw new Error(`Expected keyword ${value}`);
    }
    return token;
  }

  private consume(): Token {
    if (this.isEof()) {
      throw new Error("Unexpected end of input");
    }
    const token = this.tokens[this.index];
    if (!token) {
      throw new Error("Unexpected end of input");
    }
    this.index += 1;
    return token;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private peekToken(offset: number): Token | undefined {
    return this.tokens[this.index + offset];
  }

  private peekOp(value: OpTokenValue): boolean {
    const token = this.peekToken(1);
    return token?.type === "op" && token.value === value;
  }

  private matchComment(): boolean {
    return this.peek()?.type === "comment";
  }

  private consumeComment() {
    const token = this.consume();
    if (token.type === "comment") {
      this.comments.push({
        type: "Comment",
        text: token.text,
        pos: token.pos,
        end: token.end,
      });
    }
  }

  private isEof() {
    return this.index >= this.tokens.length;
  }

  private lastEnd(): Pos | undefined {
    const tok = this.tokens[this.index - 1];
    return tok?.end;
  }
}
