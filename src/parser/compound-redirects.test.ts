import { describe, expect, it } from "vitest";
import { parse } from "../parse";
import {
  block,
  caseClause,
  coprocClause,
  cStyleLoop,
  forClause,
  functionDecl,
  ifClause,
  paramExp,
  program,
  redirect,
  selectClause,
  simple,
  stmt,
  subshell,
  whileClause,
  word,
  wordParts,
} from "../test-helpers/ast-builders";

const heredocRedirect = (op: "<<" | "<<-", target: string, body: string) => ({
  type: "Redirect" as const,
  op,
  target: word(target),
  heredoc: word(body),
});

describe("parse: redirects after compound commands", () => {
  it("attaches an input redirect to a while loop", () => {
    expect(parse("while read x; do :; done < files\necho after")).toMatchAst({
      ast: program(
        stmt({
          ...whileClause([stmt(simple("read", "x"))], [stmt(simple(":"))]),
          redirects: [redirect("<", "files")],
        }),
        stmt(simple("echo", "after")),
      ),
    });
  });

  it("attaches a heredoc to a while loop", () => {
    expect(
      parse("while false; do :; done <<IN\nhello\nIN\necho after"),
    ).toMatchAst({
      ast: program(
        stmt({
          ...whileClause([stmt(simple("false"))], [stmt(simple(":"))]),
          redirects: [heredocRedirect("<<", "IN", "hello\n")],
        }),
        stmt(simple("echo", "after")),
      ),
    });
  });

  it("attaches an output redirect to an until loop", () => {
    expect(parse("until true; do :; done > out")).toMatchAst({
      ast: program(
        stmt({
          ...whileClause([stmt(simple("true"))], [stmt(simple(":"))], true),
          redirects: [redirect(">", "out")],
        }),
      ),
    });
  });

  it("attaches an append redirect to a for loop", () => {
    expect(parse("for i in a b; do echo $i; done >>out")).toMatchAst({
      ast: program(
        stmt({
          ...forClause(
            "i",
            [
              stmt({
                type: "SimpleCommand",
                words: [word("echo"), wordParts(paramExp("i"))],
              }),
            ],
            [word("a"), word("b")],
          ),
          redirects: [redirect(">>", "out")],
        }),
      ),
    });
  });

  it("attaches multiple redirects to a for loop", () => {
    expect(parse("for x in y; do :; done < in > out")).toMatchAst({
      ast: program(
        stmt({
          ...forClause("x", [stmt(simple(":"))], [word("y")]),
          redirects: [redirect("<", "in"), redirect(">", "out")],
        }),
      ),
    });
  });

  it("attaches an output redirect to a C-style for loop", () => {
    expect(parse("for ((i=0;i<3;i++)); do :; done > out")).toMatchAst({
      ast: program(
        stmt({
          ...cStyleLoop([stmt(simple(":"))], "i=0", "i<3", "i++"),
          redirects: [redirect(">", "out")],
        }),
      ),
    });
  });

  it("attaches a heredoc to an if clause", () => {
    expect(
      parse("if foo; then bar; fi <<EOF\ncat\nEOF\necho after"),
    ).toMatchAst({
      ast: program(
        stmt({
          ...ifClause([stmt(simple("foo"))], [stmt(simple("bar"))]),
          redirects: [heredocRedirect("<<", "EOF", "cat\n")],
        }),
        stmt(simple("echo", "after")),
      ),
    });
  });

  it("attaches a heredoc to a block", () => {
    expect(parse("{ command -v handoff.sh && echo ok; } <<E\nx\nE")).toMatchAst(
      {
        ast: program(
          stmt({
            ...block(
              stmt({
                type: "Logical",
                op: "and",
                left: stmt(simple("command", "-v", "handoff.sh")),
                right: stmt(simple("echo", "ok")),
              }),
            ),
            redirects: [heredocRedirect("<<", "E", "x\n")],
          }),
        ),
      },
    );
  });

  it("attaches an fd redirect to a subshell", () => {
    expect(parse("( a; b ) 2>>err")).toMatchAst({
      ast: program(
        stmt({
          ...subshell(stmt(simple("a")), stmt(simple("b"))),
          redirects: [redirect(">>", "err", "2")],
        }),
      ),
    });
  });

  it("attaches a heredoc to a case clause", () => {
    expect(parse("case x in esac <<EOF\nc\nEOF")).toMatchAst({
      ast: program(
        stmt({
          ...caseClause("x", []),
          redirects: [heredocRedirect("<<", "EOF", "c\n")],
        }),
      ),
    });
  });

  it("attaches an input redirect to a select clause", () => {
    expect(parse("select s in a b; do break; done < in")).toMatchAst({
      ast: program(
        stmt({
          ...selectClause("s", [stmt(simple("break"))], [word("a"), word("b")]),
          redirects: [redirect("<", "in")],
        }),
      ),
    });
  });

  it("attaches an output redirect to a function definition", () => {
    expect(parse("f() {\n  echo hi\n} > /dev/null")).toMatchAst({
      ast: program(
        stmt({
          ...functionDecl("f", [stmt(simple("echo", "hi"))]),
          redirects: [redirect(">", "/dev/null")],
        }),
      ),
    });
  });

  it("attaches an output redirect to a test clause", () => {
    expect(parse("[[ foo = bar ]] > t")).toMatchAst({
      ast: program(
        stmt({
          type: "TestClause",
          x: {
            type: "BinaryTest",
            op: "=",
            x: word("foo"),
            y: word("bar"),
          },
          redirects: [redirect(">", "t")],
        }),
      ),
    });
  });

  it("attaches an output redirect to a coproc clause", () => {
    expect(parse("coproc c { echo; } > out")).toMatchAst({
      ast: program(
        stmt({
          ...coprocClause(stmt(block(stmt(simple("echo")))), "c"),
          redirects: [redirect(">", "out")],
        }),
      ),
    });
  });

  it("keeps compound redirects out of a following pipeline", () => {
    expect(parse("while read x; do echo $x; done < in | sort")).toMatchAst({
      ast: program(
        stmt({
          type: "Pipeline",
          commands: [
            stmt({
              ...whileClause(
                [stmt(simple("read", "x"))],
                [
                  stmt({
                    type: "SimpleCommand",
                    words: [word("echo"), wordParts(paramExp("x"))],
                  }),
                ],
              ),
              redirects: [redirect("<", "in")],
            }),
            stmt(simple("sort")),
          ],
        }),
      ),
    });
  });
});
