// biome-ignore-all lint/suspicious/noTemplateCurlyInString: shell syntax in test strings
import { describe, expect, it } from "vitest";
import { tokenize } from "./tokenize";
import type { Token, TokenWordPart } from "./types";

function wordAt(tokens: Token[], index: number): TokenWordPart[] {
  const token = tokens[index];
  if (token?.type !== "word") {
    throw new Error(`token ${index} is not a word`);
  }
  return token.parts;
}

describe("tokenize", () => {
  it("does not treat an escaped question mark as an extglob opener", () => {
    const tokens = tokenize("\\?(");

    expect(tokens).toMatchObject([
      { type: "word", parts: [{ type: "lit", value: "?", escaped: true }] },
      { type: "symbol", value: "(" },
    ]);
  });
});

describe("${...} quote-aware scanning", () => {
  it("stops at the real close when the operand contains a quoted brace", () => {
    const tokens = tokenize('echo ${x:-"{"} ; echo HIDDEN');

    const parts = wordAt(tokens, 1);
    expect(parts).toMatchObject([
      {
        type: "param",
        name: "x",
        braced: true,
        exp: { op: ":-", value: '"{"' },
      },
    ]);
    // The `;` after the closing quote must not be swallowed into `${...}`.
    expect(tokens[2]).toMatchObject({ type: "op", value: ";" });
    expect(wordAt(tokens, 3)).toMatchObject([{ type: "lit", value: "echo" }]);
  });

  it("stops at the real close with a single-quoted brace operand", () => {
    const tokens = tokenize("echo ${x:-'{'} ; echo HIDDEN");

    expect(wordAt(tokens, 1)).toMatchObject([
      { type: "param", exp: { op: ":-", value: "'{'" } },
    ]);
    expect(tokens[2]).toMatchObject({ type: "op", value: ";" });
  });

  it("stops at the real close with an escaped brace operand", () => {
    const tokens = tokenize("echo ${x:-\\{} ; echo HIDDEN");

    expect(wordAt(tokens, 1)).toMatchObject([
      { type: "param", exp: { op: ":-", value: "\\{" } },
    ]);
    expect(tokens[2]).toMatchObject({ type: "op", value: ";" });
  });

  it("ignores braces inside a nested command substitution", () => {
    const tokens = tokenize("echo ${x:-$(echo {)} ok");

    expect(wordAt(tokens, 1)).toMatchObject([
      { type: "param", exp: { op: ":-", value: "$(echo {)" } },
    ]);
    expect(wordAt(tokens, 2)).toMatchObject([{ type: "lit", value: "ok" }]);
  });

  it("ignores braces inside nested backticks with escapes", () => {
    const tokens = tokenize("echo ${x:-`echo \\`{\\``} ok");

    expect(wordAt(tokens, 1)).toMatchObject([
      { type: "param", exp: { op: ":-", value: "`echo \\`{\\``" } },
    ]);
    expect(wordAt(tokens, 2)).toMatchObject([{ type: "lit", value: "ok" }]);
  });

  it("ignores braces inside ANSI-C quotes", () => {
    const tokens = tokenize("echo ${x:-$'a}b'} ok");

    expect(wordAt(tokens, 1)).toMatchObject([
      { type: "param", exp: { op: ":-", value: "$'a}b'" } },
    ]);
    expect(wordAt(tokens, 2)).toMatchObject([{ type: "lit", value: "ok" }]);
  });

  it("counts nested ${...} braces", () => {
    const tokens = tokenize("echo ${x:-${y}} ok");

    expect(wordAt(tokens, 1)).toMatchObject([
      { type: "param", exp: { op: ":-", value: "${y}" } },
    ]);
    expect(wordAt(tokens, 2)).toMatchObject([{ type: "lit", value: "ok" }]);
  });

  it("skips a nested ${...} when closing an inner $(...) span", () => {
    const tokens = tokenize("echo ${outer:-$(echo ${inner:-)})} ok");

    expect(wordAt(tokens, 1)).toMatchObject([
      {
        type: "param",
        name: "outer",
        braced: true,
        exp: { op: ":-", value: "$(echo ${inner:-)})" },
      },
    ]);
    expect(wordAt(tokens, 2)).toMatchObject([{ type: "lit", value: "ok" }]);
  });

  it("falls back to a literal $ when no matching } exists", () => {
    const tokens = tokenize("echo ${x");

    expect(wordAt(tokens, 1)).toMatchObject([{ type: "lit", value: "${x" }]);
  });
});

