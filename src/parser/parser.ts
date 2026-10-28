import type {
  ArithCmd,
  ArrayElem,
  Assignment,
  BinaryTestOp,
  Block,
  CaseClause,
  CaseItem,
  CmdSubst,
  Command,
  CommentNode,
  CoprocClause,
  CStyleLoop,
  DeclClause,
  ExtGlob,
  ForClause,
  FunctionDecl,
  IfClause,
  LetClause,
  ParamExp,
  ParamExpOp,
  ParseError,
  ParseOptions,
  Pos,
  ProcSubst,
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
import { scanBacktick } from "../tokenizer/scan-backtick";
import { scanExpansion } from "../tokenizer/scan-expansion";
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
 * single-literal Word. Only used when the string cannot contain expansions;
 * strings captured from user source go through `wordFromShellSource`.
 */
function strToWord(value: string): Word {
  return { type: "Word", parts: [{ type: "Literal", value }] };
}

/** Anchor a relative position (from a re-scanned fragment) to the source. */
function rebasePos(pos: Pos, base: Pos): Pos {
  return {
    offset: pos.offset + base.offset,
    line: pos.line + base.line - 1,
    col: pos.line === 1 ? pos.col + base.col - 1 : pos.col,
  };
}

/**
 * Absolute position of `relOffset` inside `text`, where the text starts at
 * `base`. Walks the text so newlines advance the line and reset the col.
 */
function absPos(base: Pos, text: string, relOffset: number): Pos {
  let line = base.line;
  let lastNewline = -1;
  const end = Math.min(relOffset, text.length);
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      lastNewline = i;
    }
  }
  return {
    offset: base.offset + relOffset,
    line,
    col: lastNewline === -1 ? base.col + relOffset : relOffset - lastNewline,
  };
}

function isPos(value: unknown): value is Pos {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Pos).offset === "number" &&
    typeof (value as Pos).line === "number" &&
    typeof (value as Pos).col === "number"
  );
}

/**
 * Opening-delimiter length (`$(`, `<(`, `>(`, backtick) per substitution
 * node, so rebaseTree can locate the body origin of nested substitutions
 * when anchoring a reparsed fragment to the source.
 */
const substOpenLen = new WeakMap<object, number>();

/**
 * Rebase every position in a converted subtree by `base`, exactly once per
 * level. Substitution bodies are parsed from their inner text, so their
 * descendants rebase against the body origin instead of the node origin.
 */
function rebaseTree(node: unknown, base: Pos): void {
  if (Array.isArray(node)) {
    for (const item of node) rebaseTree(item, base);
    return;
  }
  if (!node || typeof node !== "object") return;
  const n = node as Record<string, unknown> & { pos?: Pos; end?: Pos };
  let bodyBase: Pos | undefined;
  if ((n.type === "CmdSubst" || n.type === "ProcSubst") && isPos(n.pos)) {
    const openLen = substOpenLen.get(n) ?? 2;
    bodyBase = rebasePos(
      {
        offset: n.pos.offset + openLen,
        line: n.pos.line,
        col: n.pos.col + openLen,
      },
      base,
    );
  }
  if (isPos(n.pos)) n.pos = rebasePos(n.pos, base);
  if (isPos(n.end)) n.end = rebasePos(n.end, base);
  for (const [key, value] of Object.entries(n)) {
    if (key === "pos" || key === "end" || key === "type") continue;
    if (key === "stmts" && bodyBase) {
      rebaseTree(value, bodyBase);
      continue;
    }
    rebaseTree(value, base);
  }
}

/** Append literal text to `parts`, coalescing with a trailing Literal. */
function pushLiteral(parts: WordPart[], value: string, pos?: Pos, end?: Pos) {
  if (value.length === 0) return;
  const prev = parts[parts.length - 1];
  if (prev?.type === "Literal") {
    prev.value += value;
    if (end) prev.end = end;
    return;
  }
  const lit: WordPart = { type: "Literal", value };
  if (pos) lit.pos = pos;
  if (end) lit.end = end;
  parts.push(lit);
}

/**
 * Merge adjacent Literal parts into one. Escape provenance lives on the
 * token stream (consumed by keyword/assignment checks before conversion);
 * at the AST level `a\ b` is a single literal, matching bash semantics.
 */
function mergeLiteralParts(parts: WordPart[]): WordPart[] {
  const out: WordPart[] = [];
  for (const part of parts) {
    const prev = out[out.length - 1];
    if (part.type === "Literal" && prev?.type === "Literal") {
      prev.value += part.value;
      if (part.end) prev.end = part.end;
      continue;
    }
    out.push(part);
  }
  return out;
}

