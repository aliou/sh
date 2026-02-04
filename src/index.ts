export type ShellDialect = "posix" | "bash" | "mksh" | "zsh";

export type ParseOptions = {
  dialect?: ShellDialect;
  /** If true, keep comments as nodes/tokens in the output (future). */
  keepComments?: boolean;
};

export type Literal = { type: "Literal"; value: string };
export type SglQuoted = { type: "SglQuoted"; value: string };
export type DblQuoted = { type: "DblQuoted"; parts: WordPart[] };
export type ParamExp = {
  type: "ParamExp";
  short: boolean;
  param: Literal;
  op?: string;
  value?: Word;
};
export type CmdSubst = { type: "CmdSubst"; stmts: Statement[] };
export type ArithExp = { type: "ArithExp"; expr: string };
export type ProcSubst = {
  type: "ProcSubst";
  op: "<" | ">";
  stmts: Statement[];
};
export type WordPart =
  | Literal
  | SglQuoted
  | DblQuoted
  | ParamExp
  | CmdSubst
  | ArithExp
  | ProcSubst;
export type Word = { type: "Word"; parts: WordPart[] };
export type Assignment = {
  type: "Assignment";
  name: string;
  append?: boolean;
  value?: Word;
  array?: ArrayExpr;
};
export type ArrayElem = { type: "ArrayElem"; index?: Word; value?: Word };
export type ArrayExpr = { type: "ArrayExpr"; elems: ArrayElem[] };
export type RedirOp =
  | ">"
  | "<"
  | ">>"
  | ">|"
  | ">&"
  | "<&"
  | "<>"
  | "&>"
  | "&>>"
  | "<<<"
  | "<<"
  | "<<-";
export type Redirect = {
  type: "Redirect";
  op: RedirOp;
  fd?: string;
  target: Word;
  heredoc?: Word;
};
export type SimpleCommand = {
  type: "SimpleCommand";
  words?: Word[];
  assignments?: Assignment[];
  redirects?: Redirect[];
};
export type Subshell = { type: "Subshell"; body: Statement[] };
export type Block = { type: "Block"; body: Statement[] };
export type IfClause = {
  type: "IfClause";
  cond: Statement[];
  then: Statement[];
  else?: Statement[];
};
export type WhileClause = {
  type: "WhileClause";
  cond: Statement[];
  body: Statement[];
  until?: boolean;
};
export type ForClause = {
  type: "ForClause";
  name: string;
  items?: Word[];
  body: Statement[];
};
export type SelectClause = {
  type: "SelectClause";
  name: string;
  items?: Word[];
  body: Statement[];
};
export type FunctionDecl = {
  type: "FunctionDecl";
  name: string;
  body: Statement[];
};
export type CaseItem = {
  type: "CaseItem";
  patterns: Word[];
  body: Statement[];
};
export type CaseClause = {
  type: "CaseClause";
  word: Word;
  items: CaseItem[];
};
export type TimeClause = { type: "TimeClause"; command: Statement };
export type TestClause = { type: "TestClause"; expr: Word[] };
export type ArithCmd = { type: "ArithCmd"; expr: string };
export type CoprocClause = {
  type: "CoprocClause";
  name?: string;
  body: Statement;
};
export type DeclClause = {
  type: "DeclClause";
  variant: "declare" | "local" | "export" | "readonly" | "typeset" | "nameref";
  args?: Word[];
  assigns?: Assignment[];
  redirects?: Redirect[];
};
export type LetClause = {
  type: "LetClause";
  exprs: Word[];
  redirects?: Redirect[];
};
export type CStyleLoop = {
  type: "CStyleLoop";
  init?: string;
  cond?: string;
  post?: string;
  body: Statement[];
};
export type CommentNode = { type: "Comment"; text: string };
export type Pipeline = { type: "Pipeline"; commands: Statement[] };
export type Logical = {
  type: "Logical";
  op: "and" | "or";
  left: Statement;
  right: Statement;
};
export type Command =
  | SimpleCommand
  | Subshell
  | Block
  | IfClause
  | WhileClause
  | ForClause
  | SelectClause
  | FunctionDecl
  | CaseClause
  | TimeClause
  | TestClause
  | ArithCmd
  | CoprocClause
  | Pipeline
  | Logical
  | DeclClause
  | LetClause
  | CStyleLoop;