describe("backtick parts", () => {
  it("carry the raw inner text and the decoded body", () => {
    const tokens = tokenize("echo `echo \\`echo BT_NESTED >&2\\``");

    expect(wordAt(tokens, 1)).toMatchObject([
      {
        type: "backtick",
        raw: "echo \\`echo BT_NESTED >&2\\`",
        body: "echo `echo BT_NESTED >&2`",
      },
    ]);
  });

  it("decodes only backslash-backtick, backslash-backslash, backslash-dollar", () => {
    const tokens = tokenize("`a\\`b\\\\c\\$d\\ne`");

    expect(wordAt(tokens, 0)).toMatchObject([
      {
        type: "backtick",
        raw: "a\\`b\\\\c\\$d\\ne",
        body: "a`b\\c$d\\ne",
      },
    ]);
  });
});

describe("$'...' ANSI-C and $\"...\" locale strings", () => {
  it("tokenizes $'...' as an ansi-c part with raw inner text", () => {
    const tokens = tokenize("echo $'a\\'b'; echo $(echo M >&2) # '");

    expect(wordAt(tokens, 1)).toMatchObject([
      { type: "ansi-c", value: "a\\'b", raw: "$'a\\'b'" },
    ]);
    // The escaped quote must not end the string: the `;` stays a separator.
    expect(tokens[2]).toMatchObject({ type: "op", value: ";" });
    expect(wordAt(tokens, 3)).toMatchObject([{ type: "lit", value: "echo" }]);
    expect(wordAt(tokens, 4)).toMatchObject([
      { type: "cmd-subst", raw: "echo M >&2" },
    ]);
  });

  it("tokenizes an ANSI-C quoted command name as one part", () => {
    const tokens = tokenize("$'\\x65cho' MARK");

    expect(wordAt(tokens, 0)).toMatchObject([
      { type: "ansi-c", value: "\\x65cho", raw: "$'\\x65cho'" },
    ]);
  });

  it("keeps backslash escapes verbatim in the ansi-c value", () => {
    const tokens = tokenize("$'\\n\\t\\\\'");

    expect(wordAt(tokens, 0)).toMatchObject([
      { type: "ansi-c", value: "\\n\\t\\\\" },
    ]);
  });

  it("throws on an unterminated ANSI-C quote", () => {
    expect(() => tokenize("echo $'abc")).toThrow("Unclosed ANSI-C quote");
  });

  it('tokenizes $"..." as a locale-str part with double-quote grammar', () => {
    const tokens = tokenize('echo $"foo $bar"');

    expect(wordAt(tokens, 1)).toMatchObject([
      {
        type: "locale-str",
        parts: [
          { type: "lit", value: "foo " },
          { type: "param", name: "bar", braced: false },
        ],
      },
    ]);
  });
});

describe("bare-word escape provenance", () => {
  it("emits escaped characters as {lit, escaped:true} parts (\\time)", () => {
    const tokens = tokenize("\\time echo ARGUMENT");

    expect(wordAt(tokens, 0)).toMatchObject([
      { type: "lit", value: "t", escaped: true },
      { type: "lit", value: "ime" },
    ]);
  });

  it("emits an escaped = inside an assignment-like word (X\\=1)", () => {
    const tokens = tokenize("X\\=1 echo ASSIGNMENT");

    expect(wordAt(tokens, 0)).toMatchObject([
      { type: "lit", value: "X" },
      { type: "lit", value: "=", escaped: true },
      { type: "lit", value: "1" },
    ]);
  });

  it("emits escaped braces as escaped parts (\\{a,b\\})", () => {
    const tokens = tokenize("echo \\{a,b\\}");

    expect(wordAt(tokens, 1)).toMatchObject([
      { type: "lit", value: "{", escaped: true },
      { type: "lit", value: "a,b" },
      { type: "lit", value: "}", escaped: true },
    ]);
  });
});

