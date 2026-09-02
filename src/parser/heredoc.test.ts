import { describe, expect, it } from "vitest";
import { parse } from "../parse";
import {
  block,
  forClause,
  ifClause,
  program,
  sgl,
  simple,
  stmt,
  whileClause,
  word,
  wordParts,
} from "../test-helpers/ast-builders";

describe("parse (phase 18: heredoc)", () => {
  it("parses << heredoc", () => {
    expect(parse("cat <<EOF\nhello\nEOF")).toMatchAst({
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
    expect(parse("cat <<-EOF\n\thello\n\tEOF")).toMatchAst({
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

describe("parse: heredoc as the last command of a compound body", () => {
  it("parses in an if body", () => {
    expect(parse("if true; then\ncat << 'EOF'\nhello\nEOF\nfi")).toMatchAst({
      ast: program(
        stmt(
          ifClause(
            [stmt(simple("true"))],
            [
              stmt({
                type: "SimpleCommand",
                words: [word("cat")],
                redirects: [
                  {
                    type: "Redirect",
                    op: "<<",
                    target: wordParts(sgl("EOF")),
                    heredoc: word("hello\n"),
                  },
                ],
              }),
            ],
          ),
        ),
      ),
    });
  });

  it("parses in an if body with the redirect on the then line", () => {
    expect(parse("if true; then cat << 'EOF'\nhello\nEOF\nfi")).toMatchAst({
      ast: program(
        stmt(
          ifClause(
            [stmt(simple("true"))],
            [
              stmt({
                type: "SimpleCommand",
                words: [word("cat")],
                redirects: [
                  {
                    type: "Redirect",
                    op: "<<",
                    target: wordParts(sgl("EOF")),
                    heredoc: word("hello\n"),
                  },
                ],
              }),
            ],
          ),
        ),
      ),
    });
  });

  it("parses in an if body with an unquoted delimiter", () => {
    expect(parse("if true; then\ncat <<EOF\nhello\nEOF\nfi")).toMatchAst({
      ast: program(
        stmt(
          ifClause(
            [stmt(simple("true"))],
            [
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
            ],
          ),
        ),
      ),
    });
  });

  it("parses <<- in an if body (tab-stripped body)", () => {
    expect(
      parse("if true; then\n\tcat <<-EOF\n\t\thello\n\tEOF\nfi"),
    ).toMatchAst({
      ast: program(
        stmt(
          ifClause(
            [stmt(simple("true"))],
            [
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
            ],
          ),
        ),
      ),
    });
  });

  it("parses in an if body with an empty body", () => {
    expect(parse("if true; then\n\tfoo <<-EOF\n\tEOF\nfi")).toMatchAst({
      ast: program(
        stmt(
          ifClause(
            [stmt(simple("true"))],
            [
              stmt({
                type: "SimpleCommand",
                words: [word("foo")],
                redirects: [
                  {
                    type: "Redirect",
                    op: "<<-",
                    target: word("EOF"),
                    heredoc: word(""),
                  },
                ],
              }),
            ],
          ),
        ),
      ),
    });
  });

  it("parses in a for body", () => {
    expect(
      parse("for i in 1 2; do\ncat << 'EOF'\nhello\nEOF\ndone"),
    ).toMatchAst({
      ast: program(
        stmt(
          forClause(
            "i",
            [
              stmt({
                type: "SimpleCommand",
                words: [word("cat")],
                redirects: [
                  {
                    type: "Redirect",
                    op: "<<",
                    target: wordParts(sgl("EOF")),
                    heredoc: word("hello\n"),
                  },
                ],
              }),
            ],
            [word("1"), word("2")],
          ),
        ),
      ),
    });
  });

  it("parses in a while body", () => {
    expect(parse("while true; do\ncat << 'EOF'\nhello\nEOF\ndone")).toMatchAst({
      ast: program(
        stmt(
          whileClause(
            [stmt(simple("true"))],
            [
              stmt({
                type: "SimpleCommand",
                words: [word("cat")],
                redirects: [
                  {
                    type: "Redirect",
                    op: "<<",
                    target: wordParts(sgl("EOF")),
                    heredoc: word("hello\n"),
                  },
                ],
              }),
            ],
          ),
        ),
      ),
    });
  });
});

describe("parse: statements following a heredoc command", () => {
  it("parses a command on the line after the delimiter as a separate statement", () => {
    expect(parse("foo <<EOF\nEOF_body\nEOF\nfoo2")).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("foo")],
          redirects: [
            {
              type: "Redirect",
              op: "<<",
              target: word("EOF"),
              heredoc: word("EOF_body\n"),
            },
          ],
        }),
        stmt(simple("foo2")),
      ),
    });
  });

  it("parses with a quoted delimiter and a following command", () => {
    expect(parse("foo <<'EOF'\nEOF_body\nEOF\nfoo2")).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("foo")],
          redirects: [
            {
              type: "Redirect",
              op: "<<",
              target: wordParts(sgl("EOF")),
              heredoc: word("EOF_body\n"),
            },
          ],
        }),
        stmt(simple("foo2")),
      ),
    });
  });

  it("parses several commands after a heredoc command", () => {
    expect(parse("a <<EOF\nfoo\nEOF\nb\nb")).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("a")],
          redirects: [
            {
              type: "Redirect",
              op: "<<",
              target: word("EOF"),
              heredoc: word("foo\n"),
            },
          ],
        }),
        stmt(simple("b")),
        stmt(simple("b")),
      ),
    });
  });

  it("parses two consecutive commands that each open a heredoc", () => {
    expect(
      parse("python3 << 'EOF'\na = 1\nEOF\nnode << 'JS'\nlet x;\nJS"),
    ).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("python3")],
          redirects: [
            {
              type: "Redirect",
              op: "<<",
              target: wordParts(sgl("EOF")),
              heredoc: word("a = 1\n"),
            },
          ],
        }),
        stmt({
          type: "SimpleCommand",
          words: [word("node")],
          redirects: [
            {
              type: "Redirect",
              op: "<<",
              target: wordParts(sgl("JS")),
              heredoc: word("let x;\n"),
            },
          ],
        }),
      ),
    });
  });
});

