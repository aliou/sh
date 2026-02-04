import { describe, expect, it } from "vitest";
import { parse } from "./index.js";

type Literal = { type: "Literal"; value: string };
type SglQuoted = { type: "SglQuoted"; value: string };
type DblQuoted = { type: "DblQuoted"; parts: WordPart[] };
type ParamExp = {
  type: "ParamExp";
  short: boolean;
  param: Literal;
  op?: string;
  value?: Word;
};
type CmdSubst = { type: "CmdSubst"; stmts: Statement[] };
type ArithExp = { type: "ArithExp"; expr: string };
type ProcSubst = { type: "ProcSubst"; op: "<" | ">"; stmts: Statement[] };
type WordPart =
  | Literal
  | SglQuoted
  | DblQuoted
  | ParamExp
  | CmdSubst
  | ArithExp
  | ProcSubst;
type Word = { type: "Word"; parts: WordPart[] };
type Assignment = {
  type: "Assignment";
  name: string;
  append?: boolean;
  value?: Word;
  array?: ArrayExpr;
};
type RedirOp =
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
type Redirect = {
  type: "Redirect";
  op: RedirOp;
  fd?: string;
  target: Word;
  heredoc?: Word;
};
type SimpleCommand = {
  type: "SimpleCommand";
  words?: Word[];
  assignments?: Assignment[];
  redirects?: Redirect[];
};
type Subshell = { type: "Subshell"; body: Statement[] };
type Block = { type: "Block"; body: Statement[] };
type IfClause = {
  type: "IfClause";
  cond: Statement[];
  then: Statement[];
  else?: Statement[];
};
type WhileClause = {
  type: "WhileClause";
  cond: Statement[];
  body: Statement[];
  until?: boolean;
};
type ForClause = {
  type: "ForClause";
  name: string;
  items?: Word[];
  body: Statement[];
};
type SelectClause = {
  type: "SelectClause";
  name: string;
  items?: Word[];
  body: Statement[];
};
type FunctionDecl = { type: "FunctionDecl"; name: string; body: Statement[] };
type CaseItem = { type: "CaseItem"; patterns: Word[]; body: Statement[] };
type CaseClause = { type: "CaseClause"; word: Word; items: CaseItem[] };
type TimeClause = { type: "TimeClause"; command: Statement };
type TestClause = { type: "TestClause"; expr: Word[] };
type ArithCmd = { type: "ArithCmd"; expr: string };
type CoprocClause = {
  type: "CoprocClause";
  name?: string;
  body: Statement;
};
type Pipeline = { type: "Pipeline"; commands: Statement[] };
type Logical = {
  type: "Logical";
  op: "and" | "or";
  left: Statement;
  right: Statement;
};
type Statement = {
  type: "Statement";
  command: Command;
  background?: boolean;
  negated?: boolean;
};
type Program = {
  type: "Program";
  body: Statement[];
  comments?: CommentNode[];
};
type Command =
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

type DeclClause = {
  type: "DeclClause";
  variant: "declare" | "local" | "export" | "readonly" | "typeset" | "nameref";
  args?: Word[];
  assigns?: Assignment[];
  redirects?: Redirect[];
};
type LetClause = { type: "LetClause"; exprs: Word[]; redirects?: Redirect[] };
type CStyleLoop = {
  type: "CStyleLoop";
  init?: string;
  cond?: string;
  post?: string;
  body: Statement[];
};
type ArrayExpr = { type: "ArrayExpr"; elems: ArrayElem[] };
type ArrayElem = { type: "ArrayElem"; index?: Word; value?: Word };
type CommentNode = { type: "Comment"; text: string };

