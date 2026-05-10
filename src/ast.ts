export type ShellDialect = "posix" | "bash" | "mksh" | "zsh";

export type ParseOptions = {
  dialect?: ShellDialect;
  /** If true, keep comments as nodes/tokens in the output. */
  keepComments?: boolean;
  /** If true, do not throw on parse errors; collect them on the result. */
  recoverErrors?: boolean;
};

/** A position in the source. `offset` is 0-indexed bytes; `line`/`col` are 1-indexed. */
export type Pos = { offset: number; line: number; col: number };

/** Sentinel position used when a node is built outside the parser (e.g. test fixtures). */
export const NO_POS: Pos = { offset: 0, line: 0, col: 0 };

/**
 * All AST nodes carry source positions. They are typed as optional only so
 * fixtures and external code can build nodes ergonomically — the parser
 * always populates both fields.
 */
type Located = { pos?: Pos; end?: Pos };

export type Literal = Located & { type: "Literal"; value: string };
export type SglQuoted = Located & { type: "SglQuoted"; value: string };
export type DblQuoted = Located & { type: "DblQuoted"; parts: WordPart[] };
/**
 * Operator inside the `exp` of a ParamExp. Mirrors the set of
 * single/double-character ops supported by Bash and friends.
 *
 *   default/alt: -, :-, +, :+, =, :=, ?, :?
 *   pattern strip: #, ##, %, %%
 *   case mod: ^, ^^, ,, ,,
 *   transformation (Bash 4.4+): @U, @u, @L, @Q, @E, @P, @A, @K, @k, @a
 */
export type ParamExpOp =
  | "-"
  | ":-"
  | "+"
  | ":+"
  | "="
  | ":="
  | "?"
  | ":?"
  | "#"
  | "##"
  | "%"
  | "%%"
  | "^"
  | "^^"
  | ","
  | ",,"
  | "@U"
  | "@u"
  | "@L"
  | "@Q"
  | "@E"
  | "@P"
  | "@A"
  | "@K"
  | "@k"
  | "@a";

export type ParamExpExpansion = {
  op: ParamExpOp;
  word?: Word;
};

export type ParamExpSlice = {
  offset: Word;
  length?: Word;
};

export type ParamExpReplace = {
  /** True for `${var//pat/with}` (replace every match). */
  all?: boolean;
  /** True for `${var/#pat/with}` (anchor at start). */
  prefix?: boolean;
  /** True for `${var/%pat/with}` (anchor at end). */
  suffix?: boolean;
  orig: Word;
  with?: Word;
};

export type ParamExp = Located & {
  type: "ParamExp";
  /** True for the short form `$var`; false for `${var}`. */
  short: boolean;
  /** True for `${!var}` (indirect). */
  excl?: boolean;
  /** True for `${#var}` (string length). */
  length?: boolean;
  param: Literal;
  /** Index inside `[...]`, e.g. `${arr[0]}` or `${arr[@]}`. */
  index?: Word;
  slice?: ParamExpSlice;
  replace?: ParamExpReplace;
  exp?: ParamExpExpansion;
};
export type CmdSubst = Located & { type: "CmdSubst"; stmts: Statement[] };

/** A literal in arithmetic context (numeric or hex/octal). */
export type ArithLit = Located & { type: "ArithLit"; value: string };
/** Binary arithmetic operator. */
export type BinaryArithmOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "**"
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "&&"
  | "||"
  | "&"
  | "|"
  | "^"
  | "<<"
  | ">>"
  | "="
  | "+="
  | "-="
  | "*="
  | "/="
  | "%="
  | "**="
  | "&="
  | "|="
  | "^="
  | "<<="
  | ">>="
  | ","
  | "?"
  | ":";
/** Unary arithmetic operator. `post` distinguishes pre- and post-fix `++`/`--`. */
export type UnaryArithmOp = "+" | "-" | "!" | "~" | "++" | "--";
export type BinaryArithm = Located & {
  type: "BinaryArithm";
  op: BinaryArithmOp;
  x: ArithExpr;
  y: ArithExpr;
};
export type UnaryArithm = Located & {
  type: "UnaryArithm";
  op: UnaryArithmOp;
  /** True for postfix `i++`/`i--`. */
  post?: boolean;
  x: ArithExpr;
};
export type ParenArithm = Located & {
  type: "ParenArithm";
  x: ArithExpr;
};
/** An arithmetic expression: literal, variable expansion, parens, or operator. */
export type ArithExpr =
  | ArithLit
  | ParamExp
  | BinaryArithm
  | UnaryArithm
  | ParenArithm;
export type ArithExp = Located & { type: "ArithExp"; x: ArithExpr };
export type ProcSubst = Located & {
  type: "ProcSubst";
  op: "<" | ">";
  stmts: Statement[];
};
/**
 * A Bash brace expansion such as `{a,b}` or `{1..5}`. Only present after
 * calling `splitBraces` on a word — the parser does not produce these by
 * default, mirroring mvdan/sh's `SplitBraces`.
 */
