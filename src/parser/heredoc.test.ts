import { describe, expect, it } from "vitest";
import { parse } from "../parse";
import {
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
