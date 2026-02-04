import type {
  ArithCmd,
  ArrayElem,
  Assignment,
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
  ParseOptions,
  Program,
  Redirect,
  SelectClause,
  SimpleCommand,
  Statement,
  Subshell,
  TestClause,
  TimeClause,
  WhileClause,
  Word,
  WordPart,
} from "../ast";
import type {
  OpTokenValue,
  SymbolTokenValue,
  Token,
  TokenWordPart,
} from "../tokenizer";
import { tokenPartsText } from "../tokenizer";
import { tokenize } from "../tokenizer/tokenize";
import { DECL_KEYWORDS } from "./constants";

export class Parser {
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
