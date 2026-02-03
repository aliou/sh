import { describe, expect, it } from "vitest";
import { parse } from "./index.js";

type Literal = { type: "Literal"; value: string };
type Word = { type: "Word"; parts: Literal[] };
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
const word = (value: string): Word => ({ type: "Word", parts: [lit(value)] });
const wordParts = (...parts: string[]): Word => ({
  type: "Word",
  parts: parts.map(lit),
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

  it("parses single-quoted parts as literals", () => {
    expect(parse("foo'bar'")).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [wordParts("foo", "bar")],
        }),
      ),
    });
  });

  it("parses double-quoted parts as literals", () => {
    expect(parse('"foo bar"')).toEqual({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("foo bar")],
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

describe("parse (phase 15: coproc)", () => {
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
