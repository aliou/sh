import type { Pos, RedirOp } from "../ast";

export type OpTokenValue = "&&" | "||" | "|" | ";" | "&" | "!";

export type SymbolTokenValue = "(" | ")" | "{" | "}";

/** Position info attached to every token and inner part. */
export type WithPos = { pos: Pos; end: Pos };

export type TokenWordPart =
  | (WithPos & { type: "lit"; value: string })
  | (WithPos & { type: "sgl"; value: string })
  | (WithPos & { type: "dbl"; parts: TokenWordPart[] })
  | (WithPos & {
      type: "param";
      name: string;
      braced: boolean;
      excl?: boolean;
      length?: boolean;
      index?: string;
      slice?: { offset: string; length?: string };
      replace?: {
        all?: boolean;
        prefix?: boolean;
        suffix?: boolean;
        orig: string;
        with?: string;
      };
      exp?: { op: string; value?: string };
    })
  | (WithPos & { type: "cmd-subst"; raw: string; innerOffset: number })
  | (WithPos & { type: "arith-exp"; raw: string; innerOffset: number })
  | (WithPos & {
      type: "proc-subst";
      op: "<" | ">";
      raw: string;
      innerOffset: number;
    })
  | (WithPos & { type: "backtick"; raw: string; innerOffset: number })
  | (WithPos & {
      type: "ext-glob";
      op: "?(" | "*(" | "+(" | "@(" | "!(";
      pattern: string;
    });

export type Token =
  | (WithPos & { type: "word"; parts: TokenWordPart[] })
  | (WithPos & { type: "op"; value: OpTokenValue })
  | (WithPos & { type: "redir"; op: RedirOp; fd?: string })
  | (WithPos & { type: "symbol"; value: SymbolTokenValue })
  | (WithPos & { type: "arith-cmd"; expr: string; innerOffset: number })
  | (WithPos & { type: "heredoc-body"; content: string })
  | (WithPos & { type: "comment"; text: string });
