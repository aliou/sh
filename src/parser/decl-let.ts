import type { Assignment, DeclClause, LetClause, Redirect, Word } from "../ast";
import { checkLang } from "../dialect";
import { tokenPartsText } from "../tokenizer";
import { tryParseAssignment } from "./commands";
import { DECL_KEYWORDS } from "./constants";
import { parseRedirect } from "./redirects";
import type { ParserState } from "./state";
import { wordFromToken } from "./words";

export function matchDeclKeyword(s: ParserState): boolean {
  const token = s.peek();
  if (token?.type !== "word" || token.parts.length !== 1) return false;
  const part = token.parts[0];
  return part?.type === "lit" && DECL_KEYWORDS.has(part.value);
}

export function parseDeclClause(s: ParserState): DeclClause {
  const variantToken = s.consume();
  if (variantToken.type !== "word") {
    throw new Error("Expected decl keyword");
  }
  const variant = tokenPartsText(variantToken.parts) as DeclClause["variant"];
  // POSIX only standardizes `export` and `readonly`. Bash/mksh/zsh add the
  // others (`declare`, `local`, `typeset`, `nameref`).
  if (variant !== "export" && variant !== "readonly") {
    checkLang(s.options.dialect, variantToken.pos, variant, [
      "bash",
      "mksh",
      "zsh",
    ]);
  }

  const args: Word[] = [];
  const assigns: Assignment[] = [];
  const redirects: Redirect[] = [];

  while (true) {
    if (s.matchRedir()) {
      redirects.push(parseRedirect(s));
      continue;
    }

    if (s.matchWord()) {
      const token = s.peek();
      if (token?.type !== "word") break;

      const assignment = tryParseAssignment(s, token);
      if (assignment) {
        assigns.push(assignment);
        continue;
      }

      s.consume();
      args.push(wordFromToken(token, s.options));
      continue;
    }

    break;
  }

  const lastEnd = s.lastEnd() ?? variantToken.end;
  const decl: DeclClause = {
    type: "DeclClause",
    variant,
    pos: variantToken.pos,
    end: lastEnd,
  };
  if (args.length > 0) decl.args = args;
  if (assigns.length > 0) decl.assigns = assigns;
  if (redirects.length > 0) decl.redirects = redirects;
  return decl;
}

export function parseLetClause(s: ParserState): LetClause {
  const letTok = s.consumeKeyword("let");
  checkLang(s.options.dialect, letTok.pos, "let", ["bash", "mksh", "zsh"]);
  const exprs: Word[] = [];
  const redirects: Redirect[] = [];

  while (true) {
    if (s.matchRedir()) {
      redirects.push(parseRedirect(s));
      continue;
    }

    if (s.matchWord()) {
      const token = s.consume();
      if (token.type !== "word") break;
      exprs.push(wordFromToken(token, s.options));
      continue;
    }

    break;
  }

  if (exprs.length === 0) {
    throw new Error("let requires at least one expression");
  }

  const clause: LetClause = {
    type: "LetClause",
    exprs,
    pos: letTok.pos,
    end: s.lastEnd() ?? letTok.end,
  };
  if (redirects.length > 0) clause.redirects = redirects;
  return clause;
}