const lit = (value: string): Literal => ({ type: "Literal", value });
const sgl = (value: string): SglQuoted => ({ type: "SglQuoted", value });
const dbl = (...parts: WordPart[]): DblQuoted => ({
  type: "DblQuoted",
  parts,
});
const paramExp = (
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
const cmdSubst = (...stmts: Statement[]): CmdSubst => ({
  type: "CmdSubst",
  stmts,
});
const arithExp = (expr: string): ArithExp => ({ type: "ArithExp", expr });
const word = (value: string): Word => ({ type: "Word", parts: [lit(value)] });
const wordParts = (...parts: WordPart[]): Word => ({
  type: "Word",
  parts,
});
const simple = (...words: string[]): SimpleCommand => ({
  type: "SimpleCommand",
  words: words.map(word),
});
const assign = (
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
const arrayExpr = (...elems: ArrayElem[]): ArrayExpr => ({
  type: "ArrayExpr",
  elems,
});
const arrayElem = (value?: string, index?: string): ArrayElem => {
  const e: ArrayElem = { type: "ArrayElem" };
  if (value !== undefined) e.value = word(value);
  if (index !== undefined) e.index = word(index);
  return e;
};
const declClause = (
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
const letClause = (exprs: Word[], redirects?: Redirect[]): LetClause => {
  const l: LetClause = { type: "LetClause", exprs };
  if (redirects) l.redirects = redirects;
  return l;
};
const cStyleLoop = (
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
const redirect = (op: RedirOp, target: string, fd?: string): Redirect =>
  fd === undefined
    ? { type: "Redirect", op, target: word(target) }
    : { type: "Redirect", op, target: word(target), fd };
const subshell = (...body: Statement[]): Subshell => ({
  type: "Subshell",
  body,
});
const block = (...body: Statement[]): Block => ({
  type: "Block",
  body,
});
const ifClause = (
  cond: Statement[],
  then: Statement[],
  elseBranch?: Statement[],
): IfClause =>
  elseBranch
    ? { type: "IfClause", cond, then, else: elseBranch }
    : { type: "IfClause", cond, then };
const whileClause = (
  cond: Statement[],
  body: Statement[],
  until?: boolean,
): WhileClause =>
  until
    ? { type: "WhileClause", cond, body, until }
    : { type: "WhileClause", cond, body };
const forClause = (
  name: string,
  body: Statement[],
  items?: Word[],
): ForClause =>
  items
    ? { type: "ForClause", name, items, body }
    : { type: "ForClause", name, body };
const selectClause = (
  name: string,
  body: Statement[],
  items?: Word[],
): SelectClause =>
  items
    ? { type: "SelectClause", name, items, body }
    : { type: "SelectClause", name, body };
const functionDecl = (name: string, body: Statement[]): FunctionDecl => ({
  type: "FunctionDecl",
  name,
  body,
});
const caseItem = (patterns: Word[], body: Statement[]): CaseItem => ({
  type: "CaseItem",
  patterns,
  body,
});
const caseClause = (wordValue: string, items: CaseItem[]): CaseClause => ({
  type: "CaseClause",
  word: word(wordValue),
  items,
});
const testClause = (...words: Word[]): TestClause => ({
  type: "TestClause",
  expr: words,
});
const arithCmd = (expr: string): ArithCmd => ({
  type: "ArithCmd",
  expr,
});
const coprocClause = (body: Statement, name?: string): CoprocClause =>
  name ? { type: "CoprocClause", name, body } : { type: "CoprocClause", body };
const timeClause = (command: Statement): TimeClause => ({
  type: "TimeClause",
  command,
});
const stmt = (
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
const program = (...body: Statement[]): Program => ({ type: "Program", body });

// Tests derived from mvdan/sh syntax/filetests_test.go command parsing cases.
describe("parse (phase 1: simple commands)", () => {
  it("parses empty input", () => {
    expect(parse("")).toEqual({ ast: program() });
  });

  it("parses a single simple command", () => {
    expect(parse("foo")).toEqual({ ast: program(stmt(simple("foo"))) });
  });

  it("parses multiple statements separated by newline or semicolon", () => {
    expect(parse("foo\nbar")).toEqual({
      ast: program(stmt(simple("foo")), stmt(simple("bar"))),
    });

    expect(parse("foo; bar;")).toEqual({
      ast: program(stmt(simple("foo")), stmt(simple("bar"))),
    });
  });

  it("parses pipelines", () => {
    expect(parse("foo | bar")).toEqual({
      ast: program(
        stmt({
          type: "Pipeline",
          commands: [stmt(simple("foo")), stmt(simple("bar"))],
        }),
      ),
    });

    expect(parse("foo | bar | baz")).toEqual({
      ast: program(
        stmt({
          type: "Pipeline",
          commands: [
            stmt(simple("foo")),
            stmt(simple("bar")),
            stmt(simple("baz")),
          ],
        }),
      ),
    });
  });

  it("parses logical and/or", () => {
    expect(parse("foo && bar")).toEqual({
      ast: program(
        stmt({
          type: "Logical",
          op: "and",
          left: stmt(simple("foo")),
          right: stmt(simple("bar")),
        }),
      ),
    });

    expect(parse("foo || bar")).toEqual({
      ast: program(
        stmt({
          type: "Logical",
          op: "or",
          left: stmt(simple("foo")),
          right: stmt(simple("bar")),
        }),
      ),
    });

    expect(parse("foo && bar || baz")).toEqual({
      ast: program(
        stmt({
          type: "Logical",
          op: "or",
          left: stmt({
            type: "Logical",
            op: "and",
            left: stmt(simple("foo")),
            right: stmt(simple("bar")),
          }),
          right: stmt(simple("baz")),
        }),
      ),
    });
  });

  it("gives pipelines higher precedence than logical ops", () => {
    expect(parse("foo | bar || baz")).toEqual({
      ast: program(
        stmt({
          type: "Logical",
          op: "or",
          left: stmt({
            type: "Pipeline",
            commands: [stmt(simple("foo")), stmt(simple("bar"))],
          }),
          right: stmt(simple("baz")),
        }),
      ),
    });
  });

  it("parses background commands", () => {
    expect(parse("foo &\nbar")).toEqual({
      ast: program(stmt(simple("foo"), true), stmt(simple("bar"))),
    });
  });
});

describe("parse (phase 2: words, quotes, comments)", () => {
  it("ignores full-line and trailing comments", () => {
    expect(parse("# foo\nbar")).toEqual({
      ast: program(stmt(simple("bar"))),
    });

    expect(parse("foo # bar")).toEqual({
      ast: program(stmt(simple("foo"))),
    });
  });

  it("keeps # when not at a boundary", () => {
    expect(parse("foo#bar")).toEqual({
      ast: program(stmt(simple("foo#bar"))),
    });
  });

  it("parses single-quoted parts", () => {
    expect(parse("foo'bar'")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [wordParts(lit("foo"), sgl("bar"))],
        }),
      ),
    });
  });

  it("parses double-quoted parts", () => {
    expect(parse('"foo bar"')).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [wordParts(dbl(lit("foo bar")))],
        }),
      ),
    });
  });

  it("treats backslash-newline as whitespace", () => {
    expect(parse("foo \\\n bar")).toEqual({
      ast: program(stmt(simple("foo", "bar"))),
    });
  });
});

