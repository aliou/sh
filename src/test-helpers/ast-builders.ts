import type {
  ArithCmd,
  ArithExp,
  ArrayElem,
  ArrayExpr,
  Assignment,
  Block,
  CaseClause,
  CaseItem,
  CmdSubst,
  Command,
  CoprocClause,
  CStyleLoop,
  DblQuoted,
  DeclClause,
  ForClause,
  FunctionDecl,
  IfClause,
  LetClause,
  Literal,
  ParamExp,
  Program,
  Redirect,
  RedirOp,
  SelectClause,
  SglQuoted,
  SimpleCommand,
  Statement,
  Subshell,
  TestClause,
  TimeClause,
  WhileClause,
  Word,
  WordPart,
} from "../ast";

export const lit = (value: string): Literal => ({ type: "Literal", value });
export const sgl = (value: string): SglQuoted => ({ type: "SglQuoted", value });
export const dbl = (...parts: WordPart[]): DblQuoted => ({
  type: "DblQuoted",
  parts,
});
export const paramExp = (
  name: string,
  short = true,
  op?: string,
  value?: string,
): ParamExp => {
  const p: ParamExp = {
    type: "ParamExp",
    short,
    param: lit(name),
  };
  if (op !== undefined) p.op = op;
  if (value !== undefined) p.value = { type: "Word", parts: [lit(value)] };
  return p;
};
export const cmdSubst = (...stmts: Statement[]): CmdSubst => ({
  type: "CmdSubst",
  stmts,
});
export const arithExp = (expr: string): ArithExp => ({
  type: "ArithExp",
  expr,
});
export const word = (value: string): Word => ({
  type: "Word",
  parts: [lit(value)],
});
export const wordParts = (...parts: WordPart[]): Word => ({
  type: "Word",
  parts,
});
export const simple = (...words: string[]): SimpleCommand => ({
  type: "SimpleCommand",
  words: words.map(word),
});
export const assign = (
  name: string,
  value?: string,
  opts?: { append?: boolean; array?: ArrayExpr },
): Assignment => {
  const a: Assignment = { type: "Assignment", name };
  if (opts?.append) a.append = true;
  if (value !== undefined) a.value = word(value);
  if (opts?.array) a.array = opts.array;
  return a;
};
export const arrayExpr = (...elems: ArrayElem[]): ArrayExpr => ({
  type: "ArrayExpr",
  elems,
});
export const arrayElem = (value?: string, index?: string): ArrayElem => {
  const e: ArrayElem = { type: "ArrayElem" };
  if (value !== undefined) e.value = word(value);
  if (index !== undefined) e.index = word(index);
  return e;
};
export const declClause = (
  variant: DeclClause["variant"],
  opts?: {
    args?: Word[];
    assigns?: Assignment[];
    redirects?: Redirect[];
  },
): DeclClause => {
  const d: DeclClause = { type: "DeclClause", variant };
  if (opts?.args) d.args = opts.args;
  if (opts?.assigns) d.assigns = opts.assigns;
  if (opts?.redirects) d.redirects = opts.redirects;
  return d;
};
export const letClause = (exprs: Word[], redirects?: Redirect[]): LetClause => {
  const l: LetClause = { type: "LetClause", exprs };
  if (redirects) l.redirects = redirects;
  return l;
};
export const cStyleLoop = (
  body: Statement[],
  init?: string,
  cond?: string,
  post?: string,
): CStyleLoop => {
  const c: CStyleLoop = { type: "CStyleLoop", body };
  if (init !== undefined) c.init = init;
  if (cond !== undefined) c.cond = cond;
  if (post !== undefined) c.post = post;
  return c;
};
export const redirect = (op: RedirOp, target: string, fd?: string): Redirect =>
  fd === undefined
    ? { type: "Redirect", op, target: word(target) }
    : { type: "Redirect", op, target: word(target), fd };
export const subshell = (...body: Statement[]): Subshell => ({
  type: "Subshell",
  body,
});
export const block = (...body: Statement[]): Block => ({
  type: "Block",
  body,
});
export const ifClause = (
  cond: Statement[],
  then: Statement[],
  elseBranch?: Statement[],
): IfClause =>
  elseBranch
    ? { type: "IfClause", cond, then, else: elseBranch }
    : { type: "IfClause", cond, then };
export const whileClause = (
  cond: Statement[],
  body: Statement[],
  until?: boolean,
): WhileClause =>
  until
    ? { type: "WhileClause", cond, body, until }
    : { type: "WhileClause", cond, body };
export const forClause = (
  name: string,
  body: Statement[],
  items?: Word[],
): ForClause =>
  items
    ? { type: "ForClause", name, items, body }
    : { type: "ForClause", name, body };
export const selectClause = (
  name: string,
  body: Statement[],
  items?: Word[],
): SelectClause =>
  items
    ? { type: "SelectClause", name, items, body }
    : { type: "SelectClause", name, body };
export const functionDecl = (
  name: string,
  body: Statement[],
): FunctionDecl => ({
  type: "FunctionDecl",
  name,
  body,
});
export const caseItem = (patterns: Word[], body: Statement[]): CaseItem => ({
  type: "CaseItem",
  patterns,
  body,
});
export const caseClause = (
  wordValue: string,
  items: CaseItem[],
): CaseClause => ({
  type: "CaseClause",
  word: word(wordValue),
  items,
});
export const testClause = (...words: Word[]): TestClause => ({
  type: "TestClause",
  expr: words,
});
export const arithCmd = (expr: string): ArithCmd => ({
  type: "ArithCmd",
  expr,
});
export const coprocClause = (body: Statement, name?: string): CoprocClause =>
  name ? { type: "CoprocClause", name, body } : { type: "CoprocClause", body };
export const timeClause = (command: Statement): TimeClause => ({
  type: "TimeClause",
  command,
});
export const stmt = (
  command: Command,
  background = false,
  negated = false,
): Statement => {
  const value: Statement = { type: "Statement", command };
  if (background) {
    value.background = true;
  }
  if (negated) {
    value.negated = true;
  }
  return value;
};
export const program = (...body: Statement[]): Program => ({
  type: "Program",
  body,
});
