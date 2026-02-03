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
type Assignment = { type: "Assignment"; name: string; value?: Word };
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
type Program = { type: "Program"; body: Statement[] };
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
  | Logical;

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
const assign = (name: string, value?: string): Assignment =>
  value === undefined
    ? { type: "Assignment", name }
    : { type: "Assignment", name, value: word(value) };
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

describe("parse (phase 20: coproc)", () => {
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
