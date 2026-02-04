import type { RedirOp } from "../ast";

export type OpTokenValue = "&&" | "||" | "|" | ";" | "&" | "!";

export type SymbolTokenValue = "(" | ")" | "{" | "}";

export type TokenWordPart =
  | { type: "lit"; value: string }
  | { type: "sgl"; value: string }
  | { type: "dbl"; parts: TokenWordPart[] }
  | {
      type: "param";
      name: string;
      braced: boolean;
      op?: string;
      value?: string;
    }
  | { type: "cmd-subst"; raw: string }
  | { type: "arith-exp"; raw: string }
  | { type: "proc-subst"; op: "<" | ">"; raw: string }
  | { type: "backtick"; raw: string };

export type Token =
  | { type: "word"; parts: TokenWordPart[] }
  | { type: "op"; value: OpTokenValue }
  | { type: "redir"; op: RedirOp; fd?: string }
  | { type: "symbol"; value: SymbolTokenValue }
  | { type: "arith-cmd"; expr: string }
  | { type: "heredoc-body"; content: string }
  | { type: "comment"; text: string };
