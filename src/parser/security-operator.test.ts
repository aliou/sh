// biome-ignore-all lint/suspicious/noTemplateCurlyInString: shell syntax in test strings
import { describe, expect, it } from "vitest";
import type { SimpleCommand } from "../ast";

function firstAssignment(src: string) {
  const { ast } = parse(src);
  const cmd = ast.body[0]?.command as SimpleCommand;
  if (cmd.type !== "SimpleCommand") throw new Error("expected SimpleCommand");
  const assign = cmd.assignments?.[0];
  if (!assign) throw new Error("expected an assignment");
  return { ast, assign };
}

import { parse } from "../parse";
import { extractCommandNames } from "../test-helpers/extract-command-names";
import { hasSubstitution } from "../test-helpers/has-substitution";

// Payloads from the security audit run dir
// (tmp/security-audit/run-1/lib/cases-v3-operator.json): `${...}` operator
// words, indexed array elements, and extglob patterns must expose embedded
// substitutions as structured AST nodes instead of opaque literals.
describe("security: operator words parsed structurally", () => {
  it("param_default: ${x:-$(...)} surfaces the command substitution", () => {
    const { ast } = parse("echo ${x:-$(echo PARAM_MARKER >&2)}");
    expect(hasSubstitution(ast)).toBe(true);
    expect(extractCommandNames(ast)).toContain("echo");
  });

  it("param_assign_backtick: ${x:=`...`} surfaces the backtick substitution", () => {
    const { ast } = parse("echo ${x:=`echo PARAM_BT_MARKER >&2`}");
    expect(hasSubstitution(ast)).toBe(true);
  });

  it("param_control: plain $(...) still surfaces", () => {
    const { ast } = parse("echo $(echo PARAM_CONTROL_MARKER >&2)");
    expect(hasSubstitution(ast)).toBe(true);
  });

  it("array_indexed_value: a=([0]=$(...)) keeps the value structured", () => {
    const { ast, assign } = firstAssignment(
      "a=([0]=$(echo ARRAY_VALUE_MARKER >&2))",
    );
    expect(hasSubstitution(ast)).toBe(true);
    const elem = assign.array?.elems[0];
    expect(elem?.index).toMatchAst({
      type: "Word",
      parts: [{ type: "Literal", value: "0" }],
    });
    expect(elem?.value?.parts[0]?.type).toBe("CmdSubst");
  });

  it("array_indexed_index: a=([0$(...)]=v) keeps the index structured", () => {
    const { ast, assign } = firstAssignment(
      "a=([0$(echo ARRAY_INDEX_MARKER >&2)]=v)",
    );
    expect(hasSubstitution(ast)).toBe(true);
    const elem = assign.array?.elems[0];
    expect(elem?.index?.parts.map((p) => p.type)).toEqual([
      "Literal",
      "CmdSubst",
    ]);
    expect(elem?.value).toMatchAst({
      type: "Word",
      parts: [{ type: "Literal", value: "v" }],
    });
  });

  it("array_control: a=($(...)) keeps the unstructured element visible", () => {
    const { ast, assign } = firstAssignment(
      "a=($(echo ARRAY_CONTROL_MARKER >&2))",
    );
    expect(hasSubstitution(ast)).toBe(true);
    expect(assign.array?.elems[0]?.value?.parts[0]?.type).toBe("CmdSubst");
  });

  it("extglob: @(...) pattern gains a structural word", () => {
    const { ast } = parse("echo @($(echo EXTGLOB_MARKER >&2))");
    expect(hasSubstitution(ast)).toBe(true);
    const cmd = ast.body[0]?.command as SimpleCommand;
    const part = cmd.words?.[1]?.parts[0];
    expect(part?.type).toBe("ExtGlob");
    if (part?.type !== "ExtGlob") throw new Error("expected ExtGlob");
    expect(part.pattern).toBe("$(echo EXTGLOB_MARKER >&2)");
    expect(part.word?.parts[0]?.type).toBe("CmdSubst");
  });

  it("extglob: a pure literal pattern does not gain a word", () => {
    const { ast } = parse("echo @(foo|bar)");
    const cmd = ast.body[0]?.command as SimpleCommand;
    const part = cmd.words?.[1]?.parts[0];
    if (part?.type !== "ExtGlob") throw new Error("expected ExtGlob");
    expect(part.word).toBeUndefined();
  });

  it("plain ${x:-word} still parses to a literal operator word", () => {
    const { ast } = parse("echo ${x:-default}");
    const cmd = ast.body[0]?.command as SimpleCommand;
    const param = cmd.words?.[1]?.parts[0];
    if (param?.type !== "ParamExp") throw new Error("expected ParamExp");
    expect(param.exp?.word).toMatchAst({
      type: "Word",
      parts: [{ type: "Literal", value: "default" }],
    });
  });

  it("${x:-hello world} keeps the whitespace between fragment words", () => {
    const { ast } = parse("echo ${x:-hello world}");
    const cmd = ast.body[0]?.command as SimpleCommand;
    const param = cmd.words?.[1]?.parts[0];
    if (param?.type !== "ParamExp") throw new Error("expected ParamExp");
    expect(param.exp?.word).toMatchAst({
      type: "Word",
      parts: [{ type: "Literal", value: "hello world" }],
    });
  });

  it("${x:-a  b} keeps repeated whitespace verbatim", () => {
    const { ast } = parse("echo ${x:-a  b}");
    const cmd = ast.body[0]?.command as SimpleCommand;
    const param = cmd.words?.[1]?.parts[0];
    if (param?.type !== "ParamExp") throw new Error("expected ParamExp");
    expect(param.exp?.word).toMatchAst({
      type: "Word",
      parts: [{ type: "Literal", value: "a  b" }],
    });
  });

  it("reparsed operator words anchor nested parts to the source", () => {
    const src = "echo ${x:-$(echo e)}";
    const { ast } = parse(src);
    const cmd = ast.body[0]?.command as SimpleCommand;
    const param = cmd.words?.[1]?.parts[0];
    if (param?.type !== "ParamExp") throw new Error("expected ParamExp");
    const subst = param.exp?.word?.parts[0];
    if (subst?.type !== "CmdSubst") throw new Error("expected CmdSubst");
    expect(subst.pos?.offset).toBe(src.indexOf("$(echo e)"));
    expect(subst.end?.offset).toBe(src.indexOf("$(echo e)") + 9);
  });

  it("reparsed literal fragments anchor to the source too", () => {
    const src = "echo ${x:-hello world}";
    const { ast } = parse(src);
    const cmd = ast.body[0]?.command as SimpleCommand;
    const param = cmd.words?.[1]?.parts[0];
    if (param?.type !== "ParamExp") throw new Error("expected ParamExp");
    const lit = param.exp?.word?.parts[0];
    if (lit?.type !== "Literal") throw new Error("expected Literal");
    expect(lit.pos?.offset).toBe(src.indexOf("hello world"));
  });

  it("descendants of a reparsed CmdSubst anchor to the source", () => {
    const src = "echo ${x:-$(echo ${y:-z})}";
    const { ast } = parse(src);
    const cmd = ast.body[0]?.command as SimpleCommand;
    const param = cmd.words?.[1]?.parts[0];
    if (param?.type !== "ParamExp") throw new Error("expected ParamExp");
    const subst = param.exp?.word?.parts[0];
    if (subst?.type !== "CmdSubst") throw new Error("expected CmdSubst");
    expect(subst.pos?.offset).toBe(src.indexOf("$(echo ${y:-z})"));
    // The substitution body's statements anchor to the source, not to the
    // body or the operand fragment.
    const inner = subst.stmts[0]?.command as SimpleCommand;
    const name = inner.words?.[0]?.parts[0];
    expect(name?.pos?.offset).toBe(src.indexOf("$(echo") + 2);
    const nested = inner.words?.[1]?.parts[0];
    if (nested?.type !== "ParamExp") throw new Error("expected ParamExp");
    expect(nested.pos?.offset).toBe(src.indexOf("${y:-z}"));
    const z = nested.exp?.word?.parts[0];
    expect(z?.pos?.offset).toBe(src.indexOf("z}"));
  });

  it("an ArithExp inside an operand anchors to the source", () => {
    const src = "echo ${x:-$((1 + y))}";
    const { ast } = parse(src);
    const cmd = ast.body[0]?.command as SimpleCommand;
    const param = cmd.words?.[1]?.parts[0];
    if (param?.type !== "ParamExp") throw new Error("expected ParamExp");
    const arith = param.exp?.word?.parts[0];
    if (arith?.type !== "ArithExp") throw new Error("expected ArithExp");
    expect(arith.pos?.offset).toBe(src.indexOf("$((1 + y))"));
    expect(arith.end?.offset).toBe(src.indexOf("$((1 + y))") + 10);
  });

  it("parts inside a quoted fragment anchor to the source", () => {
    const src = 'echo ${x:-"a $b c"}';
    const { ast } = parse(src);
    const cmd = ast.body[0]?.command as SimpleCommand;
    const param = cmd.words?.[1]?.parts[0];
    if (param?.type !== "ParamExp") throw new Error("expected ParamExp");
    const dbl = param.exp?.word?.parts[0];
    if (dbl?.type !== "DblQuoted") throw new Error("expected DblQuoted");
    expect(dbl.pos?.offset).toBe(src.indexOf('"a $b c"'));
    const [before, inner, after] = dbl.parts;
    expect(before?.pos?.offset).toBe(src.indexOf('"a $b c"') + 1);
    expect(inner?.type).toBe("ParamExp");
    expect(inner?.pos?.offset).toBe(src.indexOf("$b"));
    expect(after?.pos?.offset).toBe(src.indexOf(' c"'));
  });

  it("a multiline operand keeps line and col after the newline", () => {
    const src = "echo ${x:-$(echo a\necho b)}";
    const { ast } = parse(src);
    const cmd = ast.body[0]?.command as SimpleCommand;
    const param = cmd.words?.[1]?.parts[0];
    if (param?.type !== "ParamExp") throw new Error("expected ParamExp");
    const subst = param.exp?.word?.parts[0];
    if (subst?.type !== "CmdSubst") throw new Error("expected CmdSubst");
    const first = subst.stmts[0]?.command as SimpleCommand;
    const firstName = first.words?.[0]?.parts[0];
    expect(firstName?.pos).toMatchObject({ offset: 12, line: 1, col: 13 });
    const second = subst.stmts[1]?.command as SimpleCommand;
    const secondName = second.words?.[0]?.parts[0];
    expect(secondName?.pos).toMatchObject({
      offset: src.indexOf("echo b"),
      line: 2,
      col: 1,
    });
  });

  it("a newline in an earlier fragment shifts later fragment bases", () => {
    // The replacement pattern spans a newline, so the `with` word starts
    // on line 2 even though the expansion starts on line 1.
    const src = "echo ${x/a\nb/c}";
    const { ast } = parse(src);
    const cmd = ast.body[0]?.command as SimpleCommand;
    const param = cmd.words?.[1]?.parts[0];
    if (param?.type !== "ParamExp") throw new Error("expected ParamExp");
    const withLit = param.replace?.with?.parts[0];
    if (withLit?.type !== "Literal") throw new Error("expected Literal");
    expect(withLit.value).toBe("c");
    expect(withLit.pos).toMatchObject({ offset: 13, line: 2, col: 3 });
  });

  it("${x:?msg} parses the error operand structurally", () => {
    const { ast } = parse("echo ${x:?msg}");
    const cmd = ast.body[0]?.command as SimpleCommand;
    const param = cmd.words?.[1]?.parts[0];
    if (param?.type !== "ParamExp") throw new Error("expected ParamExp");
    expect(param.exp?.op).toBe(":?");
    expect(param.exp?.word).toMatchAst({
      type: "Word",
      parts: [{ type: "Literal", value: "msg" }],
    });
  });

  it("${x:?$(echo e)} surfaces the error operand's command substitution", () => {
    const { ast } = parse("echo ${x:?$(echo ERR_MARKER >&2)}");
    expect(hasSubstitution(ast)).toBe(true);
    const cmd = ast.body[0]?.command as SimpleCommand;
    const param = cmd.words?.[1]?.parts[0];
    if (param?.type !== "ParamExp") throw new Error("expected ParamExp");
    expect(param.exp?.word?.parts[0]?.type).toBe("CmdSubst");
  });

  it("${x:+alt} parses the alternate operand structurally", () => {
    const { ast } = parse("echo ${x:+alt}");
    const cmd = ast.body[0]?.command as SimpleCommand;
    const param = cmd.words?.[1]?.parts[0];
    if (param?.type !== "ParamExp") throw new Error("expected ParamExp");
    expect(param.exp?.op).toBe(":+");
    expect(param.exp?.word).toMatchAst({
      type: "Word",
      parts: [{ type: "Literal", value: "alt" }],
    });
  });

  it("${x/pat/with} parses pattern replacement structurally", () => {
    const { ast } = parse("echo ${x/pat/with}");
    const cmd = ast.body[0]?.command as SimpleCommand;
    const param = cmd.words?.[1]?.parts[0];
    if (param?.type !== "ParamExp") throw new Error("expected ParamExp");
    expect(param.replace?.orig).toMatchAst({
      type: "Word",
      parts: [{ type: "Literal", value: "pat" }],
    });
    expect(param.replace?.with).toMatchAst({
      type: "Word",
      parts: [{ type: "Literal", value: "with" }],
    });
  });

  it("${x/pat/$(echo w)} surfaces the replacement's command substitution", () => {
    const { ast } = parse("echo ${x/pat/$(echo REPLACE_MARKER >&2)}");
    expect(hasSubstitution(ast)).toBe(true);
    const cmd = ast.body[0]?.command as SimpleCommand;
    const param = cmd.words?.[1]?.parts[0];
    if (param?.type !== "ParamExp") throw new Error("expected ParamExp");
    expect(param.replace?.with?.parts[0]?.type).toBe("CmdSubst");
  });

  it("${x:1:2} parses the slice offset and length structurally", () => {
    const { ast } = parse("echo ${x:1:2}");
    const cmd = ast.body[0]?.command as SimpleCommand;
    const param = cmd.words?.[1]?.parts[0];
    if (param?.type !== "ParamExp") throw new Error("expected ParamExp");
    expect(param.slice?.offset).toMatchAst({
      type: "Word",
      parts: [{ type: "Literal", value: "1" }],
    });
    expect(param.slice?.length).toMatchAst({
      type: "Word",
      parts: [{ type: "Literal", value: "2" }],
    });
  });

  it("${a[i]} parses the array index structurally", () => {
    const { ast } = parse("echo ${a[i]}");
    const cmd = ast.body[0]?.command as SimpleCommand;
    const param = cmd.words?.[1]?.parts[0];
    if (param?.type !== "ParamExp") throw new Error("expected ParamExp");
    expect(param.index).toMatchAst({
      type: "Word",
      parts: [{ type: "Literal", value: "i" }],
    });
  });

  it("${a[$(echo i)]} surfaces the index's command substitution", () => {
    const { ast } = parse("echo ${a[$(echo INDEX_MARKER >&2)]}");
    expect(hasSubstitution(ast)).toBe(true);
    const cmd = ast.body[0]?.command as SimpleCommand;
    const param = cmd.words?.[1]?.parts[0];
    if (param?.type !== "ParamExp") throw new Error("expected ParamExp");
    expect(param.index?.parts[0]?.type).toBe("CmdSubst");
  });
});