describe("CR semantics", () => {
  it("keeps CR as an ordinary literal character", () => {
    const tokens = tokenize("echo a\rb c");

    expect(wordAt(tokens, 1)).toMatchObject([{ type: "lit", value: "a\rb" }]);
    expect(wordAt(tokens, 2)).toMatchObject([{ type: "lit", value: "c" }]);
  });

  it("does NOT fold backslash-CRLF", () => {
    const tokens = tokenize("ec\\\r\nho");

    // `\<CR>` decodes to an escaped CR part, then the LF ends the command.
    expect(wordAt(tokens, 0)).toMatchObject([
      { type: "lit", value: "ec" },
      { type: "lit", value: "\r", escaped: true },
    ]);
    expect(tokens[1]).toMatchObject({ type: "op", value: ";", newline: true });
    expect(wordAt(tokens, 2)).toMatchObject([{ type: "lit", value: "ho" }]);
  });

  it("still folds backslash-LF", () => {
    const tokens = tokenize("ec\\\nho");

    expect(tokens).toHaveLength(1);
    expect(wordAt(tokens, 0)).toMatchObject([{ type: "lit", value: "echo" }]);
  });

  it("does NOT fold backslash-CRLF inside double quotes", () => {
    const tokens = tokenize('"a\\\r\nb"');

    expect(wordAt(tokens, 0)).toMatchObject([
      { type: "dbl", parts: [{ type: "lit", value: "a\\\r\nb" }] },
    ]);
  });

  it("still folds backslash-LF inside double quotes", () => {
    const tokens = tokenize('"a\\\nb"');

    expect(wordAt(tokens, 0)).toMatchObject([
      { type: "dbl", parts: [{ type: "lit", value: "ab" }] },
    ]);
  });
});

