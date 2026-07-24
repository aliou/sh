import {
  type ArithCmd,
  type ArithExp,
  type ArrayElem,
  type ArrayExpr,
  type Assignment,
  type Block,
  type CaseClause,
  type CaseItem,
  type CmdSubst,
  type Command,
  type CoprocClause,
  type CStyleLoop,
  type DblQuoted,
  type DeclClause,
  type ForClause,
  type FunctionDecl,
  type IfClause,
  type LetClause,
  type Literal,
  NO_POS,
  type ParamExp,
  type Program,
  type Redirect,
  type RedirOp,
  type SelectClause,
  type SglQuoted,
  type SimpleCommand,
  type Statement,
  type Subshell,
  type TestClause,
  type TimeClause,
  type WhileClause,
  type Word,
  type WordPart,
} from "../ast";

type ParamOp = NonNullable<ParamExp["exp"]>["op"];

/** Sentinel positions for hand-built nodes; `toMatchAst` strips them. */
const P = { pos: NO_POS, end: NO_POS };

export const lit = (value: string): Literal => ({
  type: "Literal",
  value,
  ...P,
});
export const sgl = (value: string): SglQuoted => ({
  type: "SglQuoted",
  value,
  ...P,
});
export const dbl = (...parts: WordPart[]): DblQuoted => ({
  type: "DblQuoted",
  parts,
  ...P,
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
    ...P,
  };
  if (op !== undefined) {
    p.exp = { op: op as ParamOp };
    if (value !== undefined) {
      p.exp.word = { type: "Word", parts: [lit(value)], ...P };
    }
  }
  return p;
};
export const cmdSubst = (...stmts: Statement[]): CmdSubst => ({
  type: "CmdSubst",
  stmts,
  ...P,
});
export const arithExp = (value: string): ArithExp => ({
  type: "ArithExp",
  x: { type: "ArithLit", value, ...P },
  ...P,
});
export const word = (value: string): Word => ({
  type: "Word",
  parts: [lit(value)],
  ...P,
});
export const wordParts = (...parts: WordPart[]): Word => ({
  type: "Word",
  parts,
  ...P,
});
export const simple = (...words: string[]): SimpleCommand => ({
  type: "SimpleCommand",
  words: words.map(word),
  ...P,
});
export const assign = (
  name: string,
  value?: string,
  opts?: { append?: boolean; array?: ArrayExpr },
): Assignment => {
  const a: Assignment = { type: "Assignment", name, ...P };
  if (opts?.append) a.append = true;
  if (value !== undefined) a.value = word(value);
  if (opts?.array) a.array = opts.array;
  return a;
};
export const arrayExpr = (...elems: ArrayElem[]): ArrayExpr => ({
  type: "ArrayExpr",
  elems,
  ...P,
});
export const arrayElem = (value?: string, index?: string): ArrayElem => {
  const e: ArrayElem = { type: "ArrayElem", ...P };
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
  const d: DeclClause = { type: "DeclClause", variant, ...P };
  if (opts?.args) d.args = opts.args;
  if (opts?.assigns) d.assigns = opts.assigns;
  if (opts?.redirects) d.redirects = opts.redirects;
  return d;
};
export const letClause = (exprs: Word[], redirects?: Redirect[]): LetClause => {
  const l: LetClause = { type: "LetClause", exprs, ...P };
  if (redirects) l.redirects = redirects;
  return l;
};
/**
 * Build a CStyleLoop. Each clause is a raw arithmetic literal value (e.g.
 * `"i = 0"`); pass `undefined` to omit. The clause is wrapped as an
 * `ArithLit` placeholder; tests that care about structured arithmetic
 * should compare against parser output via `toMatchAst`.
 */
export const cStyleLoop = (
  body: Statement[],
  init?: string,
  cond?: string,
  post?: string,
): CStyleLoop => {
  const c: CStyleLoop = { type: "CStyleLoop", body, ...P };
  if (init !== undefined) c.init = { type: "ArithLit", value: init, ...P };
  if (cond !== undefined) c.cond = { type: "ArithLit", value: cond, ...P };
  if (post !== undefined) c.post = { type: "ArithLit", value: post, ...P };
  return c;
};
export const redirect = (op: RedirOp, target: string, fd?: string): Redirect =>
  fd === undefined
    ? { type: "Redirect", op, target: word(target), ...P }
    : { type: "Redirect", op, target: word(target), fd, ...P };
export const subshell = (...body: Statement[]): Subshell => ({
  type: "Subshell",
  body,
  ...P,
});
export const block = (...body: Statement[]): Block => ({
  type: "Block",
  body,
  ...P,
});
export const ifClause = (
  cond: Statement[],
  then: Statement[],
  elseBranch?: Statement[],
): IfClause =>
  elseBranch
    ? { type: "IfClause", cond, then, else: elseBranch, ...P }
    : { type: "IfClause", cond, then, ...P };
export const whileClause = (
  cond: Statement[],
  body: Statement[],
  until?: boolean,
): WhileClause =>
  until
    ? { type: "WhileClause", cond, body, until, ...P }
    : { type: "WhileClause", cond, body, ...P };
export const forClause = (
  name: string,
  body: Statement[],
  items?: Word[],
): ForClause =>
  items
    ? { type: "ForClause", name, items, body, ...P }
    : { type: "ForClause", name, body, ...P };
export const selectClause = (
  name: string,
  body: Statement[],
  items?: Word[],
): SelectClause =>
  items
    ? { type: "SelectClause", name, items, body, ...P }
    : { type: "SelectClause", name, body, ...P };
export const functionDecl = (
  name: string,
  body: Statement[],
): FunctionDecl => ({
  type: "FunctionDecl",
  name,
  body,
  ...P,
});
export const caseItem = (patterns: Word[], body: Statement[]): CaseItem => ({
  type: "CaseItem",
  patterns,
  body,
  ...P,
});
export const caseClause = (
  wordValue: string,
  items: CaseItem[],
): CaseClause => ({
  type: "CaseClause",
  word: word(wordValue),
  items,
  ...P,
});
/**
 * Build a TestClause whose `x` is the first word (or a Word wrapping it).
 * The structured form uses a TestExpr tree; this helper is intended for
 * fixtures with simple single-word bodies. For complex shapes, hand-build
 * the AST directly.
 */
export const testClause = (...words: Word[]): TestClause => {
  const first = words[0] ?? { type: "Word", parts: [], ...P };
  return { type: "TestClause", x: first, ...P };
};
export const arithCmd = (value: string): ArithCmd => ({
  type: "ArithCmd",
  x: { type: "ArithLit", value, ...P },
  ...P,
});
export const coprocClause = (body: Statement, name?: string): CoprocClause =>
  name
    ? { type: "CoprocClause", name, body, ...P }
    : { type: "CoprocClause", body, ...P };
export const timeClause = (command: Statement): TimeClause => ({
  type: "TimeClause",
  command,
  ...P,
});
export const stmt = (
  command: Command,
  background = false,
  negated = false,
): Statement => {
  const value: Statement = { type: "Statement", command, ...P };
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
  ...P,
});
