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

  it("rejects process substitution", () => {
    expectErr("diff <(foo) <(bar)", "posix", /process subst/);
  });

  it("rejects named file descriptor redirects", () => {
    expectErr("foo {fd}<f", "posix", /\{varname\}.*bash\/zsh feature/);
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
  it("rejects C-style for loops", () => {
    expectErr("for ((i=0; i<3; i++)); do :; done", "mksh", /for \(\(/);
  });

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

describe("dialect enforcement: fail-open parameter forms", () => {
  it.each(["${}", "${:-word}", "${:+word}"])(
    "rejects a missing parameter name in %s",
    (source) => {
      expectErr(source, "bash", /parameter name/);
      expectErr(source, "posix", /parameter name/);
      expectErr(source, "mksh", /parameter name/);
      expect(() => parse(source, { dialect: "zsh" })).not.toThrow();
    },
  );

  it("rejects non-POSIX array, slice, replacement, and indirect forms", () => {
    for (const source of ["${foo[1]}", "${foo:1}", "${foo/a/b}", "${!foo}"]) {
      expectErr(source, "posix", /parameter|array/);
    }
  });

  it("rejects zsh-only force expansion outside zsh", () => {
    for (const source of ["${foo:#bar}", "${foo:|bar}", "${foo:*bar}"]) {
      expectErr(source, "bash", /zsh parameter/);
      expectErr(source, "mksh", /zsh parameter/);
    }
  });

  it("rejects zsh process substitution outside zsh", () => {
    expectErr("foo =(bar)", "bash", /=\(\.\.\.\)/);
    expectErr("foo =(bar)", "posix", /=\(\.\.\.\)/);
    expectErr("foo =(bar)", "mksh", /=\(\.\.\.\)/);
    expect(() => parse("foo =(bar)", { dialect: "zsh" })).not.toThrow();
  });

  it("parses ksh-style command substitution as commands", () => {
    const result = parse("echo ${ printf secret;}", { dialect: "bash" });
    const command = result.ast.body[0]?.command;
    expect(command?.type).toBe("SimpleCommand");
    if (command?.type !== "SimpleCommand") return;
    const substitution = command.words?.[1]?.parts[0];
    expect(substitution?.type).toBe("CmdSubst");
    if (substitution?.type !== "CmdSubst") return;
    const inner = substitution.stmts[0]?.command;
    expect(inner?.type).toBe("SimpleCommand");
    if (inner?.type !== "SimpleCommand") return;
    expect(inner.words?.map((word) => word.parts[0])).toMatchObject([
      { type: "Literal", value: "printf" },
      { type: "Literal", value: "secret" },
    ]);
    expectErr("echo ${ printf secret;}", "posix", /stmts/);
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