describe("heredocs", () => {
  it("keeps expansion text in the delimiter from the source span", () => {
    const tokens = tokenize(
      "echo OUTER <<echo$x\necho$x\necho HIDDEN\necho\nAFTER\n",
    );

    const body = tokens.find((t) => t.type === "heredoc-body");
    expect(body).toMatchObject({
      type: "heredoc-body",
      content: "",
      expand: true,
      delimiter: "echo$x",
      quoted: false,
    });
    // The unquoted body expands, and `echo HIDDEN` is a following command.
    const words = tokens.filter((t) => t.type === "word");
    expect(
      words.some(
        (t) => t.parts[0]?.type === "lit" && t.parts[0].value === "HIDDEN",
      ),
    ).toBe(true);
  });

  it("folds backslash-newline in unquoted-delimiter bodies", () => {
    const tokens = tokenize(
      "echo OUTER <<echo\nec\\\nho\necho HIDDEN\necho\nAFTER\n",
    );

    const body = tokens.find((t) => t.type === "heredoc-body");
    expect(body).toMatchObject({
      type: "heredoc-body",
      content: "",
      expand: true,
      delimiter: "echo",
      quoted: false,
    });
    const words = tokens.filter((t) => t.type === "word");
    expect(
      words.some(
        (t) => t.parts[0]?.type === "lit" && t.parts[0].value === "HIDDEN",
      ),
    ).toBe(true);
  });

  it("applies folded text to the emitted body, not only the comparison", () => {
    const tokens = tokenize(": <<EOF\nfo\\\no\nEOF\n");

    const body = tokens.find((t) => t.type === "heredoc-body");
    expect(body).toMatchObject({ type: "heredoc-body", content: "foo\n" });
  });

  it("matches a quoted delimiter containing CR against CR-preserved lines", () => {
    const tokens = tokenize("echo <<'EOF\r'\nEOF\r\necho HIDDEN\n");

    const body = tokens.find((t) => t.type === "heredoc-body");
    expect(body).toMatchObject({
      type: "heredoc-body",
      content: "",
      expand: false,
      delimiter: "EOF\r",
      quoted: true,
    });
    const words = tokens.filter((t) => t.type === "word");
    expect(
      words.some(
        (t) => t.parts[0]?.type === "lit" && t.parts[0].value === "HIDDEN",
      ),
    ).toBe(true);
  });

  it("preserves CR bytes in the body content", () => {
    const tokens = tokenize(": <<EOF\na\rb\nEOF\n");

    const body = tokens.find((t) => t.type === "heredoc-body");
    expect(body).toMatchObject({ type: "heredoc-body", content: "a\rb\n" });
  });

  it("does not fold backslash-newline for quoted delimiters", () => {
    // With a quoted delimiter, `ec\<LF>ho` is body text, not the terminator;
    // the heredoc is then unclosed.
    expect(() => tokenize(": <<'echo'\nec\\\nho\n")).toThrow(
      'Unclosed heredoc "echo"',
    );
  });

  it("throws when EOF is reached without a terminator", () => {
    expect(() => tokenize(": <<EOF\nbody\n")).toThrow('Unclosed heredoc "EOF"');
  });

  it("throws when the delimiter line is never followed by a body", () => {
    expect(() => tokenize("cat <<EOF")).toThrow('Unclosed heredoc "EOF"');
  });

  it("strips leading tabs for <<- before comparison and in the body", () => {
    const tokens = tokenize(": <<-EOF\n\t\tbody\n\tEOF\n");

    const body = tokens.find((t) => t.type === "heredoc-body");
    expect(body).toMatchObject({
      type: "heredoc-body",
      content: "body\n",
      expand: true,
      delimiter: "EOF",
      quoted: false,
    });
  });

  it("keeps quoted controls unexpanded with verbatim body text", () => {
    const tokens = tokenize(": <<'EOF'\n$(echo x)\nEOF\n");

    const body = tokens.find((t) => t.type === "heredoc-body");
    expect(body).toMatchObject({
      type: "heredoc-body",
      content: "$(echo x)\n",
      expand: false,
      delimiter: "EOF",
      quoted: true,
    });
  });

  it("marks backslash-quoted delimiter words as quoted", () => {
    const tokens = tokenize(": <<EO\\F\nbody\nEOF\n");

    const body = tokens.find((t) => t.type === "heredoc-body");
    expect(body).toMatchObject({
      type: "heredoc-body",
      content: "body\n",
      expand: false,
      delimiter: "EOF",
      quoted: true,
    });
  });

  it("resolves double-quoted delimiter words without expanding them", () => {
    const tokens = tokenize(': <<e"c"ho\nbody\necho\n');

    const body = tokens.find((t) => t.type === "heredoc-body");
    expect(body).toMatchObject({
      type: "heredoc-body",
      content: "body\n",
      expand: false,
      delimiter: "echo",
      quoted: true,
    });
  });

  it("folds only an odd trailing backslash run, not an even one", () => {
    // Body line `EOF\\` (two backslashes) is an escaped backslash followed by
    // LF: it must NOT fold and must NOT match the `EOF` delimiter.
    const tokens = tokenize(": <<EOF\nEOF\\\\\nEOF\n");

    const body = tokens.find((t) => t.type === "heredoc-body");
    expect(body).toMatchObject({
      type: "heredoc-body",
      content: "EOF\\\\\n",
      delimiter: "EOF",
      quoted: false,
    });
  });

  it("compares a delimiter containing a backslash against literal body lines", () => {
    // Span `EO\\F` resolves to delimiter `EO\F` and is quoted, so no folding
    // applies; only an exact literal line terminates.
    const tokens = tokenize(": <<EO\\\\F\nEO\\F\n");

    const body = tokens.find((t) => t.type === "heredoc-body");
    expect(body).toMatchObject({
      type: "heredoc-body",
      content: "",
      delimiter: "EO\\F",
      quoted: true,
      expand: false,
    });
  });
});