/** Decode a Bash ANSI-C quoted string body ($'...') into its value. */
function decodeAnsiC(raw: string): string {
  let out = "";
  let i = 0;
  const hex = /[0-9a-fA-F]/;
  const oct = /[0-7]/;
  while (i < raw.length) {
    const c = raw.charAt(i);
    if (c !== "\\" || i + 1 >= raw.length) {
      out += c;
      i += 1;
      continue;
    }
    const e = raw.charAt(i + 1);
    switch (e) {
      case "a":
        out += "\x07";
        i += 2;
        break;
      case "b":
        out += "\b";
        i += 2;
        break;
      case "e":
      case "E":
        out += "\x1b";
        i += 2;
        break;
      case "f":
        out += "\f";
        i += 2;
        break;
      case "n":
        out += "\n";
        i += 2;
        break;
      case "r":
        out += "\r";
        i += 2;
        break;
      case "t":
        out += "\t";
        i += 2;
        break;
      case "v":
        out += "\v";
        i += 2;
        break;
      case "\\":
      case "'":
      case '"':
      case "?":
        out += e;
        i += 2;
        break;
      case "c": {
        const cx = raw.charAt(i + 2);
        if (cx === "") {
          out += "\\c";
          i += 2;
          break;
        }
        out += String.fromCharCode(cx.toUpperCase().charCodeAt(0) & 0x1f);
        i += 3;
        break;
      }
      case "x": {
        let j = i + 2;
        while (j < raw.length && j < i + 4 && hex.test(raw.charAt(j))) j++;
        if (j === i + 2) {
          out += "\\x";
          i += 2;
          break;
        }
        out += String.fromCodePoint(Number.parseInt(raw.slice(i + 2, j), 16));
        i = j;
        break;
      }
      case "u":
      case "U": {
        const len = e === "u" ? 4 : 8;
        const digits = raw.slice(i + 2, i + 2 + len);
        if (digits.length !== len || ![...digits].every((d) => hex.test(d))) {
          out += `\\${e}`;
          i += 2;
          break;
        }
        const cp = Number.parseInt(digits, 16);
        out += cp <= 0x10ffff ? String.fromCodePoint(cp) : `\\${e}${digits}`;
        i += 2 + len;
        break;
      }
      default: {
        if (oct.test(e)) {
          let j = i + 1;
          while (j < raw.length && j < i + 4 && oct.test(raw.charAt(j))) j++;
          out += String.fromCodePoint(Number.parseInt(raw.slice(i + 1, j), 8));
          i = j;
          break;
        }
        // Unknown escape: the backslash stays literal, as in Bash.
        out += `\\${e}`;
        i += 2;
      }
    }
  }
  return out;
}

/**
 * Text a token part contributes when matching textual boundaries inside an
 * array element (`[index]=`). Substitution parts contribute nothing; escaped
 * literals are invisible per the quoting-fidelity contract.
 */
function arrayElemVisibleText(part: TokenWordPart): string {
  switch (part.type) {
    case "lit":
      return part.escaped === true ? "" : part.value;
    case "sgl":
      return part.value;
    case "dbl":
      return part.parts.map(arrayElemVisibleText).join("");
    default:
      return "";
  }
}

/** Shift a literal part's position by `chars` (same line). */
function shiftPos(pos: Pos, chars: number): Pos {
  return { offset: pos.offset + chars, line: pos.line, col: pos.col + chars };
}

/**
 * Slice a literal token part to [from, to) of its value. Returns undefined
 * when the slice is empty.
 */
function sliceLitPart(
  part: TokenWordPart & { type: "lit" },
  from: number,
  to: number,
): TokenWordPart | undefined {
  if (to - from <= 0) return undefined;
  return {
    ...part,
    value: part.value.slice(from, to),
    pos: shiftPos(part.pos, from),
    end: shiftPos(part.pos, to),
  };
}

/**
 * Split an array element's token parts at the `[index]=` boundary, matching
 * only on literal text (substitution parts are skipped for the match but
 * kept in the result, so embedded `$(...)` stays structured). Returns
 * undefined when the element is not an indexed assignment.
 */