describe("parse (phase 3: assignments and redirects)", () => {
  it("parses assignment-only commands", () => {
    expect(parse("a=b")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          assignments: [assign("a", "b")],
        }),
      ),
    });
  });

  it("parses assignments before words", () => {
    expect(parse("a=b foo")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          assignments: [assign("a", "b")],
          words: [word("foo")],
        }),
      ),
    });
  });

  it("parses redirects", () => {
    expect(parse("foo >out")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("foo")],
          redirects: [redirect(">", "out")],
        }),
      ),
    });

    expect(parse(">out foo")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("foo")],
          redirects: [redirect(">", "out")],
        }),
      ),
    });
  });

  it("parses redirects with file descriptors", () => {
    expect(parse("foo 2>out")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("foo")],
          redirects: [redirect(">", "out", "2")],
        }),
      ),
    });
  });
});

describe("parse (phase 4: subshells and blocks)", () => {
  it("parses subshells", () => {
    expect(parse("(foo)")).toEqual({
      ast: program(stmt(subshell(stmt(simple("foo"))))),
    });

    expect(parse("(foo; bar)")).toEqual({
      ast: program(stmt(subshell(stmt(simple("foo")), stmt(simple("bar"))))),
    });
  });

  it("parses blocks", () => {
    expect(parse("{ foo; }")).toEqual({
      ast: program(stmt(block(stmt(simple("foo"))))),
    });
  });
});

describe("parse (phase 5: if clauses)", () => {
  it("parses if/then/fi", () => {
    expect(parse("if a; then b; fi")).toEqual({
      ast: program(stmt(ifClause([stmt(simple("a"))], [stmt(simple("b"))]))),
    });
  });

  it("parses if/then/else/fi", () => {
    expect(parse("if a; then b; else c; fi")).toEqual({
      ast: program(
        stmt(
          ifClause(
            [stmt(simple("a"))],
            [stmt(simple("b"))],
            [stmt(simple("c"))],
          ),
        ),
      ),
    });
  });

  it("parses if/elif/then/fi", () => {
    expect(parse("if a; then b; elif c; then d; fi")).toEqual({
      ast: program(
        stmt(
          ifClause(
            [stmt(simple("a"))],
            [stmt(simple("b"))],
            [stmt(ifClause([stmt(simple("c"))], [stmt(simple("d"))]))],
          ),
        ),
      ),
    });
  });
});

describe("parse (phase 6: while/until clauses)", () => {
  it("parses while/do/done", () => {
    expect(parse("while a; do b; done")).toEqual({
      ast: program(stmt(whileClause([stmt(simple("a"))], [stmt(simple("b"))]))),
    });
  });

  it("parses until/do/done", () => {
    expect(parse("until a; do b; done")).toEqual({
      ast: program(
        stmt(whileClause([stmt(simple("a"))], [stmt(simple("b"))], true)),
      ),
    });
  });
});

describe("parse (phase 7: for clauses)", () => {
  it("parses for-in loops", () => {
    expect(parse("for i in a b; do c; done")).toEqual({
      ast: program(
        stmt(forClause("i", [stmt(simple("c"))], [word("a"), word("b")])),
      ),
    });
  });

  it("parses for loops without in list", () => {
    expect(parse("for i; do c; done")).toEqual({
      ast: program(stmt(forClause("i", [stmt(simple("c"))]))),
    });
  });
});

describe("parse (phase 8: select clauses)", () => {
  it("parses select loops", () => {
    expect(parse("select i in a b; do c; done")).toEqual({
      ast: program(
        stmt(selectClause("i", [stmt(simple("c"))], [word("a"), word("b")])),
      ),
    });
  });
});

