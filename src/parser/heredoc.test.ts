import { describe, expect, it } from "vitest";
import { parse } from "../parse";
import { program, stmt, word } from "../test-helpers/ast-builders";

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
