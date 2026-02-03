export type ShellDialect = "posix" | "bash" | "mksh" | "zsh";

export type ParseOptions = {
  dialect?: ShellDialect;
  /** If true, keep comments as nodes/tokens in the output (future). */
  keepComments?: boolean;
};

export type Literal = { type: "Literal"; value: string };
export type Word = { type: "Word"; parts: Literal[] };
export type SimpleCommand = { type: "SimpleCommand"; words: Word[] };
export type Pipeline = { type: "Pipeline"; commands: Statement[] };
export type Logical = {
  type: "Logical";
  op: "and" | "or";
  left: Statement;
  right: Statement;
};
export type Command = SimpleCommand | Pipeline | Logical;
export type Statement = {
  type: "Statement";
  command: Command;
  background?: boolean;
};
export type Program = { type: "Program"; body: Statement[] };

export type ParseResult = {
  ast: Program;
};

type Token =
  | { type: "word"; value: string }
  | { type: "op"; value: "&&" | "||" | "|" | ";" | "&" };

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

    if (ch === "\n") {
      tokens.push({ type: "op", value: ";" });
      atBoundary = true;
      i += 1;
      continue;
    }

    if (ch === "#" && atBoundary) {
      i += 1;
      while (i < source.length && source[i] !== "\n") {
        i += 1;
      }
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

    const start = i;
    while (i < source.length) {
      const current = source.charAt(i);
      if (
        current === " " ||
        current === "\t" ||
        current === "\r" ||
        current === "\n" ||
        operatorChars.has(current)
      ) {
        break;
      }
      i += 1;
    }

    const value = source.slice(start, i);
    if (value.length === 0) {
      throw new Error("Unexpected character");
    }
    tokens.push({ type: "word", value });
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
      throw new Error(`Unexpected token: ${this.peek()?.value ?? ""}`);
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
    const first = this.parseSimpleCommand();
    if (!this.matchOp("|")) {
      return first;
    }

    const commands: Statement[] = [{ type: "Statement", command: first }];
    while (this.matchOp("|")) {
      this.consume();
      const next = this.parseSimpleCommand();
      commands.push({ type: "Statement", command: next });
    }
    return { type: "Pipeline", commands };
  }

  private parseSimpleCommand(): SimpleCommand {
    const words: Word[] = [];
    while (this.matchWord()) {
      const token = this.consume();
      words.push({
        type: "Word",
        parts: [{ type: "Literal", value: token.value }],
      });
    }

    if (words.length === 0) {
      throw new Error("Expected a command word");
    }

    return { type: "SimpleCommand", words };
  }

  private skipSeparators() {
    while (this.matchOp(";")) {
      this.consume();
    }
  }

  private matchOp(value: Token["value"]) {
    const token = this.peek();
    return token?.type === "op" && token.value === value;
  }

  private matchWord() {
    return this.peek()?.type === "word";
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