describe("parse (phase 9: functions and case)", () => {
  it("parses function declarations", () => {
    expect(parse("foo() { bar; }")).toEqual({
      ast: program(stmt(functionDecl("foo", [stmt(simple("bar"))]))),
    });

    expect(parse("function foo { bar; }")).toEqual({
      ast: program(stmt(functionDecl("foo", [stmt(simple("bar"))]))),
    });
  });

  it("parses case clauses", () => {
    expect(parse("case x in y) z ;; esac")).toEqual({
      ast: program(
        stmt(caseClause("x", [caseItem([word("y")], [stmt(simple("z"))])])),
      ),
    });

    expect(parse("case x in a|b) z ;; esac")).toEqual({
      ast: program(
        stmt(
          caseClause("x", [
            caseItem([word("a"), word("b")], [stmt(simple("z"))]),
          ]),
        ),
      ),
    });

    expect(parse("case x in a) y ;; b) z ;; esac")).toEqual({
      ast: program(
        stmt(
          caseClause("x", [
            caseItem([word("a")], [stmt(simple("y"))]),
            caseItem([word("b")], [stmt(simple("z"))]),
          ]),
        ),
      ),
    });
  });
});

describe("parse (phase 10: negation)", () => {
  it("parses negated commands", () => {
    expect(parse("! foo")).toEqual({
      ast: program(stmt(simple("foo"), false, true)),
    });
  });
});

describe("parse (phase 11: time)", () => {
  it("parses time clauses", () => {
    expect(parse("time foo")).toEqual({
      ast: program(stmt(timeClause(stmt(simple("foo"))))),
    });
  });
});

describe("parse (phase 12: extended redirects)", () => {
  it("parses clobber redirect >|", () => {
    expect(parse("foo >| bar")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("foo")],
          redirects: [redirect(">|", "bar")],
        }),
      ),
    });
  });

  it("parses fd dup >&", () => {
    expect(parse("foo >&2")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("foo")],
          redirects: [redirect(">&", "2")],
        }),
      ),
    });
  });

  it("parses fd dup <&", () => {
    expect(parse("foo <&3")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("foo")],
          redirects: [redirect("<&", "3")],
        }),
      ),
    });
  });

  it("parses &> redirect", () => {
    expect(parse("foo &>bar")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("foo")],
          redirects: [redirect("&>", "bar")],
        }),
      ),
    });
  });

  it("parses &>> redirect", () => {
    expect(parse("foo &>>bar")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("foo")],
          redirects: [redirect("&>>", "bar")],
        }),
      ),
    });
  });

  it("parses here-string <<<", () => {
    expect(parse("foo <<<bar")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("foo")],
          redirects: [redirect("<<<", "bar")],
        }),
      ),
    });
  });

  it("parses <> redirect", () => {
    expect(parse("foo <>bar")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("foo")],
          redirects: [redirect("<>", "bar")],
        }),
      ),
    });
  });

  it("parses fd dup with explicit fd 2>&1", () => {
    expect(parse("foo 2>&1")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("foo")],
          redirects: [redirect(">&", "1", "2")],
        }),
      ),
    });
  });
});

describe("parse (phase 13: extended test)", () => {
  it("parses [[ ]]", () => {
    expect(parse("[[ -f foo ]]")).toEqual({
      ast: program(stmt(testClause(word("-f"), word("foo")))),
    });
  });

  it("parses [[ with binary op ]]", () => {
    expect(parse("[[ foo == bar ]]")).toEqual({
      ast: program(stmt(testClause(word("foo"), word("=="), word("bar")))),
    });
  });
});

describe("parse (phase 14: arithmetic command)", () => {
  it("parses (( ))", () => {
    expect(parse("(( x + 1 ))")).toEqual({
      ast: program(stmt(arithCmd("x + 1"))),
    });
  });

  it("parses nested parens in (( ))", () => {
    expect(parse("(( (x + 1) * 2 ))")).toEqual({
      ast: program(stmt(arithCmd("(x + 1) * 2"))),
    });
  });
});

describe("parse (phase 15: parameter expansion)", () => {
  it("parses $var", () => {
    expect(parse("echo $foo")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("echo"), wordParts(paramExp("foo"))],
        }),
      ),
    });
  });

  it("parses ${var}", () => {
    expect(parse("echo ${foo}")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("echo"), wordParts(paramExp("foo", false))],
        }),
      ),
    });
  });

  it("parses ${var:-default}", () => {
    expect(parse("echo ${foo:-bar}")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("echo"), wordParts(paramExp("foo", false, ":-", "bar"))],
        }),
      ),
    });
  });

  it("parses $var inside double quotes", () => {
    expect(parse('"hello $name"')).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [wordParts(dbl(lit("hello "), paramExp("name")))],
        }),
      ),
    });
  });

  it("parses special params $? $# $@", () => {
    expect(parse("echo $?")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("echo"), wordParts(paramExp("?"))],
        }),
      ),
    });
  });
});