function splitIndexedArrayElem(parts: TokenWordPart[]):
  | {
      index: TokenWordPart[];
      value: TokenWordPart[];
    }
  | undefined {
  const chunks = parts.map((part) => ({
    part,
    text: arrayElemVisibleText(part),
  }));
  // Map each visible character to its chunk location.
  let vis = "";
  const vpos: Array<{ chunk: number; offset: number }> = [];
  chunks.forEach((chunk, ci) => {
    for (let k = 0; k < chunk.text.length; k++) {
      vis += chunk.text.charAt(k);
      vpos.push({ chunk: ci, offset: k });
    }
  });
  if (!vis.startsWith("[")) return undefined;
  let closeAt = -1;
  for (let k = 1; k + 1 < vis.length; k++) {
    if (vis.charAt(k) === "]" && vis.charAt(k + 1) === "=") {
      closeAt = k;
      break;
    }
  }
  if (closeAt === -1) return undefined;
  const openLoc = vpos[0];
  const closeLoc = vpos[closeAt];
  const eqLoc = vpos[closeAt + 1];
  if (!openLoc || !closeLoc || !eqLoc) return undefined;
  // The delimiters themselves must be plain literal characters.
  for (const loc of [openLoc, closeLoc, eqLoc]) {
    if (chunks[loc.chunk]?.part.type !== "lit") return undefined;
  }
  // Nothing but empty quote parts may sit between `]` and `=`.
  for (let ci = closeLoc.chunk + 1; ci < eqLoc.chunk; ci++) {
    const chunk = chunks[ci];
    if (!chunk) return undefined;
    if (chunk.text.length > 0) return undefined;
    const t = chunk.part.type;
    if (t !== "sgl" && t !== "dbl") return undefined;
  }
  const index: TokenWordPart[] = [];
  const value: TokenWordPart[] = [];
  chunks.forEach((chunk, ci) => {
    if (ci < openLoc.chunk) return;
    if (ci > eqLoc.chunk) {
      value.push(chunk.part);
      return;
    }
    const p = chunk.part;
    if (p.type !== "lit") {
      // Non-literal chunks fully inside the index region stay structured.
      if (ci > openLoc.chunk && ci < closeLoc.chunk) index.push(chunk.part);
      return;
    }
    const from = ci === openLoc.chunk ? openLoc.offset + 1 : 0;
    const to = ci === closeLoc.chunk ? closeLoc.offset : p.value.length;
    const idx = sliceLitPart(p, from, to);
    if (idx) index.push(idx);
    if (ci === eqLoc.chunk) {
      const val = sliceLitPart(p, eqLoc.offset + 1, p.value.length);
      if (val) value.push(val);
    }
  });
  if (index.length === 0) return undefined;
  return { index, value };
}

/** True for parts that carry only literal/quoted text (no expansions). */
function isQuotablePart(part: TokenWordPart): boolean {
  switch (part.type) {
    case "lit":
    case "sgl":
      return true;
    case "dbl":
      return part.parts.every(isQuotablePart);
    default:
      return false;
  }
}

/** Decoded text of a quotable part (what arithmetic evaluation sees). */
function quotableText(part: TokenWordPart): string {
  switch (part.type) {
    case "lit":
    case "sgl":
      return part.value;
    case "dbl":
      return part.parts.map(quotableText).join("");
    default:
      return "";
  }
}

/** Decl variants whose indexed-assignment operands bash evaluates as
 * arithmetic, surfacing substitutions hidden by quoting. */
