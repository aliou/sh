import { describe, expect, it } from "vitest";
import { tokenize } from "../tokenizer";
import { matchSeparator, ParserState, skipStatementSeparators } from "./state";

/**
 * Unit tests for the parser state module: the token cursor and the single
 * parameterized separator-skipping helper that replaced the former
 * `skipSeparators` / `skipCaseSeparators` / `skipOperatorContinuation`
 * trio (aliou/sh#25).
 */
function stateOf(
  source: string,
  opts?: { keepComments?: boolean },
): ParserState {
  const keepComments = opts?.keepComments === true;
  return new ParserState(
    keepComments ? tokenize(source, { keepComments }) : tokenize(source),
    keepComments ? { keepComments } : {},
  );
}

/** Index of the first token whose type/value matches, for assertions. */
function cursorAfter(s: ParserState, fn: () => void): number {
  fn();
  return s.index;
}

describe("ParserState cursor", () => {
  it("peeks and consumes tokens in order", () => {
    const s = stateOf("foo; bar");
    expect(s.peek()).toMatchObject({ type: "word" });
    expect(s.consume()).toMatchObject({ type: "word" });
    expect(s.consume()).toMatchObject({ type: "op", value: ";" });
    expect(s.peekOp(";")).toBe(false);
    expect(s.peekToken(0)).toMatchObject({ type: "word" });
    expect(s.isEof()).toBe(false);
    s.consume();
    expect(s.isEof()).toBe(true);
    expect(() => s.consume()).toThrowError("Unexpected end of input");
  });

  it("tokenizes newlines as first-class newline tokens", () => {
    const s = stateOf("foo\nbar");
    expect(s.consume()).toMatchObject({ type: "word" });
    expect(s.consume()).toMatchObject({ type: "newline" });
    expect(s.matchNewline()).toBe(false);
  });

  it("matches keywords, symbols and operators without consuming", () => {
    const s = stateOf("if (");
    expect(s.matchKeyword("if")).toBe(true);
    expect(s.matchOp("&&")).toBe(false);
    expect(s.matchSymbol("(")).toBe(false); // cursor is still on `if`
    s.consume();
    expect(s.matchSymbol("(")).toBe(true);
    expect(s.index).toBe(1);
  });

  it("collects comments only through consumeComment", () => {
    const s = stateOf("# hello", { keepComments: true });
    expect(s.matchComment()).toBe(true);
    s.consumeComment();
    expect(s.comments).toHaveLength(1);
    expect(s.comments[0]).toMatchObject({ type: "Comment", text: " hello" });
  });
});

describe("skipSeparators (single parameterized helper)", () => {
  it("skips newlines and comments by default but not literal ;", () => {
    const s = stateOf("\n# c\n; foo", { keepComments: true });
    expect(cursorAfter(s, () => s.skipSeparators())).toBe(3); // stops at `;`
    expect(s.peek()).toMatchObject({ type: "op", value: ";" });
  });

  it("skips literal ; when asked (zsh-style lists)", () => {
    const s = stateOf("; ; foo");
    expect(cursorAfter(s, () => s.skipSeparators({ semicolon: true }))).toBe(2);
    expect(s.peek()).toMatchObject({ type: "word" });
  });

  it("skips a single ; but stops before ;; (case item bodies)", () => {
    const s = stateOf("; bar");
    expect(
      cursorAfter(s, () => s.skipSeparators({ semicolon: "single" })),
    ).toBe(1);
    const t = stateOf(";; b");
    expect(
      cursorAfter(t, () => t.skipSeparators({ semicolon: "single" })),
    ).toBe(0);
  });

  it("keeps comments when comments: false", () => {
    const s = stateOf("# c\nfoo", { keepComments: true });
    expect(cursorAfter(s, () => s.skipSeparators({ comments: false }))).toBe(0);
    expect(s.matchComment()).toBe(true);
  });

  it("operator continuation mode skips newlines and comments but not ;", () => {
    const s = stateOf("# c\n\n; foo", { keepComments: true });
    expect(cursorAfter(s, () => s.skipSeparators({ semicolon: false }))).toBe(
      3,
    );
    expect(s.peek()).toMatchObject({ type: "op", value: ";" });
  });

  it("drains heredoc bodies to pending redirects while skipping", () => {
    const s = stateOf("x <<EOF\nbody\nEOF\ny");
    // Simulate the redirect parse having queued the heredoc.
    const redirect = { type: "Redirect" } as never;
    s.pendingHeredocs.push(redirect);
    while (s.matchWord() || s.matchRedir()) s.consume();
    // cursor now at the newline after `EOF` (the delimiter word)
    s.skipSeparators();
    expect(redirect).toMatchObject({
      heredoc: { type: "Word", parts: [{ type: "Literal", value: "body\n" }] },
    });
    expect(s.matchKeyword("y")).toBe(true);
  });
});

describe("skipStatementSeparators", () => {
  it("consumes one immediate ; then any newlines (bash)", () => {
    const s = stateOf(";\n\nfoo");
    expect(cursorAfter(s, () => skipStatementSeparators(s))).toBe(3);
  });

  it("leaves a ; that follows a newline in place (bash rejects it)", () => {
    const s = stateOf("\n; foo");
    expect(cursorAfter(s, () => skipStatementSeparators(s))).toBe(1);
    expect(s.matchOp(";")).toBe(true);
  });

  it("leaves a doubled ; in place (bash rejects it)", () => {
    const s = stateOf("; ; foo");
    expect(cursorAfter(s, () => skipStatementSeparators(s))).toBe(1);
    expect(s.matchOp(";")).toBe(true);
  });

  it("skips any run of separators in zsh mode", () => {
    const s = new ParserState(tokenize("; ; foo"), {
      dialect: "zsh",
    });
    expect(cursorAfter(s, () => skipStatementSeparators(s))).toBe(2);
    expect(s.matchKeyword("foo")).toBe(true);
  });
});

describe("matchSeparator", () => {
  it("matches a literal ; and a newline, nothing else", () => {
    expect(matchSeparator(stateOf("; x"))).toBe(true);
    expect(matchSeparator(stateOf("\nx"))).toBe(true);
    expect(matchSeparator(stateOf("&& x"))).toBe(false);
    expect(matchSeparator(stateOf("x"))).toBe(false);
  });
});
