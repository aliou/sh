import { describe, expect, it } from "vitest";
import { parse } from "../parse";

function posAt(source: string, offset: number) {
  const before = source.slice(0, offset);
  const lines = before.split("\n");
  return {
    offset,
    line: lines.length,
    col: (lines[lines.length - 1] ?? "").length + 1,
  };
}

describe("recoverErrors mode", () => {
  it("returns a body and an errors array on a clean parse", () => {
    const result = parse("foo; bar", { recoverErrors: true });
    expect(result.errors ?? []).toEqual([]);
    expect(result.ast.body).toHaveLength(2);
  });

  it("collects an error and continues past the bad statement", () => {
    // `if` without `fi` would normally throw; with recoverErrors we expect
    // the error to be recorded and remaining statements to still parse.
    const result = parse("foo\nif", { recoverErrors: true });
    expect((result.errors ?? []).length).toBeGreaterThanOrEqual(1);
    expect(result.errors?.[0]?.message).toMatch(/end of input|fi|then/i);
  });

  it("does not throw on unclosed quotes", () => {
    expect(() =>
      parse("echo 'unterminated", { recoverErrors: true }),
    ).not.toThrow();
    const result = parse("echo 'unterminated", { recoverErrors: true });
    expect((result.errors ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("sets fallback program end to the real multiline source end", () => {
    const source = "echo ok\nunterminated '";
    const result = parse(source, { recoverErrors: true });
    expect(result.ast.end).toEqual(posAt(source, source.length));
  });

  it("still throws by default (recoverErrors not set)", () => {
    expect(() => parse("echo 'unterminated")).toThrow();
  });

  it("attaches a position to each collected error", () => {
    const result = parse("if", { recoverErrors: true });
    expect(result.errors?.[0]?.pos).toBeDefined();
    expect(result.errors?.[0]?.pos.line).toBeGreaterThan(0);
  });

  it("preserves an unterminated heredoc command", () => {
    const source = "rm -r -f /tmp/example <<$EOF\nx\nEOF\n";
    expect(() => parse(source)).toThrow('Unclosed heredoc "$EOF"');

    const { ast, errors } = parse(source, { recoverErrors: true });

    expect(errors).toHaveLength(1);
    expect(errors?.[0]?.message).toBe('Unclosed heredoc "$EOF"');
    expect(ast.body).toHaveLength(1);
    expect(ast.body[0]?.command).toMatchObject({
      type: "SimpleCommand",
      words: [
        { parts: [{ type: "Literal", value: "rm" }] },
        { parts: [{ type: "Literal", value: "-r" }] },
        { parts: [{ type: "Literal", value: "-f" }] },
        { parts: [{ type: "Literal", value: "/tmp/example" }] },
      ],
      redirects: [
        {
          op: "<<",
          heredoc: { parts: [{ type: "Literal", value: "x\nEOF\n" }] },
        },
      ],
    });
  });

  it("preserves a heredoc command without a body", () => {
    const { ast, errors } = parse("cat <<EOF", { recoverErrors: true });

    expect(errors).toHaveLength(1);
    expect(errors?.[0]?.message).toBe('Unclosed heredoc "EOF"');
    expect(ast.body).toHaveLength(1);
    expect(ast.body[0]?.command).toMatchObject({
      type: "SimpleCommand",
      words: [{ parts: [{ type: "Literal", value: "cat" }] }],
      redirects: [
        { op: "<<", target: { parts: [{ type: "Literal", value: "EOF" }] } },
      ],
    });
  });
});

describe("recoverErrors mode: inner programs", () => {
  it("reports inner-program errors at real outer positions", () => {
    const { errors } = parse("x=$(foo &&)", { recoverErrors: true });
    expect(errors?.[0]?.message).toBe("`&&` must be followed by a statement");
    expect(errors?.[0]?.pos).toMatchObject({ offset: 8, line: 1, col: 9 });
  });

  it("rebases inner errors across lines", () => {
    const source = "echo ok\nx=$(y &&)";
    const { errors } = parse(source, { recoverErrors: true });
    expect(errors?.[0]?.pos).toMatchObject({ offset: 14, line: 2, col: 7 });
  });
});