describe("parse (phase 16: command substitution)", () => {
  it("parses $(cmd)", () => {
    expect(parse("echo $(foo)")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("echo"), wordParts(cmdSubst(stmt(simple("foo"))))],
        }),
      ),
    });
  });

  it("parses backtick substitution", () => {
    expect(parse("echo `foo`")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("echo"), wordParts(cmdSubst(stmt(simple("foo"))))],
        }),
      ),
    });
  });

  it("parses $(cmd) inside double quotes", () => {
    expect(parse('"$(foo)"')).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [wordParts(dbl(cmdSubst(stmt(simple("foo")))))],
        }),
      ),
    });
  });
});

describe("parse (phase 17: arithmetic expansion)", () => {
  it("parses $((expr))", () => {
    expect(parse("echo $((1 + 2))")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("echo"), wordParts(arithExp("1 + 2"))],
        }),
      ),
    });
  });
});

describe("parse (phase 18: heredoc)", () => {
  it("parses << heredoc", () => {
    expect(parse("cat <<EOF\nhello\nEOF")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("cat")],
          redirects: [
            {
              type: "Redirect",
              op: "<<",
              target: word("EOF"),
              heredoc: word("hello\n"),
            },
          ],
        }),
      ),
    });
  });

  it("parses <<- heredoc (strips leading tabs)", () => {
    expect(parse("cat <<-EOF\n\thello\n\tEOF")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("cat")],
          redirects: [
            {
              type: "Redirect",
              op: "<<-",
              target: word("EOF"),
              heredoc: word("hello\n"),
            },
          ],
        }),
      ),
    });
  });
});

describe("parse (phase 19: process substitution)", () => {
  it("parses <() process substitution", () => {
    expect(parse("diff <(foo) <(bar)")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [
            word("diff"),
            wordParts({
              type: "ProcSubst",
              op: "<",
              stmts: [stmt(simple("foo"))],
            }),
            wordParts({
              type: "ProcSubst",
              op: "<",
              stmts: [stmt(simple("bar"))],
            }),
          ],
        }),
      ),
    });
  });
});

describe("parse (phase 20: mixed expansions)", () => {
  it("parses mixed literal and expansion in word", () => {
    expect(parse("echo foo${bar}baz")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [
            word("echo"),
            wordParts(lit("foo"), paramExp("bar", false), lit("baz")),
          ],
        }),
      ),
    });
  });

  it("parses nested command substitution", () => {
    expect(parse("echo $(echo $(foo))")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [
            word("echo"),
            wordParts(
              cmdSubst(
                stmt({
                  type: "SimpleCommand",
                  words: [
                    word("echo"),
                    wordParts(cmdSubst(stmt(simple("foo")))),
                  ],
                }),
              ),
            ),
          ],
        }),
      ),
    });
  });

  it("parses function with parens in function keyword form", () => {
    expect(parse("function foo() { bar; }")).toEqual({
      ast: program(stmt(functionDecl("foo", [stmt(simple("bar"))]))),
    });
  });

  it("parses if/elif/else/fi chain", () => {
    expect(parse("if a; then b; elif c; then d; else e; fi")).toEqual({
      ast: program(
        stmt(
          ifClause(
            [stmt(simple("a"))],
            [stmt(simple("b"))],
            [
              stmt(
                ifClause(
                  [stmt(simple("c"))],
                  [stmt(simple("d"))],
                  [stmt(simple("e"))],
                ),
              ),
            ],
          ),
        ),
      ),
    });
  });
});

describe("parse (phase 21: coproc)", () => {
  it("parses coproc with command", () => {
    expect(parse("coproc foo")).toEqual({
      ast: program(stmt(coprocClause(stmt(simple("foo"))))),
    });
  });

  it("parses coproc with name and block", () => {
    expect(parse("coproc NAME { foo; }")).toEqual({
      ast: program(
        stmt(coprocClause(stmt(block(stmt(simple("foo")))), "NAME")),
      ),
    });
  });
});

