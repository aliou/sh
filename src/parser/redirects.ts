import type { Pos, Redirect } from "../ast";
import type { ParserState } from "./state";
import { wordFromToken } from "./words";

export function parseRedirect(s: ParserState): Redirect {
  const token = s.consume();
  if (token.type !== "redir") {
    throw new Error("Expected redirect token");
  }
  const targetToken = s.consume();
  if (targetToken.type !== "word") {
    throw new Error("Redirect must be followed by a word");
  }
  const target = wordFromToken(targetToken, s.options);
  const redirect: Redirect = token.fd
    ? {
        type: "Redirect",
        op: token.op,
        fd: token.fd,
        target,
        pos: token.pos,
        end: target.end ?? targetToken.end,
      }
    : {
        type: "Redirect",
        op: token.op,
        target,
        pos: token.pos,
        end: target.end ?? targetToken.end,
      };
  if (token.op === "<<" || token.op === "<<-") {
    s.pendingHeredocs.push(redirect);
  }
  return redirect;
}

/**
 * Attach tokenizer-emitted heredoc-body tokens to the redirects that
 * opened them, in opener order. Orphan body tokens (no pending redirect)
 * are left in the stream for the caller to report.
 */
export function drainPendingHeredocs(s: ParserState): void {
  while (s.peek()?.type === "heredoc-body" && s.pendingHeredocs.length > 0) {
    const redirect = s.pendingHeredocs.shift();
    if (!redirect) break;
    const bodyToken = s.consume();
    if (bodyToken.type !== "heredoc-body") break;
    redirect.heredoc = {
      type: "Word",
      parts: [
        {
          type: "Literal",
          value: bodyToken.content,
          pos: bodyToken.pos,
          end: bodyToken.end,
        },
      ],
      pos: bodyToken.pos,
      end: bodyToken.end,
    };
    redirect.end = bodyToken.end;
  }
}

/**
 * Consume any redirects immediately following a compound command's closing
 * keyword (`done`, `fi`, `}`, `)`, `esac`, `]]`, ...) and attach them to
 * the compound node itself, like bash and mvdan/sh do. Heredoc openers
 * queue in the pending list; their bodies drain later as usual. The field
 * stays unset when no redirects follow.
 */
export function parseTrailingRedirects(
  s: ParserState,
  node: { redirects?: Redirect[]; end?: Pos },
): void {
  if (s.suppressTrailingRedirects) return;
  if (!s.matchRedir()) return;
  const redirects: Redirect[] = [];
  while (s.matchRedir()) {
    redirects.push(parseRedirect(s));
  }
  node.redirects = redirects;
  const end = s.lastEnd();
  if (end) node.end = end;
}

/** Run `fn` with trailing-redirect capture disabled (see the field doc). */
export function withSuppressedTrailingRedirects<T>(
  s: ParserState,
  fn: () => T,
): T {
  const prev = s.suppressTrailingRedirects;
  s.suppressTrailingRedirects = true;
  try {
    return fn();
  } finally {
    s.suppressTrailingRedirects = prev;
  }
}

/**
 * Re-enable trailing-redirect capture while parsing a nested statement
 * list, so redirects inside e.g. a coproc body still attach to the inner
 * compound they close.
 */
export function allowNestedTrailingRedirects<T>(
  s: ParserState,
  fn: () => T,
): T {
  const prev = s.suppressTrailingRedirects;
  s.suppressTrailingRedirects = false;
  try {
    return fn();
  } finally {
    s.suppressTrailingRedirects = prev;
  }
}
