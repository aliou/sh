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

type OpTokenValue = "&&" | "||" | "|" | ";" | "&";

type Token =
  | { type: "word"; parts: string[] }
  | { type: "op"; value: OpTokenValue };

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
        operatorChars.has(currentChar)
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
      if (token.type !== "word") {
        throw new Error("Expected word token");
      }
      words.push({
        type: "Word",
        parts: token.parts.map((part) => ({ type: "Literal", value: part })),
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

  private matchOp(value: OpTokenValue) {
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
