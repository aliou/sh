import { describe, expect, it } from "vitest";
import { parse } from "../parse";
import {
  caseClause,
  caseItem,
  program,
  simple,
  stmt,
  word,
} from "../test-helpers/ast-builders";

describe("parse (case clauses)", () => {
  it("parses case clauses", () => {
    expect(parse("case x in y) z ;; esac")).toMatchAst({
      ast: program(
        stmt(caseClause("x", [caseItem([word("y")], [stmt(simple("z"))])])),
      ),
    });

    expect(parse("case x in a|b) z ;; esac")).toMatchAst({
      ast: program(
        stmt(
          caseClause("x", [
            caseItem([word("a"), word("b")], [stmt(simple("z"))]),
          ]),
        ),
      ),
    });

    expect(parse("case x in a) y ;; b) z ;; esac")).toMatchAst({
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

  it("parses a case item body with multiple statements", () => {
    expect(parse("case x in a) y; z ;; esac")).toMatchAst({
      ast: program(
        stmt(
          caseClause("x", [
            caseItem([word("a")], [stmt(simple("y")), stmt(simple("z"))]),
          ]),
        ),
      ),
    });

    expect(parse("case x in a) y\nz ;; esac")).toMatchAst({
      ast: program(
        stmt(
          caseClause("x", [
            caseItem([word("a")], [stmt(simple("y")), stmt(simple("z"))]),
          ]),
        ),
      ),
    });
  });

  it("keeps newline-derived and literal ;; terminators adjacent", () => {
    // Regression guard for the first-class newline token: a newline
    // before `;;` must not be confused with the terminator itself, and
    // `;;` must stay two adjacent literal `;` tokens.
    expect(() => parse("case x in a) foo\n;; b) bar;; esac")).not.toThrow();
    expect(() => parse("case x in a) foo;; esac")).not.toThrow();
  });

  it("rejects a stray single ; where a statement was expected", () => {
    // bash: `case x in a) foo; ; bar;; esac` is a syntax error.
    expect(() => parse("case x in a) foo; ; bar;; esac")).toThrow();
  });
});
