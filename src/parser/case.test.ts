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
    expect(() => parse("case x in a) foo\n;; b) bar;; esac")).not.toThrow();
    expect(() => parse("case x in a) foo;; esac")).not.toThrow();
  });

  it("rejects a stray single ; where a statement was expected", () => {
    expect(() => parse("case x in a) foo; ; bar;; esac")).toThrow();
  });

  it("allows & before the ;; terminator (bash parity)", () => {
    expect(() => parse("case x in a) foo & ;; esac")).not.toThrow();
    expect(() => parse("case x in a) foo &;; esac")).not.toThrow();
    expect(() =>
      parse("case x in a) foo && bar & ;; b) x;; esac"),
    ).not.toThrow();
    expect(() => parse("case x in a) foo &\n;; esac")).not.toThrow();
  });

  it("rejects a ; after a newline inside a case body (bash parity)", () => {
    expect(() => parse("case x in a) foo\n; bar;; esac")).toThrow();
  });

  it("rejects a leading or doubled ; in a case body (bash parity)", () => {
    expect(() => parse("case x in a) ; foo;; esac")).toThrow();
    expect(() => parse("case x in a) foo ; ; esac")).toThrow();
    expect(() => parse("case x in a) foo;;; esac")).toThrow();
  });

  it("keeps zsh's lax case separators", () => {
    const zsh = { dialect: "zsh" } as const;
    expect(() => parse("case x in a) foo\n; bar;; esac", zsh)).not.toThrow();
    expect(() => parse("case x in a) foo;;; esac", zsh)).not.toThrow();
    expect(() => parse("case x in a) foo ; ; esac", zsh)).not.toThrow();
    expect(() => parse("case x in a) ; foo;; esac", zsh)).not.toThrow();
  });
});