describe("parse: multiple heredocs on one command", () => {
  it("attaches each heredoc body to its redirect in order", () => {
    expect(parse("cat << A << B\nfoo\nA\nbar\nB\n")).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("cat")],
          redirects: [
            {
              type: "Redirect",
              op: "<<",
              target: word("A"),
              heredoc: word("foo\n"),
            },
            {
              type: "Redirect",
              op: "<<",
              target: word("B"),
              heredoc: word("bar\n"),
            },
          ],
        }),
      ),
    });
  });

  it("attaches three heredoc bodies in order", () => {
    expect(parse("cat << A << B << C\none\nA\ntwo\nB\nthree\nC\n")).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("cat")],
          redirects: [
            {
              type: "Redirect",
              op: "<<",
              target: word("A"),
              heredoc: word("one\n"),
            },
            {
              type: "Redirect",
              op: "<<",
              target: word("B"),
              heredoc: word("two\n"),
            },
            {
              type: "Redirect",
              op: "<<",
              target: word("C"),
              heredoc: word("three\n"),
            },
          ],
        }),
      ),
    });
  });

  it("parses multiple heredocs as the last command of a compound body", () => {
    expect(parse("if true; then\ncat << A << B\nx\nA\ny\nB\nfi")).toMatchAst({
      ast: program(
        stmt(
          ifClause(
            [stmt(simple("true"))],
            [
              stmt({
                type: "SimpleCommand",
                words: [word("cat")],
                redirects: [
                  {
                    type: "Redirect",
                    op: "<<",
                    target: word("A"),
                    heredoc: word("x\n"),
                  },
                  {
                    type: "Redirect",
                    op: "<<",
                    target: word("B"),
                    heredoc: word("y\n"),
                  },
                ],
              }),
            ],
          ),
        ),
      ),
    });
  });
});

describe("parse: separators after a heredoc opener on the same line", () => {
  it("parses a command after a semicolon that follows the opener", () => {
    expect(parse("cat << EOF; echo hi\nfoo\nEOF\n")).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("cat")],
          redirects: [
            {
              type: "Redirect",
              op: "<<",
              target: word("EOF"),
              heredoc: word("foo\n"),
            },
          ],
        }),
        stmt(simple("echo", "hi")),
      ),
    });
  });

  it("parses an && continuation after the opener", () => {
    expect(parse("cat << EOF && echo done\nfoo\nEOF\n")).toMatchAst({
      ast: program(
        stmt({
          type: "Logical",
          op: "and",
          left: stmt({
            type: "SimpleCommand",
            words: [word("cat")],
            redirects: [
              {
                type: "Redirect",
                op: "<<",
                target: word("EOF"),
                heredoc: word("foo\n"),
              },
            ],
          }),
          right: stmt(simple("echo", "done")),
        }),
      ),
    });
  });

  it("parses an || continuation after the opener", () => {
    expect(parse("cat << EOF || echo fail\nfoo\nEOF\n")).toMatchAst({
      ast: program(
        stmt({
          type: "Logical",
          op: "or",
          left: stmt({
            type: "SimpleCommand",
            words: [word("cat")],
            redirects: [
              {
                type: "Redirect",
                op: "<<",
                target: word("EOF"),
                heredoc: word("foo\n"),
              },
            ],
          }),
          right: stmt(simple("echo", "fail")),
        }),
      ),
    });
  });

  it("parses a pipeline continuation after the opener", () => {
    expect(parse("cat << EOF | grep foo\nfoo\nEOF\n")).toMatchAst({
      ast: program(
        stmt({
          type: "Pipeline",
          commands: [
            stmt({
              type: "SimpleCommand",
              words: [word("cat")],
              redirects: [
                {
                  type: "Redirect",
                  op: "<<",
                  target: word("EOF"),
                  heredoc: word("foo\n"),
                },
              ],
            }),
            stmt(simple("grep", "foo")),
          ],
        }),
      ),
    });
  });

  it("parses a block as the && continuation", () => {
    expect(parse("foo <<EOF && {\nbar\nEOF\n\tetc\n}")).toMatchAst({
      ast: program(
        stmt({
          type: "Logical",
          op: "and",
          left: stmt({
            type: "SimpleCommand",
            words: [word("foo")],
            redirects: [
              {
                type: "Redirect",
                op: "<<",
                target: word("EOF"),
                heredoc: word("bar\n"),
              },
            ],
          }),
          right: stmt(block(stmt(simple("etc")))),
        }),
      ),
    });
  });

  it("parses two heredoc commands separated by a semicolon on one line", () => {
    expect(parse("f1 <<EOF1; f2 <<EOF2\nh1\nEOF1\nh2\nEOF2")).toMatchAst({
      ast: program(
        stmt({
          type: "SimpleCommand",
          words: [word("f1")],
          redirects: [
            {
              type: "Redirect",
              op: "<<",
              target: word("EOF1"),
              heredoc: word("h1\n"),
            },
          ],
        }),
        stmt({
          type: "SimpleCommand",
          words: [word("f2")],
          redirects: [
            {
              type: "Redirect",
              op: "<<",
              target: word("EOF2"),
              heredoc: word("h2\n"),
            },
          ],
        }),
      ),
    });
  });
});