export type BraceExp = Located & {
  type: "BraceExp";
  elems: Word[];
  /** True for sequences like `{1..5}`; false for lists like `{a,b}`. */
  sequence?: boolean;
};
/** The two-character open of an extended glob pattern. */
export type ExtGlobOp = "?(" | "*(" | "+(" | "@(" | "!(";
/**
 * A Bash extended glob like `@(foo|bar)`. The pattern is captured raw —
 * alternations and nested groups are part of the string. Only emitted
 * for Bash/mksh dialects.
 */
export type ExtGlob = Located & {
  type: "ExtGlob";
  op: ExtGlobOp;
  pattern: string;
};
export type WordPart =
  | Literal
  | SglQuoted
  | DblQuoted
  | ParamExp
  | CmdSubst
  | ArithExp
  | ProcSubst
  | BraceExp
  | ExtGlob;
export type Word = Located & { type: "Word"; parts: WordPart[] };
export type Assignment = Located & {
  type: "Assignment";
  name: string;
  append?: boolean;
  value?: Word;
  array?: ArrayExpr;
};
export type ArrayElem = Located & {
  type: "ArrayElem";
  index?: Word;
  value?: Word;
};
export type ArrayExpr = Located & { type: "ArrayExpr"; elems: ArrayElem[] };
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
export type Redirect = Located & {
  type: "Redirect";
  op: RedirOp;
  fd?: string;
  target: Word;
  heredoc?: Word;
};
export type SimpleCommand = Located & {
  type: "SimpleCommand";
  words?: Word[];
  assignments?: Assignment[];
  redirects?: Redirect[];
};
export type Subshell = Located & { type: "Subshell"; body: Statement[] };
export type Block = Located & { type: "Block"; body: Statement[] };
export type IfClause = Located & {
  type: "IfClause";
  cond: Statement[];
  then: Statement[];
  else?: Statement[];
};
export type WhileClause = Located & {
  type: "WhileClause";
  cond: Statement[];
  body: Statement[];
  until?: boolean;
};
export type ForClause = Located & {
  type: "ForClause";
  name: string;
  items?: Word[];
  body: Statement[];
};
export type SelectClause = Located & {
  type: "SelectClause";
  name: string;
  items?: Word[];
  body: Statement[];
};
export type FunctionDecl = Located & {
  type: "FunctionDecl";
  name: string;
  body: Statement[];
};
export type CaseItem = Located & {
  type: "CaseItem";
  patterns: Word[];
  body: Statement[];
};
export type CaseClause = Located & {
  type: "CaseClause";
  word: Word;
  items: CaseItem[];
};
export type TimeClause = Located & { type: "TimeClause"; command: Statement };
export type BinaryTestOp =
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "=~"
  | "&&"
  | "||"
  | "="
  | "-ef"
  | "-nt"
  | "-ot";

export type UnaryTestOp =
  | "!"
  | "-e"
  | "-f"
  | "-d"
  | "-r"
  | "-w"
  | "-x"
  | "-z"
  | "-n"
  | "-s"
  | "-a"
  | "-o"
  | "-S"
  | "-c"
  | "-b"
  | "-p"
  | "-h"
  | "-L"
  | "-N"
  | "-O"
  | "-G"
  | "-u"
  | "-g"
  | "-k"
  | "-t"
  | "-v"
  | "-R";

export type BinaryTest = Located & {
  type: "BinaryTest";
  op: BinaryTestOp;
  x: TestExpr;
  y: TestExpr;
};
export type UnaryTest = Located & {
  type: "UnaryTest";
  op: UnaryTestOp;
  x: TestExpr;
};
export type ParenTest = Located & { type: "ParenTest"; x: TestExpr };
export type TestExpr = BinaryTest | UnaryTest | ParenTest | Word;
export type TestClause = Located & { type: "TestClause"; x: TestExpr };
export type ArithCmd = Located & { type: "ArithCmd"; x: ArithExpr };
export type CoprocClause = Located & {
  type: "CoprocClause";
  name?: string;
  body: Statement;
};
export type DeclClause = Located & {
  type: "DeclClause";
  variant: "declare" | "local" | "export" | "readonly" | "typeset" | "nameref";
  args?: Word[];
  assigns?: Assignment[];
  redirects?: Redirect[];
};
export type LetClause = Located & {
  type: "LetClause";
  exprs: Word[];
  redirects?: Redirect[];
};
export type CStyleLoop = Located & {
  type: "CStyleLoop";
  init?: ArithExpr;
  cond?: ArithExpr;
  post?: ArithExpr;
  body: Statement[];
};
export type CommentNode = Located & { type: "Comment"; text: string };
export type Pipeline = Located & { type: "Pipeline"; commands: Statement[] };
export type Logical = Located & {
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
export type Statement = Located & {
  type: "Statement";
  command: Command;
  background?: boolean;
  negated?: boolean;
};
export type Program = Located & {
  type: "Program";
  body: Statement[];
  comments?: CommentNode[];
};

/** A non-fatal parse error retained when `recoverErrors` is enabled. */
export type ParseError = { message: string; pos: Pos };

export type ParseResult = {
  ast: Program;
  errors?: ParseError[];
};