export type Statement = {
  type: "Statement";
  command: Command;
  background?: boolean;
  negated?: boolean;
};
export type Program = {
  type: "Program";
  body: Statement[];
  comments?: CommentNode[];
};

export type ParseResult = {
  ast: Program;
};

type OpTokenValue = "&&" | "||" | "|" | ";" | "&" | "!";

type SymbolTokenValue = "(" | ")" | "{" | "}";

type TokenWordPart =
  | { type: "lit"; value: string }
  | { type: "sgl"; value: string }
  | { type: "dbl"; parts: TokenWordPart[] }
  | {
      type: "param";
      name: string;
      braced: boolean;
      op?: string;
      value?: string;
    }
  | { type: "cmd-subst"; raw: string }
  | { type: "arith-exp"; raw: string }
  | { type: "proc-subst"; op: "<" | ">"; raw: string }
  | { type: "backtick"; raw: string };

type Token =
  | { type: "word"; parts: TokenWordPart[] }
  | { type: "op"; value: OpTokenValue }
  | { type: "redir"; op: RedirOp; fd?: string }
  | { type: "symbol"; value: SymbolTokenValue }
  | { type: "arith-cmd"; expr: string }
  | { type: "heredoc-body"; content: string }
  | { type: "comment"; text: string };

export function parse(source: string, options: ParseOptions = {}): ParseResult {
  const tokens = tokenize(source, options);
  const parser = new Parser(tokens, options);
  const ast = parser.parseProgram();
  parser.assertEof();
  return { ast };
}

const operatorChars = new Set([";", "|", "&"]);
const redirChars = new Set([">", "<"]);
const symbolChars = new Set(["(", ")", "{", "}"]);

const isDigit = (value: string) => value >= "0" && value <= "9";

const isNameChar = (c: string) =>
  (c >= "a" && c <= "z") ||
  (c >= "A" && c <= "Z") ||
  (c >= "0" && c <= "9") ||
  c === "_";

