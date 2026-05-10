// biome-ignore-all lint/suspicious/noTemplateCurlyInString: shell syntax in test strings
import { describe, expect, it } from "vitest";
import type { ParamExp, SimpleCommand, Word } from "../ast";
import { parse } from "../parse";

function paramOf(src: string): ParamExp {
  const { ast } = parse(src);
  const cmd = ast.body[0]?.command as SimpleCommand;
  const part = cmd.words?.[1]?.parts[0];
  if (part?.type !== "ParamExp") {
    throw new Error(`expected ParamExp, got ${part?.type}`);
  }
  return part;
}

const litWord = (value: string): Word => ({
  type: "Word",
  parts: [{ type: "Literal", value }],
});

describe("ParamExp: simple shapes", () => {
  it("$var -> short ParamExp", () => {
    const p = paramOf("echo $foo");
    expect(p.short).toBe(true);
    expect(p.param.value).toBe("foo");
    expect(p.exp).toBeUndefined();
  });

  it("${var} -> braced ParamExp", () => {
    const p = paramOf("echo ${foo}");
    expect(p.short).toBe(false);
    expect(p.param.value).toBe("foo");
  });

  it("${#var} -> length flag", () => {
    const p = paramOf("echo ${#foo}");
    expect(p.length).toBe(true);
    expect(p.param.value).toBe("foo");
  });

  it("${!var} -> excl flag (indirect)", () => {
    const p = paramOf("echo ${!foo}");
    expect(p.excl).toBe(true);
    expect(p.param.value).toBe("foo");
  });
});

describe("ParamExp: default/error operators", () => {
  it("${var:-default}", () => {
    const p = paramOf("echo ${foo:-bar}");
    expect(p.exp).toMatchAst({ op: ":-", word: litWord("bar") });
  });

  it("${var-default}", () => {
    const p = paramOf("echo ${foo-bar}");
    expect(p.exp).toMatchAst({ op: "-", word: litWord("bar") });
  });

  it("${var:+alt}", () => {
    const p = paramOf("echo ${foo:+bar}");
    expect(p.exp).toMatchAst({ op: ":+", word: litWord("bar") });
  });

  it("${var:?error}", () => {
    const p = paramOf("echo ${foo:?missing}");
    expect(p.exp).toMatchAst({ op: ":?", word: litWord("missing") });
  });
});

describe("ParamExp: prefix/suffix strip", () => {
  it("${var#prefix}", () => {
    const p = paramOf("echo ${foo#bar}");
    expect(p.exp).toMatchAst({ op: "#", word: litWord("bar") });
  });

  it("${var##prefix} (longest match)", () => {
    const p = paramOf("echo ${foo##bar}");
    expect(p.exp).toMatchAst({ op: "##", word: litWord("bar") });
  });

  it("${var%suffix}", () => {
    const p = paramOf("echo ${foo%bar}");
    expect(p.exp).toMatchAst({ op: "%", word: litWord("bar") });
  });

  it("${var%%suffix}", () => {
    const p = paramOf("echo ${foo%%bar}");
    expect(p.exp).toMatchAst({ op: "%%", word: litWord("bar") });
  });
});

describe("ParamExp: case modification", () => {
  it("${var^} (uppercase first)", () => {
    const p = paramOf("echo ${foo^}");
    expect(p.exp).toMatchAst({ op: "^" });
  });

  it("${var^^} (uppercase all)", () => {
    const p = paramOf("echo ${foo^^}");
    expect(p.exp).toMatchAst({ op: "^^" });
  });

  it("${var,} (lowercase first)", () => {
    const p = paramOf("echo ${foo,}");
    expect(p.exp).toMatchAst({ op: "," });
  });

  it("${var,,} (lowercase all)", () => {
    const p = paramOf("echo ${foo,,}");
    expect(p.exp).toMatchAst({ op: ",," });
  });
});

describe("ParamExp: substring slice", () => {
  it("${var:offset}", () => {
    const p = paramOf("echo ${foo:1}");
    expect(p.slice).toMatchAst({ offset: litWord("1") });
    expect(p.slice?.length).toBeUndefined();
  });

  it("${var:offset:length}", () => {
    const p = paramOf("echo ${foo:1:3}");
    expect(p.slice).toMatchAst({ offset: litWord("1"), length: litWord("3") });
  });

  it("${var: -1} (negative offset has leading space)", () => {
    const p = paramOf("echo ${foo: -1}");
    expect(p.slice).toMatchAst({ offset: litWord("-1") });
  });
});

describe("ParamExp: pattern replacement", () => {
  it("${var/foo/bar}", () => {
    const p = paramOf("echo ${foo/aa/bb}");
    expect(p.replace).toMatchAst({
      orig: litWord("aa"),
      with: litWord("bb"),
    });
  });

  it("${var//foo/bar} -> all", () => {
    const p = paramOf("echo ${foo//aa/bb}");
    expect(p.replace).toMatchAst({
      all: true,
      orig: litWord("aa"),
      with: litWord("bb"),
    });
  });

  it("${var/#foo/bar} -> prefix anchor", () => {
    const p = paramOf("echo ${foo/#aa/bb}");
    expect(p.replace).toMatchAst({
      prefix: true,
      orig: litWord("aa"),
      with: litWord("bb"),
    });
  });

  it("${var/%foo/bar} -> suffix anchor", () => {
    const p = paramOf("echo ${foo/%aa/bb}");
    expect(p.replace).toMatchAst({
      suffix: true,
      orig: litWord("aa"),
      with: litWord("bb"),
    });
  });

  it("${var/foo} (no replacement)", () => {
    const p = paramOf("echo ${foo/aa}");
    expect(p.replace).toMatchAst({ orig: litWord("aa") });
  });
});

describe("ParamExp: indexing", () => {
  it("${arr[0]}", () => {
    const p = paramOf("echo ${arr[0]}");
    expect(p.index).toMatchAst(litWord("0"));
  });

  it("${arr[@]}", () => {
    const p = paramOf("echo ${arr[@]}");
    expect(p.index).toMatchAst(litWord("@"));
  });
});
