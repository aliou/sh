import type { Pos, RedirOp } from "../ast";

export type OpTokenValue = "&&" | "||" | "|" | ";" | "&" | "!";

export type SymbolTokenValue = "(" | ")" | "{" | "}";

/** Position info attached to every token and inner part. */
export type WithPos = { pos: Pos; end: Pos };

export type TokenWordPart =
  // Plain literal run. A single character decoded from a bare-word backslash
  // escape (`\x` -> `x`) is emitted as its own part with `escaped: true`;
  // backslash-newline folding produces no part.
  | (WithPos & { type: "lit"; value: string; escaped?: boolean })
  | (WithPos & { type: "sgl"; value: string })
  | (WithPos & {
      // ANSI-C quoted string `$'...'`. `value`/`raw` hold the RAW inner text
      // between the quotes, backslash escapes preserved verbatim (NOT
      // decoded); `raw` spans the full `$'...'` source including delimiters.
      type: "ansi-c";
      value: string;
      raw: string;
    })
  | (WithPos & {
      // Locale string `$"..."`; inner text parsed with the same part grammar
      // as an ordinary double-quoted string.
      type: "locale-str";
      parts: TokenWordPart[];
    })
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
  | (WithPos & {
      type: "backtick";
      /** Exact source text between the surrounding backtick delimiters. */
      raw: string;
      /**
       * `raw` with backtick-context decoding applied: `\\\`` -> backtick,
       * `\\` -> backslash, `\$` -> dollar. All other backslashes stay.
       */
      body: string;
    })
  | (WithPos & {
      type: "ext-glob";
      op: "?(" | "*(" | "+(" | "@(" | "!(";
      pattern: string;
    });

export type Token =
  | (WithPos & { type: "word"; parts: TokenWordPart[] })
  | (WithPos & {
      type: "op";
      value: OpTokenValue;
      /** True when this token was emitted from a newline rather than a
       * literal `;` in the source. Only set for `;` separators. */
      newline?: boolean;
    })
  | (WithPos & { type: "redir"; op: RedirOp; fd?: string })
  | (WithPos & { type: "symbol"; value: SymbolTokenValue })
  | (WithPos & { type: "arith-cmd"; expr: string; innerOffset: number })
  | (WithPos & {
      type: "heredoc-body";
      /** Body with newlines as in source; leading tabs stripped for `<<-`. */
      content: string;
      /** True iff the delimiter word was fully unquoted. */
      expand: boolean;
      /** Delimiter text bash matches: source span with quote removal. */
      delimiter: string;
      /** Delimiter word contained any quoted part (`'`, `"`, `\`). */
      quoted: boolean;
    })
  | (WithPos & { type: "comment"; text: string });