const isNameStart = (c: string) =>
  (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";

const specialParams = new Set(["@", "*", "#", "?", "-", "$", "!"]);

function scanExpansion(
  source: string,
  pos: number,
): { part: TokenWordPart; end: number } | null {
  if (source.charAt(pos) !== "$") return null;
  const next = source.charAt(pos + 1);

  // $((expr)) arithmetic expansion
  if (next === "(" && source.charAt(pos + 2) === "(") {
    let j = pos + 3;
    let depth = 0;
    while (j < source.length) {
      if (
        source.charAt(j) === ")" &&
        source.charAt(j + 1) === ")" &&
        depth === 0
      )
        break;
      if (source.charAt(j) === "(") depth++;
      if (source.charAt(j) === ")") depth--;
      j++;
    }
    const expr = source.slice(pos + 3, j).trim();
    return { part: { type: "arith-exp", raw: expr }, end: j + 2 };
  }

  // $(cmd) command substitution
  if (next === "(") {
    let j = pos + 2;
    let depth = 1;
    while (j < source.length && depth > 0) {
      if (source.charAt(j) === "(") depth++;
      if (source.charAt(j) === ")") depth--;
      j++;
    }
    const raw = source.slice(pos + 2, j - 1);
    return { part: { type: "cmd-subst", raw }, end: j };
  }

  // ${...} braced parameter expansion
  if (next === "{") {
    let j = pos + 2;
    let depth = 1;
    while (j < source.length && depth > 0) {
      if (source.charAt(j) === "{") depth++;
      if (source.charAt(j) === "}") depth--;
      j++;
    }
    const inner = source.slice(pos + 2, j - 1);
    // Parse inner: name then optional op and value
    let nameEnd = 0;
    // Skip optional ! # prefix
    let prefix = "";
    if (inner.charAt(0) === "!" || inner.charAt(0) === "#") {
      prefix = inner.charAt(0);
      nameEnd = 1;
    }
    while (nameEnd < inner.length && isNameChar(inner.charAt(nameEnd))) {
      nameEnd++;
    }
    const name = inner.slice(prefix ? 1 : 0, nameEnd);
    const rest = inner.slice(nameEnd);
    if (rest.length > 0) {
      // Try to extract operator and value
      const opMatch = rest.match(
        /^(:-|:=|:\+|:\?|-|\+|=|\?|##|%%|#|%|\/\/|\/)/,
      );
      if (opMatch) {
        const op = opMatch[0];
        const value = rest.slice(op.length);
        return {
          part: { type: "param", name, braced: true, op, value },
          end: j,
        };
      }
      // Slice or other complex syntax - store as name with rest
      return {
        part: {
          type: "param",
          name: inner,
          braced: true,
        },
        end: j,
      };
    }
    return { part: { type: "param", name, braced: true }, end: j };
  }

  // $name or $N or $@ etc
  if (isNameStart(next)) {
    let j = pos + 2;
    while (j < source.length && isNameChar(source.charAt(j))) {
      j++;
    }
    const name = source.slice(pos + 1, j);
    return { part: { type: "param", name, braced: false }, end: j };
  }
  if (isDigit(next)) {
    return {
      part: { type: "param", name: next, braced: false },
      end: pos + 2,
    };
  }
  if (specialParams.has(next)) {
    return {
      part: { type: "param", name: next, braced: false },
      end: pos + 2,
    };
  }

  return null;
}

function scanBacktick(
  source: string,
  pos: number,
): { part: TokenWordPart; end: number } {
  let j = pos + 1;
  while (j < source.length && source.charAt(j) !== "`") {
    if (source.charAt(j) === "\\") j++;
    j++;
  }
  const raw = source.slice(pos + 1, j);
  return { part: { type: "backtick", raw }, end: j + 1 };
}

function tryRedirOp(
  source: string,
  pos: number,
): { op: RedirOp; len: number } | null {
  if (source.startsWith("<<<", pos)) return { op: "<<<", len: 3 };
  if (source.startsWith("&>>", pos)) return { op: "&>>", len: 3 };
  if (source.startsWith("<<-", pos)) return { op: "<<-", len: 3 };
  if (source.startsWith(">>", pos)) return { op: ">>", len: 2 };
  if (source.startsWith(">&", pos)) return { op: ">&", len: 2 };
  if (source.startsWith(">|", pos)) return { op: ">|", len: 2 };
  if (source.startsWith("<>", pos)) return { op: "<>", len: 2 };
  if (source.startsWith("<&", pos)) return { op: "<&", len: 2 };
  if (source.startsWith("&>", pos)) return { op: "&>", len: 2 };
  if (source.startsWith("<<", pos)) return { op: "<<", len: 2 };
  if (source.charAt(pos) === ">") return { op: ">", len: 1 };
  if (source.charAt(pos) === "<") return { op: "<", len: 1 };
  return null;
}

function tokenize(source: string, options: ParseOptions = {}): Token[] {
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
          body += processedLine + "\n";
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

function tokenPartsText(parts: TokenWordPart[]): string {
  return parts
    .map((p) => {
      if (p.type === "lit") return p.value;
      if (p.type === "sgl") return p.value;
      if (p.type === "dbl")
        return p.parts
          .map((dp) => (dp.type === "lit" ? dp.value : ""))
          .join("");
      return "";
    })
    .join("");
}

const DECL_KEYWORDS = new Set([
  "declare",
  "local",
  "export",
  "readonly",
  "typeset",
  "nameref",
]);

class Parser {
  private index = 0;
  private comments: CommentNode[] = [];

  constructor(
    private readonly tokens: Token[],
    private readonly options: ParseOptions = {},
  ) {}

  parseProgram(): Program {
    const body: Statement[] = [];
    this.skipSeparators();
    while (!this.isEof()) {
      body.push(this.parseStatement());
      this.skipSeparators();
    }
    const program: Program = { type: "Program", body };
    if (this.options.keepComments && this.comments.length > 0) {
      program.comments = this.comments;
    }
    return program;
  }

  assertEof() {
    if (!this.isEof()) {
      const token = this.peek();
      const display = token
        ? token.type === "op"
          ? token.value
          : token.type === "redir"
            ? token.op
            : token.type === "symbol"
              ? token.value
              : token.type === "arith-cmd"
                ? "(( ... ))"
                : token.type === "heredoc-body"
                  ? "<<heredoc>>"
                  : token.type === "comment"
                    ? `#${token.text}`
                    : tokenPartsText(token.parts)
        : "";
      throw new Error(`Unexpected token: ${display}`);
    }
  }

  private parseStatement(): Statement {
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
    const statement: Statement = { type: "Statement", command };
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
      leftCommand = {
        type: "Logical",
        op: opToken.value === "&&" ? "and" : "or",
        left: { type: "Statement", command: leftCommand },
        right: { type: "Statement", command: rightCommand },
      };
    }
    return leftCommand;
  }

  private parsePipeline(): Command {
    const first = this.parseCommandAtom();
    if (!this.matchOp("|")) {
      return first;
    }

    const commands: Statement[] = [{ type: "Statement", command: first }];
    while (this.matchOp("|")) {
      this.consume();
      const next = this.parseCommandAtom();
      commands.push({ type: "Statement", command: next });
    }
    return { type: "Pipeline", commands };
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
    this.consumeSymbol("(");
    const body = this.parseStatementList(")");
    this.consumeSymbol(")");
    return { type: "Subshell", body };
  }

  private parseBlock(): Block {
    this.consumeSymbol("{");
    const body = this.parseStatementList("}");
    this.consumeSymbol("}");
    return { type: "Block", body };
  }

  private parseStatementList(endSymbol: SymbolTokenValue): Statement[] {
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
    return body;
  }

  private parseIfClause(): IfClause {
    this.consumeKeyword("if");
    const cond = this.parseStatementsUntilKeyword(["then"]);
    this.consumeKeyword("then");
    const thenBranch = this.parseStatementsUntilKeyword(["else", "elif", "fi"]);
    let elseBranch: Statement[] | undefined;
    if (this.matchKeyword("elif")) {
      elseBranch = [
        {
          type: "Statement",
          command: this.parseElifClause(),
        },
      ];
    } else if (this.matchKeyword("else")) {
      this.consumeKeyword("else");
      elseBranch = this.parseStatementsUntilKeyword(["fi"]);
    }
    this.consumeKeyword("fi");
    return elseBranch
      ? {
          type: "IfClause",
          cond,
          // biome-ignore lint/suspicious/noThenProperty: shell AST field
          then: thenBranch,
          else: elseBranch,
        }
      : {
          type: "IfClause",
          cond,
          // biome-ignore lint/suspicious/noThenProperty: shell AST field
          then: thenBranch,
        };
  }

  private parseElifClause(): IfClause {
    this.consumeKeyword("elif");
    const cond = this.parseStatementsUntilKeyword(["then"]);
    this.consumeKeyword("then");
    const thenBranch = this.parseStatementsUntilKeyword(["else", "elif", "fi"]);
    let elseBranch: Statement[] | undefined;
    if (this.matchKeyword("elif")) {
      elseBranch = [
        {
          type: "Statement",
          command: this.parseElifClause(),
        },
      ];
    } else if (this.matchKeyword("else")) {
      this.consumeKeyword("else");
      elseBranch = this.parseStatementsUntilKeyword(["fi"]);
    }
    return elseBranch
      ? {
          type: "IfClause",
          cond,
          // biome-ignore lint/suspicious/noThenProperty: shell AST field
          then: thenBranch,
          else: elseBranch,
        }
      : {
          type: "IfClause",
          cond,
          // biome-ignore lint/suspicious/noThenProperty: shell AST field
          then: thenBranch,
        };
  }

  private parseWhileClause(until: boolean): WhileClause {
    this.consumeKeyword(until ? "until" : "while");
    const cond = this.parseStatementsUntilKeyword(["do"]);
    this.consumeKeyword("do");
    const body = this.parseStatementsUntilKeyword(["done"]);
    this.consumeKeyword("done");
    return until
      ? { type: "WhileClause", cond, body, until: true }
      : { type: "WhileClause", cond, body };
  }

  private parseForOrCStyleLoop(): ForClause | CStyleLoop {
    this.consumeKeyword("for");

    // C-style: for (( init; cond; post ))
    if (this.matchArithCmd()) {
      return this.parseCStyleLoop();
    }

    const nameToken = this.consume();
    if (nameToken.type !== "word") {
      throw new Error("Expected loop variable name");
    }
    const name = tokenPartsText(nameToken.parts);
    let items: Word[] | undefined;
    if (this.matchKeyword("in")) {
      this.consumeKeyword("in");
      const collected: Word[] = [];
      while (this.matchWord() && !this.matchKeyword("do")) {
        const itemToken = this.consume();
        if (itemToken.type !== "word") {
          throw new Error("Expected loop item word");
        }
        collected.push(this.wordFromParts(itemToken.parts));
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
    const body = this.parseStatementsUntilKeyword(["done"]);
    this.consumeKeyword("done");
    return items
      ? { type: "ForClause", name, items, body }
      : { type: "ForClause", name, body };
  }

  private parseCStyleLoop(): CStyleLoop {
    const token = this.consume();
    if (token.type !== "arith-cmd") {
      throw new Error("Expected (( )) in c-style for");
    }
    // Split expr on ";" into init, cond, post
    const parts = token.expr.split(";").map((s) => s.trim());
    const init = parts[0] || undefined;
    const cond = parts[1] || undefined;
    const post = parts[2] || undefined;

    if (this.matchOp(";")) {
      this.consume();
    }
    this.skipSeparators();
    this.consumeKeyword("do");
    const body = this.parseStatementsUntilKeyword(["done"]);
    this.consumeKeyword("done");
    const loop: CStyleLoop = { type: "CStyleLoop", body };
    if (init !== undefined) loop.init = init;
    if (cond !== undefined) loop.cond = cond;
    if (post !== undefined) loop.post = post;
    return loop;
  }

  private parseSelectClause(): SelectClause {
    this.consumeKeyword("select");
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
        collected.push(this.wordFromParts(itemToken.parts));
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
    const body = this.parseStatementsUntilKeyword(["done"]);
    this.consumeKeyword("done");
    return items
      ? { type: "SelectClause", name, items, body }
      : { type: "SelectClause", name, body };
  }

  private parseFunctionDecl(): FunctionDecl {
    if (this.matchKeyword("function")) {
      this.consumeKeyword("function");
    }
    const nameToken = this.consume();
    if (nameToken.type !== "word") {
      throw new Error("Expected function name");
    }
    const name = tokenPartsText(nameToken.parts);
    if (this.matchSymbol("(")) {
      this.consumeSymbol("(");
      this.consumeSymbol(")");
    }
    if (this.matchSymbol("{")) {
      const body = this.parseBlock().body;
      return { type: "FunctionDecl", name, body };
    }
    throw new Error("Expected function body block");
  }

  private parseCaseClause(): CaseClause {
    this.consumeKeyword("case");
    const wordToken = this.consume();
    if (wordToken.type !== "word") {
      throw new Error("Expected case word");
    }
    const word = this.wordFromParts(wordToken.parts);
    this.consumeKeyword("in");
    const items: CaseItem[] = [];
    this.skipSeparators();
    while (!this.matchKeyword("esac")) {
      const patterns: Word[] = [];
      while (!this.matchSymbol(")")) {
        if (this.matchWord()) {
          const patternToken = this.consume();
          if (patternToken.type !== "word") {
            throw new Error("Expected case pattern");
          }
          patterns.push(this.wordFromParts(patternToken.parts));
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
      items.push({ type: "CaseItem", patterns, body });
      if (this.matchOp(";") && this.peekOp(";")) {
        this.consume();
        this.consume();
      }
      this.skipSeparators();
    }
    this.consumeKeyword("esac");
    return { type: "CaseClause", word, items };
  }

  private parseTimeClause(): TimeClause {
    this.consumeKeyword("time");
    const command = this.parseStatement();
    return { type: "TimeClause", command };
  }

  private parseTestClause(): TestClause {
    this.consumeKeyword("[[");
    const words: Word[] = [];
    while (!this.matchKeyword("]]")) {
      if (this.isEof()) throw new Error("Unclosed [[");
      const token = this.consume();
      if (token.type !== "word") throw new Error("Expected word in [[ ]]");
      words.push(this.wordFromParts(token.parts));
    }
    this.consumeKeyword("]]");
    return { type: "TestClause", expr: words };
  }

  private matchArithCmd(): boolean {
    return this.peek()?.type === "arith-cmd";
  }

  private consumeArithCmd(): ArithCmd {
    const token = this.consume();
    if (token.type !== "arith-cmd")
      throw new Error("Expected arithmetic command");
    return { type: "ArithCmd", expr: token.expr };
  }

  private parseCoprocClause(): CoprocClause {
    this.consumeKeyword("coproc");
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
        return { type: "CoprocClause", name, body };
      }
    }
    const body = this.parseStatement();
    return { type: "CoprocClause", body };
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

  private parseStatementsUntilKeyword(endKeywords: string[]): Statement[] {
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

    const args: Word[] = [];
    const assigns: Assignment[] = [];
    const redirects: Redirect[] = [];

    while (true) {
      if (this.matchRedir()) {
        const token = this.consume();
        if (token.type !== "redir") {
          throw new Error("Expected redirect token");
        }
        const targetToken = this.consume();
        if (targetToken.type !== "word") {
          throw new Error("Redirect must be followed by a word");
        }
        const target = this.wordFromParts(targetToken.parts);
        const redir: Redirect = token.fd
          ? { type: "Redirect", op: token.op, fd: token.fd, target }
          : { type: "Redirect", op: token.op, target };
        redirects.push(redir);
        continue;
      }

      if (this.matchWord()) {
        const token = this.peek();
        if (!token || token.type !== "word") break;

        // tryParseAssignment consumes tokens itself if it matches
        const assignment = this.tryParseAssignment(token.parts);
        if (assignment) {
          assigns.push(assignment);
          continue;
        }

        // Otherwise it's a plain arg (flag or name)
        this.consume();
        args.push(this.wordFromParts(token.parts));
        continue;
      }

      break;
    }

    const decl: DeclClause = { type: "DeclClause", variant };
    if (args.length > 0) decl.args = args;
    if (assigns.length > 0) decl.assigns = assigns;
    if (redirects.length > 0) decl.redirects = redirects;
    return decl;
  }

  private parseLetClause(): LetClause {
    this.consumeKeyword("let");
    const exprs: Word[] = [];
    const redirects: Redirect[] = [];

    while (true) {
      if (this.matchRedir()) {
        const token = this.consume();
        if (token.type !== "redir") {
          throw new Error("Expected redirect token");
        }
        const targetToken = this.consume();
        if (targetToken.type !== "word") {
          throw new Error("Redirect must be followed by a word");
        }
        const target = this.wordFromParts(targetToken.parts);
        const redir: Redirect = token.fd
          ? { type: "Redirect", op: token.op, fd: token.fd, target }
          : { type: "Redirect", op: token.op, target };
        redirects.push(redir);
        continue;
      }

      if (this.matchWord()) {
        const token = this.consume();
        if (token.type !== "word") break;
        exprs.push(this.wordFromParts(token.parts));
        continue;
      }

      break;
    }

    if (exprs.length === 0) {
      throw new Error("let requires at least one expression");
    }

    const clause: LetClause = { type: "LetClause", exprs };
    if (redirects.length > 0) clause.redirects = redirects;
    return clause;
  }

  private parseSimpleCommand(): SimpleCommand {
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

        // tryParseAssignment consumes tokens itself if it matches
        if (!sawWord) {
          const assignment = this.tryParseAssignment(token.parts);
          if (assignment) {
            assignments.push(assignment);
            continue;
          }
        }

        this.consume();
        sawWord = true;
        words.push(this.wordFromParts(token.parts));
        continue;
      }

      if (this.matchRedir()) {
        const token = this.consume();
        if (token.type !== "redir") {
          throw new Error("Expected redirect token");
        }
        const targetToken = this.consume();
        if (targetToken.type !== "word") {
          throw new Error("Redirect must be followed by a word");
        }
        const target = this.wordFromParts(targetToken.parts);
        const redirect: Redirect = token.fd
          ? { type: "Redirect", op: token.op, fd: token.fd, target }
          : { type: "Redirect", op: token.op, target };
        // Collect heredoc body if this is a heredoc redirect
        if (token.op === "<<" || token.op === "<<-") {
          // Skip separators to find the heredoc-body token
          this.skipSeparators();
          if (this.peek()?.type === "heredoc-body") {
            const bodyToken = this.consume();
            if (bodyToken.type === "heredoc-body") {
              redirect.heredoc = {
                type: "Word",
                parts: [{ type: "Literal", value: bodyToken.content }],
              };
            }
          }
        }
        redirects.push(redirect);
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

    const command: SimpleCommand = { type: "SimpleCommand" };
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

  private convertWordPart(part: TokenWordPart): WordPart {
    switch (part.type) {
      case "lit":
        return { type: "Literal", value: part.value };
      case "sgl":
        return { type: "SglQuoted", value: part.value };
      case "dbl":
        return {
          type: "DblQuoted",
          parts: part.parts.map((p) => this.convertWordPart(p)),
        };
      case "param": {
        const paramExp: ParamExp = {
          type: "ParamExp",
          short: !part.braced,
          param: { type: "Literal", value: part.name },
        };
        if (part.op) {
          paramExp.op = part.op;
        }
        if (part.value !== undefined) {
          paramExp.value = {
            type: "Word",
            parts: [{ type: "Literal", value: part.value }],
          };
        }
        return paramExp;
      }
      case "cmd-subst": {
        const innerTokens = tokenize(part.raw);
        const innerParser = new Parser(innerTokens);
        const prog = innerParser.parseProgram();
        return { type: "CmdSubst", stmts: prog.body };
      }
      case "arith-exp":
        return { type: "ArithExp", expr: part.raw };
      case "proc-subst": {
        const innerTokens = tokenize(part.raw);
        const innerParser = new Parser(innerTokens);
        const prog = innerParser.parseProgram();
        return { type: "ProcSubst", op: part.op, stmts: prog.body };
      }
      case "backtick": {
        const innerTokens = tokenize(part.raw);
        const innerParser = new Parser(innerTokens);
        const prog = innerParser.parseProgram();
        return { type: "CmdSubst", stmts: prog.body };
      }
    }
  }

  private wordFromParts(parts: TokenWordPart[]): Word {
    return {
      type: "Word",
      parts: parts.map((part) => this.convertWordPart(part)),
    };
  }

  /**
   * Try to parse an assignment from the current token's parts.
   * If it returns an assignment, it has already consumed all relevant tokens
   * (the word, and optionally the array `(...)` symbols).
   * If it returns undefined, nothing was consumed.
   */
  private tryParseAssignment(parts: TokenWordPart[]): Assignment | undefined {
    if (parts.length !== 1) return undefined;
    const part = parts[0];
    if (!part || part.type !== "lit") return undefined;
    const raw = part.value;

    // Detect NAME= or NAME+=
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

    // Check for array assignment: NAME=( ... ) or NAME+=( ... )
    const nextToken = this.peekToken(1);
    if (
      afterEq === "" &&
      nextToken?.type === "symbol" &&
      (nextToken as { value: string }).value === "("
    ) {
      this.consume(); // consume the NAME= word
      return this.parseArrayAssignment(name, append);
    }

    // Consume the word token
    this.consume();

    const assignment: Assignment = { type: "Assignment", name };
    if (append) assignment.append = true;
    if (afterEq.length > 0) {
      assignment.value = {
        type: "Word",
        parts: [{ type: "Literal", value: afterEq }],
      };
    }
    return assignment;
  }

  private parseArrayAssignment(name: string, append: boolean): Assignment {
    this.consumeSymbol("(");
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
          value: this.wordFromParts(token.parts),
        });
      }
    }

    this.consumeSymbol(")");

    const assignment: Assignment = {
      type: "Assignment",
      name,
      array: { type: "ArrayExpr", elems },
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

  private consumeSymbol(value: SymbolTokenValue) {
    const token = this.consume();
    if (token.type !== "symbol" || token.value !== value) {
      throw new Error(`Expected symbol ${value}`);
    }
  }

  private consumeKeyword(value: string) {
    const token = this.consume();
    if (
      token.type !== "word" ||
      token.parts.length !== 1 ||
      token.parts[0]?.type !== "lit" ||
      token.parts[0].value !== value
    ) {
      throw new Error(`Expected keyword ${value}`);
    }
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
      this.comments.push({ type: "Comment", text: token.text });
    }
  }

  private isEof() {
    return this.index >= this.tokens.length;
  }
}