describe("parse (phase 22: decl clause)", () => {
  it("parses export with assignment", () => {
    expect(parse("export FOO=bar")).toEqual({
      ast: program(
        stmt(
          declClause("export", {
            assigns: [assign("FOO", "bar")],
          }),
        ),
      ),
    });
  });

  it("parses export with multiple names", () => {
    expect(parse("export FOO BAR")).toEqual({
      ast: program(
        stmt(
          declClause("export", {
            args: [word("FOO"), word("BAR")],
          }),
        ),
      ),
    });
  });

  it("parses local with assignment", () => {
    expect(parse("local x=1")).toEqual({
      ast: program(
        stmt(
          declClause("local", {
            assigns: [assign("x", "1")],
          }),
        ),
      ),
    });
  });

  it("parses declare with flags", () => {
    expect(parse("declare -r FOO=bar")).toEqual({
      ast: program(
        stmt(
          declClause("declare", {
            args: [word("-r")],
            assigns: [assign("FOO", "bar")],
          }),
        ),
      ),
    });
  });

  it("parses readonly with names", () => {
    expect(parse("readonly X Y")).toEqual({
      ast: program(
        stmt(
          declClause("readonly", {
            args: [word("X"), word("Y")],
          }),
        ),
      ),
    });
  });

  it("parses typeset with flag and assignment", () => {
    expect(parse("typeset -i count=0")).toEqual({
      ast: program(
        stmt(
          declClause("typeset", {
            args: [word("-i")],
            assigns: [assign("count", "0")],
          }),
        ),
      ),
    });
  });

  it("parses nameref", () => {
    expect(parse("nameref ref=target")).toEqual({
      ast: program(
        stmt(
          declClause("nameref", {
            assigns: [assign("ref", "target")],
          }),
        ),
      ),
    });
  });

  it("parses export with redirect", () => {
    expect(parse("export FOO=bar 2>/dev/null")).toEqual({
      ast: program(
        stmt(
          declClause("export", {
            assigns: [assign("FOO", "bar")],
            redirects: [redirect(">", "/dev/null", "2")],
          }),
        ),
      ),
    });
  });

  it("parses declare -a with array", () => {
    expect(parse("declare -a arr=(a b c)")).toEqual({
      ast: program(
        stmt(
          declClause("declare", {
            args: [word("-a")],
            assigns: [
              assign("arr", undefined, {
                array: arrayExpr(
                  arrayElem("a"),
                  arrayElem("b"),
                  arrayElem("c"),
                ),
              }),
            ],
          }),
        ),
      ),
    });
  });
});

describe("parse (phase 23: append assignment)", () => {
  it("parses append assignment", () => {
    expect(parse("PATH+=/usr/local/bin echo hi")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("echo"), word("hi")],
          assignments: [assign("PATH", "/usr/local/bin", { append: true })],
        }),
      ),
    });
  });

  it("parses standalone append assignment", () => {
    expect(parse("arr+=value")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          assignments: [assign("arr", "value", { append: true })],
        }),
      ),
    });
  });
});

describe("parse (phase 24: array expressions)", () => {
  it("parses simple array assignment", () => {
    expect(parse("arr=(a b c)")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          assignments: [
            assign("arr", undefined, {
              array: arrayExpr(arrayElem("a"), arrayElem("b"), arrayElem("c")),
            }),
          ],
        }),
      ),
    });
  });

  it("parses indexed array assignment", () => {
    expect(parse("arr=([0]=x [1]=y)")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          assignments: [
            assign("arr", undefined, {
              array: arrayExpr(arrayElem("x", "0"), arrayElem("y", "1")),
            }),
          ],
        }),
      ),
    });
  });

  it("parses associative array assignment", () => {
    expect(parse("arr=([key]=val [other]=thing)")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          assignments: [
            assign("arr", undefined, {
              array: arrayExpr(
                arrayElem("val", "key"),
                arrayElem("thing", "other"),
              ),
            }),
          ],
        }),
      ),
    });
  });

  it("parses empty array", () => {
    expect(parse("arr=()")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          assignments: [assign("arr", undefined, { array: arrayExpr() })],
        }),
      ),
    });
  });

  it("parses append array", () => {
    expect(parse("arr+=(x y)")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          assignments: [
            assign("arr", undefined, {
              append: true,
              array: arrayExpr(arrayElem("x"), arrayElem("y")),
            }),
          ],
        }),
      ),
    });
  });
});

describe("parse (phase 25: c-style for loop)", () => {
  it("parses c-style for loop", () => {
    const result = parse("for ((i=0; i<10; i++)); do echo $i; done");
    expect(result.ast.body).toHaveLength(1);
    const command = result.ast.body[0]?.command as CStyleLoop;
    expect(command.type).toBe("CStyleLoop");
    expect(command.init).toBe("i=0");
    expect(command.cond).toBe("i<10");
    expect(command.post).toBe("i++");
    expect(command.body).toHaveLength(1);
  });

  it("parses c-style for loop with empty parts", () => {
    expect(parse("for ((;;)); do echo loop; done")).toEqual({
      ast: program(stmt(cStyleLoop([stmt(simple("echo", "loop"))]))),
    });
  });

  it("parses c-style for loop with only condition", () => {
    const result = parse("for (( ; i<5; )); do echo $i; done");
    const command = result.ast.body[0]?.command as CStyleLoop;
    expect(command.type).toBe("CStyleLoop");
    expect(command.init).toBeUndefined();
    expect(command.cond).toBe("i<5");
    expect(command.post).toBeUndefined();
    expect(command.body).toHaveLength(1);
  });
});

describe("parse (phase 26: let clause)", () => {
  it("parses let with single expression", () => {
    expect(parse("let i++")).toEqual({
      ast: program(stmt(letClause([word("i++")]))),
    });
  });

  it("parses let with multiple expressions", () => {
    expect(parse("let i++ j=2")).toEqual({
      ast: program(stmt(letClause([word("i++"), word("j=2")]))),
    });
  });

  it("parses let with redirect", () => {
    expect(parse("let x=1 2>/dev/null")).toEqual({
      ast: program(
        stmt(letClause([word("x=1")], [redirect(">", "/dev/null", "2")])),
      ),
    });
  });
});

