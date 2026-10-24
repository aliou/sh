import type {
  ParamExp,
  ParamExpOp,
  ParseOptions,
  Pos,
  Word,
  WordPart,
} from "../ast";
import type { Token, TokenWordPart } from "../tokenizer";
import { parseArithmetic } from "./arith-parser";
import { parseInnerProgram } from "./parser";

function innerBase(part: TokenWordPart & { innerOffset: number }): Pos {
  return {
    offset: part.innerOffset,
    line: part.pos.line,
    col: part.pos.col + (part.innerOffset - part.pos.offset),
  };
}

/**
 * Wrap a raw substring (e.g. a slice offset or a replacement pattern) as a
 * single-literal Word. The string was extracted from inside `${...}` so it
 * has no inner expansions to recurse into.
 */
export function strToWord(value: string): Word {
  return { type: "Word", parts: [{ type: "Literal", value }] };
}

export function convertWordPart(
  part: TokenWordPart,
  options?: ParseOptions,
): WordPart {
  switch (part.type) {
    case "lit":
      return {
        type: "Literal",
        value: part.value,
        pos: part.pos,
        end: part.end,
      };
    case "sgl":
      return {
        type: "SglQuoted",
        value: part.value,
        pos: part.pos,
        end: part.end,
      };
    case "dbl":
      return {
        type: "DblQuoted",
        parts: part.parts.map((p) => convertWordPart(p, options)),
        pos: part.pos,
        end: part.end,
      };
    case "param":
      return convertParamExp(part);
    case "cmd-subst": {
      const prog = parseInnerProgram(part.raw, options, innerBase(part));
      return {
        type: "CmdSubst",
        stmts: prog.body,
        pos: part.pos,
        end: part.end,
      };
    }
    case "arith-exp": {
      const x = parseArithmetic(part.raw, {
        offset: part.innerOffset,
        line: part.pos.line,
        col: part.pos.col + 3,
      });
      if (!x) {
        throw new Error("Empty arithmetic expansion");
      }
      return {
        type: "ArithExp",
        x,
        pos: part.pos,
        end: part.end,
      };
    }
    case "proc-subst": {
      const prog = parseInnerProgram(part.raw, options, innerBase(part));
      return {
        type: "ProcSubst",
        op: part.op,
        stmts: prog.body,
        pos: part.pos,
        end: part.end,
      };
    }
    case "backtick": {
      const prog = parseInnerProgram(part.raw, options, innerBase(part));
      return {
        type: "CmdSubst",
        stmts: prog.body,
        pos: part.pos,
        end: part.end,
      };
    }
    case "ext-glob":
      return {
        type: "ExtGlob",
        op: part.op,
        pattern: part.pattern,
        pos: part.pos,
        end: part.end,
      };
  }
}

export function convertParamExp(
  part: TokenWordPart & { type: "param" },
): ParamExp {
  const out: ParamExp = {
    type: "ParamExp",
    short: !part.braced,
    param: { type: "Literal", value: part.name },
    pos: part.pos,
    end: part.end,
  };
  if (part.length) out.length = true;
  if (part.excl) out.excl = true;
  if (part.index !== undefined) {
    out.index = strToWord(part.index);
  }
  if (part.slice) {
    const slice: ParamExp["slice"] = {
      offset: strToWord(part.slice.offset),
    };
    if (part.slice.length !== undefined) {
      slice.length = strToWord(part.slice.length);
    }
    out.slice = slice;
  }
  if (part.replace) {
    const r: ParamExp["replace"] = {
      orig: strToWord(part.replace.orig),
    };
    if (part.replace.with !== undefined) r.with = strToWord(part.replace.with);
    if (part.replace.all) r.all = true;
    if (part.replace.prefix) r.prefix = true;
    if (part.replace.suffix) r.suffix = true;
    out.replace = r;
  }
  if (part.exp) {
    const exp: ParamExp["exp"] = {
      op: part.exp.op as ParamExpOp,
    };
    if (part.exp.value !== undefined) exp.word = strToWord(part.exp.value);
    out.exp = exp;
  }
  return out;
}

export function wordFromToken(
  token: Token & { type: "word" },
  options?: ParseOptions,
): Word {
  return {
    type: "Word",
    parts: token.parts.map((part) => convertWordPart(part, options)),
    pos: token.pos,
    end: token.end,
  };
}