const ARITH_DECL_VARIANTS = new Set(["declare", "typeset", "local"]);

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
  /**
   * Redirects that opened a heredoc (`<<`/`<<-`) but whose body token the
   * tokenizer hasn't emitted yet, in opener order. The tokenizer emits one
   * body token per queued heredoc right after the newline that ends the
   * command line, so bodies can arrive after later redirects on the same
   * line or after a trailing separator (`;`, `&&`, `||`, `|`). Bodies drain
   * to their redirects in `skipSeparators`/`skipCaseSeparators`.
   */
  private pendingHeredocs: Redirect[] = [];
  /**
   * When true, redirects following a compound command's closing keyword are
   * not attached to that compound node. Set while parsing a `coproc` body or
   * a function-decl block so the enclosing CoprocClause/FunctionDecl captures
   * them instead; cleared again inside nested statement lists.
   */
  private suppressTrailingRedirects = false;

  constructor(
    private readonly tokens: Token[],
    private readonly options: ParseOptions = {},
  ) {}

  /**
   * Yield each top-level statement as it's parsed. Statements carrying
   * heredocs are yielded only after their bodies have been drained, so a
   * yielded statement is always complete (no mutation after the yield).
   */
  *statementsSeq(): Generator<Statement> {
    this.skipSeparators();
    while (!this.isEof()) {
      const stmt = this.parseStatement();
      // Heredoc bodies arrive after the newline that ends the command
      // line; consume separators (draining pending heredoc bodies to
      // their redirects) before yielding so the statement is complete.
      this.skipSeparators();
      yield stmt;
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
      this.skipOperatorContinuation();
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
      this.skipOperatorContinuation();
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
    const node: Subshell = {
      type: "Subshell",
      body,
      pos: open.pos,
      end: close.end,
    };
    this.parseTrailingRedirects(node);
    return node;
  }

  private parseBlock(): Block {
    const open = this.consumeSymbol("{");
    const body = this.parseStatementList("{", "}");
    const close = this.consumeSymbol("}");
    const node: Block = { type: "Block", body, pos: open.pos, end: close.end };
    this.parseTrailingRedirects(node);
    return node;
  }

  /**
   * Consume any redirects immediately following a compound command's closing
   * keyword (`done`, `fi`, `}`, `)`, `esac`, `]]`, ...) and attach them to
   * the compound node itself, like bash and mvdan/sh do. Heredoc openers
   * queue in `pendingHeredocs`; their bodies drain later as usual. The
   * field stays unset when no redirects follow.
   */
  private parseTrailingRedirects(node: {
    redirects?: Redirect[];
    end?: Pos;
  }): void {
    if (this.suppressTrailingRedirects) return;
    if (!this.matchRedir()) return;
    const redirects: Redirect[] = [];
    while (this.matchRedir()) {
      redirects.push(this.parseRedirect());
    }
    node.redirects = redirects;
    const end = this.lastEnd();
    if (end) node.end = end;
  }

  /** Run `fn` with trailing-redirect capture disabled (see the field doc). */
  private withSuppressedTrailingRedirects<T>(fn: () => T): T {
    const prev = this.suppressTrailingRedirects;
    this.suppressTrailingRedirects = true;
    try {
      return fn();
    } finally {
      this.suppressTrailingRedirects = prev;
    }
  }

  /**
   * Re-enable trailing-redirect capture while parsing a nested statement
   * list, so redirects inside e.g. a coproc body still attach to the inner
   * compound they close.
   */
  private allowNestedTrailingRedirects<T>(fn: () => T): T {
    const prev = this.suppressTrailingRedirects;
    this.suppressTrailingRedirects = false;
    try {
      return fn();
    } finally {
      this.suppressTrailingRedirects = prev;
    }
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
    return this.allowNestedTrailingRedirects(() =>
      this.parseStatementListInner(left, endSymbol),
    );
  }

  private parseStatementListInner(
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
    if (head === "if") this.parseTrailingRedirects(node);
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
    const node: WhileClause = {
      type: "WhileClause",
      cond,
      body,
      pos: head.pos,
      end: done.end,
    };
    if (until) node.until = true;
    this.parseTrailingRedirects(node);
    return node;
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
    const node: ForClause = {
      type: "ForClause",
      name,
      body,
      pos: forTok.pos,
      end: done.end,
    };
    if (items) node.items = items;
    this.parseTrailingRedirects(node);
    return node;
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
    this.parseTrailingRedirects(loop);
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
    const node: SelectClause = {
      type: "SelectClause",
      name,
      body,
      pos: head.pos,
      end: done.end,
    };
    if (items) node.items = items;
    this.parseTrailingRedirects(node);
    return node;
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
      // Redirects after the body block belong to the FunctionDecl, not the
      // (inlined) Block, so capture them here.
      const block = this.withSuppressedTrailingRedirects(() =>
        this.parseBlock(),
      );
      const node: FunctionDecl = {
        type: "FunctionDecl",
        name,
        body: block.body,
        pos: startPos,
        end: block.end ?? startPos,
      };
      this.parseTrailingRedirects(node);
      return node;
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
    const node: CaseClause = {
      type: "CaseClause",
      word,
      items,
      pos: head.pos,
      end: esac.end,
    };
    this.parseTrailingRedirects(node);
    return node;
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
    const node: TestClause = {
      type: "TestClause",
      x,
      pos: open.pos,
      end: close.end,
    };
    this.parseTrailingRedirects(node);
    return node;
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
        const body = this.withSuppressedTrailingRedirects(() =>
          this.parseStatement(),
        );
        const node: CoprocClause = {
          type: "CoprocClause",
          name,
          body,
          pos: head.pos,
          end: body.end ?? head.end,
        };
        this.parseTrailingRedirects(node);
        return node;
      }
    }
    const body = this.withSuppressedTrailingRedirects(() =>
      this.parseStatement(),
    );
    const node: CoprocClause = {
      type: "CoprocClause",
      body,
      pos: head.pos,
      end: body.end ?? head.end,
    };
    this.parseTrailingRedirects(node);
    return node;
  }

  private parseCaseItemBody(): Statement[] {
    return this.allowNestedTrailingRedirects(() =>
      this.parseCaseItemBodyInner(),
    );
  }

  private parseCaseItemBodyInner(): Statement[] {
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
    return this.allowNestedTrailingRedirects(() =>
      this.parseStatementsUntilKeywordInner(left, endKeywords),
    );
  }

  private parseStatementsUntilKeywordInner(
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
    return (
      part?.type === "lit" &&
      part.escaped !== true &&
      DECL_KEYWORDS.has(part.value)
    );
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
        if (token?.type !== "word") break;

        const assignment = this.tryParseAssignment(token);
        if (assignment) {
          assigns.push(assignment);
          continue;
        }

        this.consume();
        const word = this.wordFromToken(token);
        args.push(
          ARITH_DECL_VARIANTS.has(variant)
            ? this.arithOperandWord(token, word)
            : word,
        );
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
        exprs.push(this.arithOperandWord(token, this.wordFromToken(token)));
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
        if (token?.type !== "word") {
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
      // The body token only exists after the newline ending this command
      // line, so queue the redirect; `drainPendingHeredocs` attaches the
      // body once it surfaces.
      this.pendingHeredocs.push(redirect);
    }
    return redirect;
  }

  /**
   * Attach tokenizer-emitted heredoc-body tokens to the redirects that
   * opened them, in opener order. Orphan body tokens (no pending redirect)
   * are left in the stream for the caller to report.
   */
  private drainPendingHeredocs(): void {
    while (
      this.peek()?.type === "heredoc-body" &&
      this.pendingHeredocs.length > 0
    ) {
      const redirect = this.pendingHeredocs.shift();
      if (!redirect) break;
      const bodyToken = this.consume();
      if (bodyToken.type !== "heredoc-body") break;
      // Contract token-api.md §4: bodies of unquoted delimiters arrive with
      // `expand: true`; parse them expansion-aware so embedded `$(...)` and
      // friends surface as structured parts.
      const parts =
        bodyToken.expand === true
          ? this.scanExpansionText(bodyToken.content, { base: bodyToken.pos })
          : undefined;
      redirect.heredoc = {
        type: "Word",
        parts:
          parts && parts.length > 0
            ? parts
            : [
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

  private convertWordPart(part: TokenWordPart, base?: Pos): WordPart {
    const anchor = (pos: Pos): Pos => (base ? rebasePos(pos, base) : pos);
    switch (part.type) {
      case "lit":
        return {
          type: "Literal",
          value: part.value,
          pos: anchor(part.pos),
          end: anchor(part.end),
        };
      case "sgl":
        return {
          type: "SglQuoted",
          value: part.value,
          pos: anchor(part.pos),
          end: anchor(part.end),
        };
      case "dbl":
        return {
          type: "DblQuoted",
          parts: part.parts.map((p) => this.convertWordPart(p, base)),
          pos: anchor(part.pos),
          end: anchor(part.end),
        };
      case "param":
        return this.convertParamExp(part, base);
      case "cmd-subst": {
        const node: CmdSubst = {
          type: "CmdSubst",
          stmts: this.parseSubstBody(part.raw, part, base),
          pos: anchor(part.pos),
          end: anchor(part.end),
        };
        substOpenLen.set(node, part.innerOffset - part.pos.offset);
        return node;
      }
      case "arith-exp": {
        const pos = anchor(part.pos);
        const x = parseArithmetic(part.raw, {
          offset: pos.offset + (part.innerOffset - part.pos.offset),
          line: pos.line,
          col: pos.col + 3,
        });
        if (!x) {
          throw new Error("Empty arithmetic expansion");
        }
        return {
          type: "ArithExp",
          x,
          pos,
          end: anchor(part.end),
        };
      }
      case "proc-subst": {
        const node: ProcSubst = {
          type: "ProcSubst",
          op: part.op,
          stmts: this.parseSubstBody(part.raw, part, base),
          pos: anchor(part.pos),
          end: anchor(part.end),
        };
        substOpenLen.set(node, part.innerOffset - part.pos.offset);
        return node;
      }
      case "backtick": {
        // `body` (contract token-api.md §3) is the backtick-decoded inner
        // text; fall back to the verbatim `raw` for pre-contract tokens.
        // The body starts right after the opening backtick.
        const inner = typeof part.body === "string" ? part.body : part.raw;
        const origin = { pos: part.pos, innerOffset: part.pos.offset + 1 };
        const node: CmdSubst = {
          type: "CmdSubst",
          stmts: this.parseSubstBody(inner, origin, base),
          pos: anchor(part.pos),
          end: anchor(part.end),
        };
        substOpenLen.set(node, 1);
        return node;
      }
      case "ansi-c":
        return {
          type: "AnsiC",
          value: decodeAnsiC(part.value),
          raw: part.value,
          pos: anchor(part.pos),
          end: anchor(part.end),
        };
      case "locale-str":
        return {
          type: "LocaleStr",
          parts: part.parts.map((p) => this.convertWordPart(p, base)),
          pos: anchor(part.pos),
          end: anchor(part.end),
        };
      case "ext-glob": {
        const node: ExtGlob = {
          type: "ExtGlob",
          op: part.op,
          pattern: part.pattern,
          pos: anchor(part.pos),
          end: anchor(part.end),
        };
        // Parse the pattern structurally so expansions inside it surface.
        // The pattern starts right after the two-character operator.
        const patternBase: Pos = {
          offset: part.pos.offset + 2,
          line: part.pos.line,
          col: part.pos.col + 2,
        };
        const word = this.wordFromShellSource(
          part.pattern,
          anchor(patternBase),
        );
        const single = word.parts[0];
        if (!(word.parts.length === 1 && single?.type === "Literal")) {
          node.word = word;
        }
        return node;
      }
    }
  }

  /**
   * Parse a substitution body (`$(...)`, `<(...)`, backticks). When `base`
   * is given, the part lives in a reparsed fragment and every descendant
   * position is anchored to the source; the body starts at `innerOffset`.
   */
  private parseSubstBody(
    raw: string,
    part: { pos: Pos; innerOffset: number },
    base: Pos | undefined,
  ): Statement[] {
    const innerTokens = tokenize(raw);
    const innerParser = new Parser(innerTokens);
    const prog = innerParser.parseProgram();
    if (base) {
      const bodyBase = rebasePos(
        {
          offset: part.innerOffset,
          line: part.pos.line,
          col: part.pos.col + (part.innerOffset - part.pos.offset),
        },
        base,
      );
      rebaseTree(prog.body, bodyBase);
    }
    return prog.body;
  }

  /**
   * Fold a raw source fragment (captured verbatim by the tokenizer, e.g. a
   * `${...}` operator operand or an extglob pattern) into a single Word by
   * re-tokenizing it. Expansions recover their structure; quotes merge back
   * into the literal text around them. When `base` is given, fragment
   * positions are anchored to the source.
   */
  private wordFromShellSource(raw: string, base?: Pos): Word {
    const tokens = tokenize(raw, this.options);
    const map = new SourceMap(raw);
    const parts: WordPart[] = [];
    const anchor = (pos?: Pos): Pos | undefined =>
      pos && base ? rebasePos(pos, base) : pos;
    // Re-tokenization splits the fragment at whitespace and other gaps;
    // restore the exact source text between consecutive tokens so the
    // folded word stays faithful to the fragment.
    let lastEnd = 0;
    const pushGap = (upto: number) => {
      if (upto <= lastEnd) return;
      pushLiteral(
        parts,
        raw.slice(lastEnd, upto),
        anchor(map.posAt(lastEnd)),
        anchor(map.posAt(upto)),
      );
    };
    for (const tok of tokens) {
      pushGap(tok.pos.offset);
      lastEnd = tok.end.offset;
      switch (tok.type) {
        case "word":
          for (const part of tok.parts) {
            if (part.type === "lit") {
              pushLiteral(
                parts,
                part.value,
                anchor(part.pos),
                anchor(part.end),
              );
            } else {
              parts.push(this.convertWordPart(part, base));
            }
          }
          break;
        case "op":
        case "symbol":
          pushLiteral(parts, tok.value, anchor(tok.pos), anchor(tok.end));
          break;
        case "redir":
          pushLiteral(
            parts,
            `${tok.fd ?? ""}${tok.op}`,
            anchor(tok.pos),
            anchor(tok.end),
          );
          break;
        case "comment":
          pushLiteral(parts, `#${tok.text}`, anchor(tok.pos), anchor(tok.end));
          break;
        default:
          // arith-cmd / heredoc-body cannot appear inside these fragments.
          break;
      }
    }
    pushGap(raw.length);
    return parts.length === 0 ? strToWord("") : { type: "Word", parts };
  }

  /**
   * Scan `text` for expansions only (no quote or word-splitting semantics):
   * `$name`, `${...}`, `$(...)`, `$((...))` and backticks become structured
   * parts; everything else stays literal. A backslash before `$`, `` ` `` or
   * `\` decodes to the literal character (heredoc-body rule). `escaped(i)`
   * marks characters that came from an escape-provenance literal part; they
   * never start an expansion.
   */
  private scanExpansionText(
    text: string,
    opts: { base?: Pos; escaped?: (index: number) => boolean } = {},
  ): WordPart[] {
    const map = new SourceMap(text);
    const escaped = opts.escaped ?? (() => false);
    const anchor = (pos: Pos): Pos | undefined =>
      opts.base ? rebasePos(pos, opts.base) : undefined;
    const parts: WordPart[] = [];
    let lit = "";
    let litStart = 0;
    let i = 0;
    const flushLit = (endOffset: number) => {
      if (lit.length === 0) return;
      pushLiteral(
        parts,
        lit,
        anchor(map.posAt(litStart)),
        anchor(map.posAt(endOffset)),
      );
      lit = "";
    };
    while (i < text.length) {
      const c = text.charAt(i);
      if (!escaped(i) && c === "\\" && i + 1 < text.length) {
        const n = text.charAt(i + 1);
        if (n === "$" || n === "`" || n === "\\") {
          if (lit.length === 0) litStart = i;
          lit += n;
          i += 2;
          continue;
        }
      }
      if (!escaped(i) && (c === "$" || c === "`")) {
        const scanned =
          c === "$"
            ? scanExpansion(text, i, map, this.options)
            : scanBacktick(text, i, map);
        if (scanned) {
          flushLit(i);
          parts.push(this.convertWordPart(scanned.part, opts.base));
          i = scanned.end;
          continue;
        }
      }
      if (lit.length === 0) litStart = i;
      lit += c;
      i += 1;
    }
    flushLit(text.length);
    return parts;
  }

  /**
   * Bash evaluates the indexed-assignment operands of `let` and
   * `declare`/`typeset`/`local` as arithmetic text, and array-subscript
   * evaluation expands `$(...)`/backticks even when the operand was quoted.
   * Rebuild such operands so the substitutions surface as structured parts;
   * other operands stay plain.
   */
  private arithOperandWord(token: Token & { type: "word" }, word: Word): Word {
    // Parts that are already structured surface substitutions already.
    if (!token.parts.every(isQuotablePart)) return word;
    const flat = token.parts.map(quotableText).join("");
    if (!/^[A-Za-z_][A-Za-z0-9_]*\[/.test(flat)) return word;
    const escapedSet = new Set<number>();
    let offset = 0;
    for (const part of token.parts) {
      const text = quotableText(part);
      if (part.type === "lit" && part.escaped === true) {
        for (let k = 0; k < text.length; k++) escapedSet.add(offset + k);
      }
      offset += text.length;
    }
    const scanned = this.scanExpansionText(flat, {
      escaped: (i) => escapedSet.has(i),
    });
    if (!scanned.some((p) => p.type !== "Literal")) return word;
    return { type: "Word", parts: scanned, pos: token.pos, end: token.end };
  }

  private convertParamExp(
    part: TokenWordPart & { type: "param" },
    base?: Pos,
  ): ParamExp {
    const anchor = (pos: Pos): Pos => (base ? rebasePos(pos, base) : pos);
    const pos = anchor(part.pos);
    const out: ParamExp = {
      type: "ParamExp",
      short: !part.braced,
      param: { type: "Literal", value: part.name },
      pos,
      end: anchor(part.end),
    };
    if (part.length) out.length = true;
    if (part.excl) out.excl = true;
    // Fragments (index/slice/replace/operator word) are verbatim substrings
    // of the `${...}` source; each starts right after its syntactic marker.
    // Track the source text from the expansion start so base positions
    // account for newlines inside earlier fragments.
    let prefix = part.braced ? "${" : "$";
    if (part.length) prefix += "#";
    if (part.excl) prefix += "!";
    prefix += part.name;
    const baseAfter = (text: string): Pos => absPos(pos, text, text.length);
    if (part.index !== undefined) {
      out.index = this.wordFromShellSource(part.index, baseAfter(`${prefix}[`));
      prefix += `[${part.index}]`;
    }
    if (part.slice) {
      const slice: ParamExp["slice"] = {
        offset: this.wordFromShellSource(
          part.slice.offset,
          baseAfter(`${prefix}:`),
        ),
      };
      if (part.slice.length !== undefined) {
        slice.length = this.wordFromShellSource(
          part.slice.length,
          baseAfter(`${prefix}:${part.slice.offset}:`),
        );
      }
      out.slice = slice;
    }
    if (part.replace) {
      const marker = `/${part.replace.all ? "/" : ""}${
        part.replace.prefix ? "#" : part.replace.suffix ? "%" : ""
      }`;
      const r: ParamExp["replace"] = {
        orig: this.wordFromShellSource(
          part.replace.orig,
          baseAfter(prefix + marker),
        ),
      };
      if (part.replace.with !== undefined)
        r.with = this.wordFromShellSource(
          part.replace.with,
          baseAfter(`${prefix + marker + part.replace.orig}/`),
        );
      if (part.replace.all) r.all = true;
      if (part.replace.prefix) r.prefix = true;
      if (part.replace.suffix) r.suffix = true;
      out.replace = r;
    }
    if (part.exp) {
      const exp: ParamExp["exp"] = {
        op: part.exp.op as ParamExpOp,
      };
      if (part.exp.value !== undefined)
        exp.word = this.wordFromShellSource(
          part.exp.value,
          baseAfter(prefix + part.exp.op),
        );
      out.exp = exp;
    }
    return out;
  }

  private wordFromToken(token: Token & { type: "word" }): Word {
    return {
      type: "Word",
      parts: mergeLiteralParts(
        token.parts.map((part) => this.convertWordPart(part)),
      ),
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
    // The NAME must be built from plain unescaped literals; the delimiter
    // (`=` or `+=`) must be an unescaped literal character. Anything else
    // (quoted text, escapes, expansions) before the delimiter means the
    // word is not an assignment, matching bash.
    let name = "";
    let append = false;
    let delimPartIdx = -1;
    let delimCharIdx = -1;
    for (let p = 0; p < parts.length; p++) {
      const part = parts[p];
      if (part?.type !== "lit" || part.escaped === true) {
        return undefined;
      }
      const eq = part.value.indexOf("=");
      if (eq === -1) {
        name += part.value;
        continue;
      }
      if (eq > 0 && part.value.charAt(eq - 1) === "+") {
        append = true;
        name += part.value.slice(0, eq - 1);
      } else {
        name += part.value.slice(0, eq);
      }
      delimPartIdx = p;
      delimCharIdx = eq;
      break;
    }
    if (delimPartIdx === -1) return undefined;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return undefined;

    const delimPart = parts[delimPartIdx] as TokenWordPart & { type: "lit" };
    const valueParts: TokenWordPart[] = [];
    const head = sliceLitPart(
      delimPart,
      delimCharIdx + 1,
      delimPart.value.length,
    );
    if (head) valueParts.push(head);
    valueParts.push(...parts.slice(delimPartIdx + 1));

    const nextToken = this.peekToken(1);
    if (
      valueParts.length === 0 &&
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
    if (valueParts.length > 0) {
      assignment.value = {
        type: "Word",
        parts: valueParts.map((p) => this.convertWordPart(p)),
        pos: valueParts[0]?.pos ?? token.pos,
        end: token.end,
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

      // Indexed element `[index]=value`: match the boundary on literal
      // text only, keeping structured index/value parts so expansions
      // like `[0$(cmd)]=$(cmd2)` stay visible (do not flatten with
      // tokenPartsText, which erases substitution parts).
      const split = splitIndexedArrayElem(token.parts);
      if (split) {
        const indexParts = split.index.map((p) => this.convertWordPart(p));
        const elem: ArrayElem = {
          type: "ArrayElem",
          index: {
            type: "Word",
            parts: indexParts,
            pos: indexParts[0]?.pos ?? token.pos,
            end: indexParts[indexParts.length - 1]?.end ?? token.end,
          },
          pos: token.pos,
          end: token.end,
        };
        if (split.value.length > 0) {
          const valueParts = split.value.map((p) => this.convertWordPart(p));
          elem.value = {
            type: "Word",
            parts: valueParts,
            pos: valueParts[0]?.pos ?? token.pos,
            end: valueParts[valueParts.length - 1]?.end ?? token.end,
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

  /**
   * Skip comments and line breaks between a binary operator (`&&`, `||`,
   * `|`) and the command continuing on the next line, e.g. `cmd && # note\n`
   * `next`. Bash accepts comments and blank lines inside an operator
   * continuation. Any heredoc bodies queued before those separators are
   * drained along the way. A literal `;` after the operator is not skipped,
   * so `cmd && ; next` still fails.
   */
  private skipOperatorContinuation() {
    while (true) {
      this.drainPendingHeredocs();
      if (this.matchComment()) {
        this.consumeComment();
        continue;
      }
      // Newline-derived `;` separators come from line breaks in the
      // continuation; a literal `;` carries no newline marker.
      const token = this.peek();
      if (token?.type === "op" && token.value === ";" && token.newline) {
        this.consume();
        continue;
      }
      break;
    }
  }

  private skipSeparators() {
    while (true) {
      // Newline separators are followed by any heredoc bodies queued on
      // the line that just ended; drain them to their redirects first.
      this.drainPendingHeredocs();
      if (this.matchOp(";")) {
        this.consume();
        continue;
      }
      if (this.matchComment()) {
        this.consumeComment();
        continue;
      }
      break;
    }
  }

  private skipCaseSeparators() {
    while (true) {
      this.drainPendingHeredocs();
      if (this.matchOp(";") && !this.peekOp(";")) {
        this.consume();
        continue;
      }
      break;
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
    // Escape-provenance literals never contribute to keyword matching.
    return (
      part?.type === "lit" && part.escaped !== true && part.value === value
    );
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
      token.parts[0].escaped === true ||
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