describe("parse (phase 27: comments)", () => {
  it("does not include comments by default", () => {
    const result = parse("echo hi # a comment");
    expect(result.ast.comments).toBeUndefined();
  });

  it("collects comments when keepComments is true", () => {
    const result = parse("echo hi # a comment", { keepComments: true });
    expect(result.ast.comments).toEqual([
      { type: "Comment", text: " a comment" },
    ]);
  });

  it("collects multiple comments", () => {
    const result = parse("# first\necho hi\n# second", {
      keepComments: true,
    });
    expect(result.ast.comments).toEqual([
      { type: "Comment", text: " first" },
      { type: "Comment", text: " second" },
    ]);
  });

  it("collects inline comment after semicolon", () => {
    const result = parse("echo hi; # trailing", { keepComments: true });
    expect(result.ast.comments).toEqual([
      { type: "Comment", text: " trailing" },
    ]);
  });
});

// Real-world guardrail validation tests.
// The guardrails extension blocks commands matching /\bnpm\b/ on the full
// command string. This causes false positives when "npm" appears in arguments,
// grep patterns, heredocs, or subcommand strings rather than as the actual
// command being invoked.
//
// These tests validate that the parser produces an AST where the actual
// command name (first word of a SimpleCommand) is distinguishable from
// arguments, allowing a smarter guardrail to only check command positions.
describe("guardrail validation: package manager enforcement", () => {
  // Helper: extract all command names (first word of each SimpleCommand) from
  // a parsed program, recursively walking the AST.
  function extractCommandNames(node: unknown): string[] {
    if (!node || typeof node !== "object") return [];
    const n = node as Record<string, unknown>;
    const names: string[] = [];

    if (
      n.type === "SimpleCommand" &&
      Array.isArray(n.words) &&
      n.words.length > 0
    ) {
      const firstWord = n.words[0] as
        | { parts: Array<{ type: string; value?: string }> }
        | undefined;
      // Only extract if first word is a plain literal (no expansions)
      if (
        firstWord &&
        firstWord.parts.length === 1 &&
        firstWord.parts[0]?.type === "Literal"
      ) {
        names.push(firstWord.parts[0].value as string);
      }
    }

    for (const val of Object.values(n)) {
      if (Array.isArray(val)) {
        for (const item of val) {
          names.push(...extractCommandNames(item));
        }
      } else if (val && typeof val === "object") {
        names.push(...extractCommandNames(val));
      }
    }
    return names;
  }

  it("grep for npm pattern is not an npm command", () => {
    const { ast } = parse(String.raw`grep -rn '\bnpm\b' src/`);
    const cmds = extractCommandNames(ast);
    expect(cmds).toEqual(["grep"]);
    expect(cmds).not.toContain("npm");
  });

  it("grep with multiple patterns including npm/npx", () => {
    const { ast } = parse(
      String.raw`grep -rn '\bnpx\b\|\bnpm \b\|\bnpm$' AGENTS.md`,
    );
    const cmds = extractCommandNames(ast);
    expect(cmds).toEqual(["grep"]);
  });

  it("echo containing npm is not an npm command", () => {
    const { ast } = parse('echo "use npm install instead"');
    const cmds = extractCommandNames(ast);
    expect(cmds).toEqual(["echo"]);
  });

  it("cat of package.json (which contains npm) is not npm", () => {
    const { ast } = parse("cat /path/to/package.json");
    const cmds = extractCommandNames(ast);
    expect(cmds).toEqual(["cat"]);
  });

  it("npx wrangler is an npx command, not npm", () => {
    const { ast } = parse("npx wrangler --version");
    const cmds = extractCommandNames(ast);
    expect(cmds).toEqual(["npx"]);
    expect(cmds).not.toContain("npm");
  });

  it("actual npm install is correctly identified", () => {
    const { ast } = parse("npm install --omit=dev");
    const cmds = extractCommandNames(ast);
    expect(cmds).toContain("npm");
  });

  it("actual npm ci is correctly identified", () => {
    const { ast } = parse("npm ci");
    const cmds = extractCommandNames(ast);
    expect(cmds).toContain("npm");
  });

  it("pnpm command is identified as pnpm, not npm", () => {
    const { ast } = parse("pnpm --filter pi-relay-server typecheck");
    const cmds = extractCommandNames(ast);
    expect(cmds).toEqual(["pnpm"]);
    expect(cmds).not.toContain("npm");
  });

  it("cd && pnpm: both commands identified correctly", () => {
    const { ast } = parse("cd /project && pnpm --filter pi-relay-server test");
    const cmds = extractCommandNames(ast);
    expect(cmds).toEqual(["cd", "pnpm"]);
    expect(cmds).not.toContain("npm");
  });

  it("npm in || fallback: both branches identified", () => {
    const { ast } = parse(
      "npm ci --omit=dev 2>/dev/null || npm install --omit=dev",
    );
    const cmds = extractCommandNames(ast);
    expect(cmds).toEqual(["npm", "npm"]);
  });

  it("which npm is not running npm", () => {
    const { ast } = parse("which npm 2>/dev/null || echo 'npm not found'");
    const cmds = extractCommandNames(ast);
    expect(cmds).toEqual(["which", "echo"]);
    expect(cmds).not.toContain("npm");
  });

  it("heredoc containing npm install is not an npm command", () => {
    const input = `cat <<'EOF'
RUN npm install --omit=dev
npm ci
EOF`;
    const { ast } = parse(input);
    const cmds = extractCommandNames(ast);
    expect(cmds).toEqual(["cat"]);
    expect(cmds).not.toContain("npm");
  });

  it("docker build with heredoc Dockerfile containing npm", () => {
    const input = `docker build -t myimage -f - . <<'DOCKERFILE'
FROM node:22-slim
RUN npm install --omit=dev
DOCKERFILE`;
    const { ast } = parse(input);
    const cmds = extractCommandNames(ast);
    expect(cmds).toEqual(["docker"]);
    expect(cmds).not.toContain("npm");
  });

  it("command substitution: inner npm is a real command", () => {
    const { ast } = parse("echo $(npm pack)");
    const cmds = extractCommandNames(ast);
    expect(cmds).toContain("echo");
    expect(cmds).toContain("npm");
  });

  it("pipeline: only first words are commands", () => {
    const { ast } = parse("find . -name '*.json' | grep npm | head -5");
    const cmds = extractCommandNames(ast);
    expect(cmds).toEqual(["find", "grep", "head"]);
    expect(cmds).not.toContain("npm");
  });

  it("subshell: npm inside is a real command", () => {
    const { ast } = parse("(cd /tmp && npm install)");
    const cmds = extractCommandNames(ast);
    expect(cmds).toContain("cd");
    expect(cmds).toContain("npm");
  });

  it("if condition with npm check", () => {
    const { ast } = parse("if command -v npm; then echo found; fi");
    const cmds = extractCommandNames(ast);
    expect(cmds).toContain("command");
    expect(cmds).toContain("echo");
    // "npm" is an argument to "command -v", not a command itself
    expect(cmds).not.toContain("npm");
  });

  it("variable assignment containing npm is not a command", () => {
    const { ast } = parse('PKG_MGR=npm echo "using $PKG_MGR"');
    const cmds = extractCommandNames(ast);
    expect(cmds).toEqual(["echo"]);
    expect(cmds).not.toContain("npm");
  });

  it("herestring containing npm is not a command", () => {
    const { ast } = parse("grep -c npm <<< 'npm install pnpm bun'");
    const cmds = extractCommandNames(ast);
    expect(cmds).toEqual(["grep"]);
  });

  it("real session: cd && pnpm filter test piped to tail", () => {
    const { ast } = parse(
      "cd /project && pnpm --filter pi-relay-server test 2>&1 | tail -15",
    );
    const cmds = extractCommandNames(ast);
    expect(cmds).toContain("cd");
    expect(cmds).toContain("pnpm");
    expect(cmds).toContain("tail");
    expect(cmds).not.toContain("npm");
  });

  it("real session: curl piped to jq (no npm)", () => {
    const { ast } = parse("curl -s http://localhost:31415/health | jq .");
    const cmds = extractCommandNames(ast);
    expect(cmds).toEqual(["curl", "jq"]);
  });

  it("real session: biome check with npm in path is not npm", () => {
    const { ast } = parse(
      "pnpm exec biome check --write src/sandbox/cloudflare.test.ts",
    );
    const cmds = extractCommandNames(ast);
    expect(cmds).toEqual(["pnpm"]);
  });

  it("real session: write Dockerfile via heredoc then docker build", () => {
    const input = `mkdir -p /tmp/cf-sandbox-test && \\
cp bridge.js /tmp/cf-sandbox-test/ && \\
cat > /tmp/cf-sandbox-test/Dockerfile <<'DOCKERFILE'
FROM node:22-slim
RUN apt-get update && apt-get install -y curl tar bash git
WORKDIR /bridge
COPY package.json ./
RUN npm install --omit=dev 2>/dev/null || true
COPY bridge.js ./
CMD ["node", "/bridge/bridge.js"]
DOCKERFILE

docker build --platform linux/arm64 -t pi-sandbox-cf:arm64-debian /tmp/cf-sandbox-test`;
    const { ast } = parse(input);
    const cmds = extractCommandNames(ast);
    expect(cmds).toContain("mkdir");
    expect(cmds).toContain("cp");
    expect(cmds).toContain("cat");
    expect(cmds).toContain("docker");
    expect(cmds).not.toContain("npm");
  });
});
