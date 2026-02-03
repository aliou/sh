export type ShellDialect = "posix" | "bash" | "mksh" | "zsh";

export type ParseOptions = {
  dialect?: ShellDialect;
  /** If true, keep comments as nodes/tokens in the output (future). */
  keepComments?: boolean;
};

export type Literal = { type: "Literal"; value: string };
export type Word = { type: "Word"; parts: Literal[] };
export type Assignment = { type: "Assignment"; name: string; value?: Word };
export type Redirect = {
  type: "Redirect";
  op: ">" | "<" | ">>";
  fd?: string;
  target: Word;
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
  | Pipeline
  | Logical;
export type Statement = {
  type: "Statement";
  command: Command;
  background?: boolean;
};
export type Program = { type: "Program"; body: Statement[] };

export type ParseResult = {
  ast: Program;
};

type OpTokenValue = "&&" | "||" | "|" | ";" | "&";

type SymbolTokenValue = "(" | ")" | "{" | "}";

type Token =
  | { type: "word"; parts: string[] }
  | { type: "op"; value: OpTokenValue }
  | { type: "redir"; op: ">" | "<" | ">>"; fd?: string }
  | { type: "symbol"; value: SymbolTokenValue };

export function parse(
  source: string,
  _options: ParseOptions = {},
): ParseResult {
  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  const ast = parser.parseProgram();
  parser.assertEof();
  return { ast };
}

const operatorChars = new Set([";", "|", "&"]);
const redirChars = new Set([">", "<"]);
const symbolChars = new Set(["(", ")", "{", "}"]);

const isDigit = (value: string) => value >= "0" && value <= "9";

function tokenize(source: string): Token[] {
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
      continue;
    }

    if (ch === "#" && atBoundary) {
      i += 1;
      while (i < source.length && source.charAt(i) !== "\n") {
        i += 1;
      }
      continue;
    }

    if (isDigit(ch)) {
      let j = i;
      while (j < source.length && isDigit(source.charAt(j))) {
        j += 1;
      }
      const nextChar = source.charAt(j);
      if (nextChar === ">" || nextChar === "<") {
        const fd = source.slice(i, j);
        if (nextChar === ">" && source.charAt(j + 1) === ">") {
          tokens.push({ type: "redir", op: ">>", fd });
          i = j + 2;
        } else {
          tokens.push({ type: "redir", op: nextChar, fd });
          i = j + 1;
        }
        atBoundary = true;
        continue;
      }
    }

    if (ch === ">" || ch === "<") {
      if (ch === ">" && source.charAt(i + 1) === ">") {
        tokens.push({ type: "redir", op: ">>" });
        i += 2;
      } else {
        tokens.push({ type: "redir", op: ch });
        i += 1;
      }
      atBoundary = true;
      continue;
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

    const parts: string[] = [];
    let current = "";

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
        if (current.length > 0) {
          parts.push(current);
          current = "";
        }
        i += 1;
        const start = i;
        while (i < source.length && source.charAt(i) !== "'") {
          i += 1;
        }
        if (i >= source.length) {
          throw new Error("Unclosed single quote");
        }
        parts.push(source.slice(start, i));
        i += 1;
        continue;
      }

      if (currentChar === '"') {
        if (current.length > 0) {
          parts.push(current);
          current = "";
        }
        i += 1;
        let buffer = "";
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
            buffer += dqChar + source.charAt(i + 1);
            i += 2;
            continue;
          }
          if (dqChar === '"') {
            i += 1;
            closed = true;
            break;
          }
          buffer += dqChar;
          i += 1;
        }
        if (!closed) {
          throw new Error("Unclosed double quote");
        }
        parts.push(buffer);
        continue;
      }

      current += currentChar;
      i += 1;
    }

    if (current.length > 0) {
      parts.push(current);
    }

    if (parts.length === 0) {
      throw new Error("Unexpected character");
    }

    tokens.push({ type: "word", parts });
    atBoundary = false;
  }

  return tokens;
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parseProgram(): Program {
    const body: Statement[] = [];
    this.skipSeparators();
    while (!this.isEof()) {
      body.push(this.parseStatement());
      this.skipSeparators();
    }
    return { type: "Program", body };
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
              : token.parts.join("")
        : "";
      throw new Error(`Unexpected token: ${display}`);
    }
  }

  private parseStatement(): Statement {
    const command = this.parseLogical();
    let background = false;
    if (this.matchOp("&")) {
      this.consume();
      background = true;
    }
    return background
      ? { type: "Statement", command, background }
      : { type: "Statement", command };
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
      return this.parseForClause();
    }
    if (this.matchSymbol("(")) {
      return this.parseSubshell();
    }
    if (this.matchSymbol("{")) {
      return this.parseBlock();
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
    const thenBranch = this.parseStatementsUntilKeyword(["else", "fi"]);
    let elseBranch: Statement[] | undefined;
    if (this.matchKeyword("else")) {
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

  private parseForClause(): ForClause {
    this.consumeKeyword("for");
    const nameToken = this.consume();
    if (nameToken.type !== "word") {
      throw new Error("Expected loop variable name");
    }
    const name = nameToken.parts.join("");
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

  private parseSimpleCommand(): SimpleCommand {
    const words: Word[] = [];
    const assignments: Assignment[] = [];
    const redirects: Redirect[] = [];
    let sawWord = false;

    while (true) {
      if (this.matchWord()) {
        const token = this.consume();
        if (token.type !== "word") {
          throw new Error("Expected word token");
        }
        const word = this.wordFromParts(token.parts);
        const assignment = this.assignmentFromParts(token.parts);
        if (!sawWord && assignment) {
          assignments.push(assignment);
        } else {
          sawWord = true;
          words.push(word);
        }
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

  private wordFromParts(parts: string[]): Word {
    return {
      type: "Word",
      parts: parts.map((part) => ({ type: "Literal", value: part })),
    };
  }

  private assignmentFromParts(parts: string[]): Assignment | undefined {
    if (parts.length !== 1) {
      return undefined;
    }
    const raw = parts[0];
    if (!raw) {
      return undefined;
    }
    const eqIndex = raw.indexOf("=");
    if (eqIndex <= 0) {
      return undefined;
    }
    const name = raw.slice(0, eqIndex);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      return undefined;
    }
    const value = raw.slice(eqIndex + 1);
    return value.length === 0
      ? { type: "Assignment", name }
      : { type: "Assignment", name, value: this.wordFromParts([value]) };
  }

  private skipSeparators() {
    while (this.matchOp(";")) {
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
    return token?.type === "word" && token.parts.length === 1
      ? token.parts[0] === value
      : false;
  }

  private matchKeywordIn(values: string[]) {
    return values.some((value) => this.matchKeyword(value));
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
      token.parts[0] !== value
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

  private isEof() {
    return this.index >= this.tokens.length;
  }
}
