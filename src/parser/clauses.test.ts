import { describe, expect, it } from "vitest";
import { parse } from "../parse";
import {
  arithCmd,
  block,
  caseClause,
  caseItem,
  coprocClause,
  forClause,
  functionDecl,
  ifClause,
  program,
  selectClause,
  simple,
  stmt,
  subshell,
  testClause,
  timeClause,
  whileClause,
  word,
} from "../test-helpers/ast-builders";

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

describe("parse (phase 11: time)", () => {
  it("parses time clauses", () => {
    expect(parse("time foo")).toEqual({
      ast: program(stmt(timeClause(stmt(simple("foo"))))),
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

describe("parse (phase 20: mixed clauses)", () => {
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
