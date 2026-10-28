import { describe, expect, it } from "vitest";
import { parse } from "../parse";
import { extractCommandNames } from "../test-helpers/extract-command-names";
import { hasSubstitution } from "../test-helpers/has-substitution";

// Payloads from the security audit run dir
// (tmp/security-audit/run-1/lib/cases-v3-arith.json): bash evaluates the
// indexed-assignment operands of let/declare/typeset/local as arithmetic,
// which expands subscripts — quoting must not hide embedded substitutions.
// export/readonly stay plain (no arithmetic evaluation).
describe("security: arithmetic operand substitution visibility", () => {
  it("let_sq_subst: let 'a[$(...)]=1' surfaces the substitution", () => {
    const { ast } = parse("let 'a[$(echo LET_MARK >&2)]=1'");
    expect(hasSubstitution(ast)).toBe(true);
    expect(extractCommandNames(ast)).toContain("echo");
  });

  it("let_sq_backtick: let 'a[`...`]=1' surfaces the backtick", () => {
    const { ast } = parse("let 'a[`echo LET_BT_MARK >&2`]=1'");
    expect(hasSubstitution(ast)).toBe(true);
  });

  it("decl_sq_a: declare -a 'a[$(...)]=1' surfaces the substitution", () => {
    const { ast } = parse("declare -a 'a[$(echo DECL_MARK >&2)]=1'");
    expect(hasSubstitution(ast)).toBe(true);
  });

  it("typeset_sq_a: typeset -a 'a[$(...)]=1' surfaces the substitution", () => {
    const { ast } = parse("typeset -a 'a[$(echo TYPESET_MARK >&2)]=1'");
    expect(hasSubstitution(ast)).toBe(true);
  });

  it("local_sq_a: local -a 'a[$(...)]=1' inside a function surfaces it", () => {
    const { ast } = parse("f() { local -a 'a[$(echo LOCAL_MARK >&2)]=1'; }; f");
    expect(hasSubstitution(ast)).toBe(true);
  });

  it("let_unquoted_control: unquoted let operand stays visible", () => {
    const { ast } = parse("let a[$(echo LET_UQ_MARK >&2)]=1");
    expect(hasSubstitution(ast)).toBe(true);
  });

  it("arithcmd_control: (( a[$(...)]=1 )) is rejected, not hidden", () => {
    expect(() => parse("(( a[$(echo AR_MARK >&2)]=1 ))")).toThrow();
  });

  it("neg_export: export 'a[$(...)]=1' stays a plain word", () => {
    const { ast } = parse("export 'a[$(echo EXPORT_MARK >&2)]=1'");
    expect(hasSubstitution(ast)).toBe(false);
  });

  it("neg_readonly: readonly 'a[$(...)]=1' stays a plain word", () => {
    const { ast } = parse("readonly 'a[$(echo READONLY_MARK >&2)]=1'");
    expect(hasSubstitution(ast)).toBe(false);
  });

  it("a let operand without an array subscript stays a plain word", () => {
    const { ast } = parse("let 'x=1'");
    expect(hasSubstitution(ast)).toBe(false);
  });
});
