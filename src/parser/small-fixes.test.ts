// biome-ignore-all lint/suspicious/noTemplateCurlyInString: shell syntax in test strings
import { describe, expect, it } from "vitest";
import { parse } from "../parse";
import {
  cmdSubst,
  lit,
  paramExp,
  program,
  simple,
  stmt,
  word,
  wordParts,
} from "../test-helpers/ast-builders";

describe("small parser fixes from mvdan/sh changelog", () => {
  // v3.7.0: Correctly parse `$foo#bar` as a single word (not two).
  // The literal `#bar` continues the word after `$foo`.
  describe("$foo#bar is a single word", () => {
    it("parses $foo#bar as one word with two parts", () => {
      expect(parse("echo $foo#bar")).toMatchAst({
        ast: program(
          stmt({
            type: "SimpleCommand",
            words: [word("echo"), wordParts(paramExp("foo"), lit("#bar"))],
          }),
        ),
      });
    });

    it("parses ${foo}#bar as one word with two parts", () => {
      expect(parse("echo ${foo}#bar")).toMatchAst({
        ast: program(
          stmt({
            type: "SimpleCommand",
            words: [
              word("echo"),
              wordParts(paramExp("foo", false), lit("#bar")),
            ],
          }),
        ),
      });
    });

    it("does not start a comment after $foo", () => {
      // If `#bar` were starting a comment, it would not appear in the AST
      // and `extra` would be the only argument left. Verify it stays one word.
      const { ast } = parse("echo $foo#bar extra");
      const cmd = ast.body[0]?.command;
      expect(cmd?.type).toBe("SimpleCommand");
      if (cmd?.type === "SimpleCommand") {
        expect(cmd.words?.length).toBe(3);
      }
    });
  });

  // v3.10.0: CRLF line endings are treated as LF, including inside heredocs.
  describe("CRLF line endings are normalized", () => {
    it("treats CRLF between statements like LF", () => {
      expect(parse("foo\r\nbar")).toMatchAst({
        ast: program(stmt(simple("foo")), stmt(simple("bar"))),
      });
    });

    it("treats CRLF inside heredoc as LF and matches CRLF delimiters", () => {
      const src = "cat <<EOF\r\nhello\r\nEOF\r\n";
      const { ast } = parse(src);
      const cmd = ast.body[0]?.command;
      expect(cmd?.type).toBe("SimpleCommand");
      if (cmd?.type === "SimpleCommand") {
        const heredoc = cmd.redirects?.[0]?.heredoc;
        expect(heredoc?.parts[0]).toMatchObject({
          type: "Literal",
          value: "hello\n",
        });
      }
    });
  });

  // v3.6.0: <<< is invalid in POSIX mode (covered separately under dialect).
  // v3.8.0: Backquote command substitutions should support escaped backquotes
  // for nesting purposes.
  describe("backquote escapes", () => {
    it("supports escaped backquotes for nested command substitution", () => {
      // `echo \`date\`` should parse as one cmdsubst whose inner is `echo \`date\``,
      // which when re-tokenized inside resolves to nested behavior.
      // We just need to verify the outer parse succeeds and produces a CmdSubst
      // covering the entire backtick span.
      const src = "echo `echo \\`date\\``";
      const { ast } = parse(src);
      const cmd = ast.body[0]?.command;
      expect(cmd?.type).toBe("SimpleCommand");
      if (cmd?.type === "SimpleCommand") {
        const arg = cmd.words?.[1]?.parts[0];
        expect(arg?.type).toBe("CmdSubst");
      }
    });
  });

  // v3.10.0: Position columns should account for null bytes.
  describe("null bytes do not break parsing", () => {
    it("parses a word containing a null byte as a single literal", () => {
      const src = "foo\x00bar";
      const { ast } = parse(src);
      const cmd = ast.body[0]?.command;
      expect(cmd?.type).toBe("SimpleCommand");
      if (cmd?.type === "SimpleCommand") {
        expect(cmd.words?.length).toBe(1);
      }
    });
  });

  // v3.10.0: Position columns count skipped backslashes inside backticks.
  describe("backticks with embedded backslashes", () => {
    it("captures inner content correctly", () => {
      const { ast } = parse("echo `foo \\$bar`");
      const cmd = ast.body[0]?.command;
      if (cmd?.type === "SimpleCommand") {
        const sub = cmd.words?.[1]?.parts[0];
        expect(sub).toMatchObject({
          type: "CmdSubst",
          stmts: [
            {
              type: "Statement",
              command: {
                type: "SimpleCommand",
              },
            },
          ],
        });
        if (sub?.type === "CmdSubst") {
          // The inner is `foo \$bar` -> tokenizer of inner sees `foo $bar`
          // with the backslash already escaped. We just verify there is exactly
          // one statement with `foo` as the command word.
          const inner = sub.stmts[0]?.command;
          if (inner?.type === "SimpleCommand") {
            const head = inner.words?.[0]?.parts[0];
            expect(head).toMatchObject({ type: "Literal", value: "foo" });
          }
        }
      }
    });
  });

  describe("comments after a word are not started by #", () => {
    // The `#` only starts a comment at a word boundary.
    it("treats `foo#bar` as a single literal word", () => {
      expect(parse("echo foo#bar")).toMatchAst({
        ast: program(
          stmt({
            type: "SimpleCommand",
            words: [word("echo"), word("foo#bar")],
          }),
        ),
      });
    });
  });
});
