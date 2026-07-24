// biome-ignore-all lint/suspicious/noTemplateCurlyInString: shell syntax in test strings
import { describe, expect, it } from "vitest";
import { parse } from "../parse";

const NO_THROW_SENTINEL = "<<<no-throw-sentinel>>>";
const expectErr = (
  src: string,
  dialect: "posix" | "bash" | "mksh",
  needle: string | RegExp,
) => {
  let msg: string = NO_THROW_SENTINEL;
  try {
    parse(src, { dialect });
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  expect(msg, `parse(${JSON.stringify(src)}) did not throw`).not.toBe(
    NO_THROW_SENTINEL,
  );
  if (needle instanceof RegExp) {
    expect(msg).toMatch(needle);
  } else {
    expect(msg).toContain(needle);
  }
};

describe("dialect enforcement: POSIX", () => {
  it("rejects `[[ ]]` test clauses", () => {
    expectErr("[[ a == b ]]", "posix", /\[\[/);
  });

  it("rejects `(( ))` arithmetic commands", () => {
    expectErr("(( 1 + 2 ))", "posix", /\(\(/);
  });

  it("rejects the `function` keyword", () => {
    expectErr("function foo { :; }", "posix", /function/);
  });

  it("rejects `&>` redirects", () => {
    expectErr("foo &> /tmp/log", "posix", /&>/);
  });

  it("rejects `&>>` redirects", () => {
    expectErr("foo &>> /tmp/log", "posix", /&>>/);
  });

  it("rejects herestrings `<<<`", () => {
    expectErr("foo <<< bar", "posix", /<<</);
  });

  it("rejects named file descriptor redirects", () => {
    expectErr("foo {fd}<f", "posix", /\{varname\}.*bash\/zsh feature/);
  });

  it("rejects process substitution", () => {
    expectErr("diff <(foo) <(bar)", "posix", /process subst/);
  });

  it("rejects extended glob", () => {
    expectErr("ls @(foo)", "posix", /extended glob/);
  });

  it("rejects `select`", () => {
    expectErr("select x in a b; do :; done", "posix", /select/);
  });

  it("rejects `coproc`", () => {
    expectErr("coproc { :; }", "posix", /coproc/);
  });

  it("rejects `let`", () => {
    expectErr("let i=1", "posix", /let/);
  });

  it("rejects C-style for loops", () => {
    expectErr("for (( i=0; i<3; i++ )); do :; done", "posix", /\(\(/);
  });

  it("rejects array assignment", () => {
    expectErr("arr=(a b c)", "posix", /array/);
  });

  it("rejects `+=` append assignment", () => {
    expectErr("arr+=foo", "posix", /\+=/);
  });

  it("rejects `declare`", () => {
    expectErr("declare x=1", "posix", /declare/);
  });

  it("rejects `local`", () => {
    expectErr("local x=1", "posix", /local/);
  });
});

describe("dialect enforcement: mksh", () => {
  it("rejects ${!foo*}", () => {
    expectErr("echo ${!foo*}", "mksh", /\$\{!/);
  });

  it("rejects ${!foo@}", () => {
    expectErr("echo ${!foo@}", "mksh", /\$\{!/);
  });

  it("rejects named file descriptor redirects", () => {
    expectErr("foo {fd}<f", "mksh", /\{varname\}.*bash\/zsh feature/);
  });
});

describe("dialect enforcement: bash (default) accepts everything", () => {
  it("accepts [[ ]]", () => {
    expect(() => parse("[[ a == b ]]", { dialect: "bash" })).not.toThrow();
  });

  it("accepts &> in bash", () => {
    expect(() => parse("foo &> /tmp/log", { dialect: "bash" })).not.toThrow();
  });

  it("accepts <<< in bash", () => {
    expect(() => parse("foo <<< bar", { dialect: "bash" })).not.toThrow();
  });

  it("accepts process substitution in bash", () => {
    expect(() =>
      parse("diff <(foo) <(bar)", { dialect: "bash" }),
    ).not.toThrow();
  });

  it("accepts extended glob in bash", () => {
    expect(() => parse("ls @(foo)", { dialect: "bash" })).not.toThrow();
  });
});
