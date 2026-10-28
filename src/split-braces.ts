import type { BraceExp, Literal, Word, WordPart } from "./ast";
import { isAsciiLetter, isInteger } from "./tokenizer/charsets";

/**
 * State for one open brace: the BraceExp accumulating elements plus whether
 * a comma separator has been seen. A comma anywhere makes the brace a list;
 * `..` seen after a comma stays inside the element's literal text, and `..`
 * splits made before the first comma are merged back (comma lists keep
 * precedence over ranges: `{echo,printf..x}` is the list `echo`, `printf..x`).
 */
type BraceState = {
  br: BraceExp;
  hadComma: boolean;
};

/**
 * Parse Bash brace expansions inside a word's literal parts, replacing them
 * with `BraceExp` nodes. Mutates the word in place. Returns true if the word
 * was modified.
 *
 * Mirrors the contract of mvdan/sh's `syntax.SplitBraces`: malformed brace
 * expressions are left as plain literals rather than producing errors.
 * Escaped braces/commas arrive as single-character Literal parts (per the
 * tokenizer quoting contract) and never take part in brace syntax.
 */
export function splitBraces(word: Word): boolean {
  const hasBrace = word.parts.some(
    (p) => p.type === "Literal" && p.value.includes("{"),
  );
  if (!hasBrace) return false;

  const top: Word = { type: "Word", parts: [] };
  let acc: Word = top;
  let cur: BraceState | undefined;
  const open: BraceState[] = [];

  const fixedLit = (value: string): Literal => ({ type: "Literal", value });

  const addLit = (l: WordPart) => {
    acc.parts.push(l);
  };

  const pop = (): BraceState => {
    const old = cur;
    open.pop();
    if (open.length === 0) {
      cur = undefined;
      acc = top;
    } else {
      cur = open[open.length - 1];
      const lastElem = cur?.br.elems[cur.br.elems.length - 1];
      if (lastElem) acc = lastElem;
    }
    if (!old) {
      // Should never happen given the call sites, but keep the type checker happy.
      throw new Error("invariant: pop called with no current brace");
    }
    return old;
  };

  const splitElem = () => {
    if (!cur) return;
    const inner: Word = { type: "Word", parts: [] };
    cur.br.elems.push(inner);
    acc = inner;
  };

  /**
   * A comma arrived inside a brace with no earlier comma: it takes
   * precedence over any `..` splits made so far, which merge back into the
   * first element's literal text, preserving the original `..` spelling.
   */
  const mergeSeqSplits = (st: BraceState) => {
    if (st.br.elems.length < 2) return;
    const merged: Word = { type: "Word", parts: [] };
    const push = (part: WordPart) => {
      const prev = merged.parts[merged.parts.length - 1];
      if (part.type === "Literal" && prev?.type === "Literal") {
        prev.value += part.value;
        return;
      }
      merged.parts.push(part);
    };
    st.br.elems.forEach((elem, idx) => {
      if (idx > 0) push(fixedLit(".."));
      for (const part of elem.parts) push(part);
    });
    st.br.elems = [merged];
  };

  for (let pi = 0; pi < word.parts.length; pi++) {
    const wp = word.parts[pi] as WordPart;
    if (wp.type !== "Literal") {
      acc.parts.push(wp);
      continue;
    }
    const value = wp.value;
    // Escaped characters arrive as their own single-character Literal
    // parts, sandwiched between plain lit runs (the tokenizer merges
    // contiguous literal text otherwise). A lone `{`, `}` or `,` bordered
    // by plain Literals is escaped data, never brace syntax; a lone `{`
    // bordering an expansion (e.g. `{$foo,bar}`) still opens a brace.
    if (
      value.length === 1 &&
      (value === "{" || value === "}" || value === ",") &&
      (word.parts[pi - 1]?.type === "Literal" ||
        word.parts[pi + 1]?.type === "Literal")
    ) {
      addLit(wp);
      continue;
    }
    let last = 0;

    const flushSlice = (j: number) => {
      if (last === j) return;
      addLit({ type: "Literal", value: value.slice(last, j) });
    };

    let j = 0;
    while (j < value.length) {
      const c = value[j];
      switch (c) {
        case "\\": {
          j += 2;
          continue;
        }
        case "{": {
          flushSlice(j);
          const inner: Word = { type: "Word", parts: [] };
          const next: BraceState = {
            br: { type: "BraceExp", elems: [inner] },
            hadComma: false,
          };
          acc = inner;
          cur = next;
          open.push(next);
          break;
        }
        case ",": {
          if (!cur) {
            j += 1;
            continue;
          }
          flushSlice(j);
          if (!cur.hadComma) {
            cur.hadComma = true;
            mergeSeqSplits(cur);
          }
          splitElem();
          break;
        }
        case ".": {
          if (!cur || cur.hadComma || value[j + 1] !== ".") {
            j += 1;
            continue;
          }
          flushSlice(j);
          cur.br.sequence = true;
          splitElem();
          j += 1; // consume the second dot below via last = j+1
          break;
        }
        case "}": {
          if (!cur) {
            j += 1;
            continue;
          }
          flushSlice(j);
          const st = pop();
          const br = st.br;
          if (br.elems.length === 1) {
            // Single-element braces collapse back to literals.
            addLit(fixedLit("{"));
            const only = br.elems[0];
            if (only) acc.parts.push(...only.parts);
            addLit(fixedLit("}"));
            break;
          }
          if (st.hadComma) {
            // A comma anywhere in the brace makes it a list; `..` inside
            // elements is literal text, already merged/preserved.
            delete br.sequence;
            acc.parts.push(br);
            break;
          }
          if (!br.sequence) {
            acc.parts.push(br);
            break;
          }
          if (validSequence(br)) {
            acc.parts.push(br);
            break;
          }
          // Broken sequence falls back to literals with the original
          // `..` separators preserved: { e1 .. e2 [.. e3] }
          addLit(fixedLit("{"));
          for (let i = 0; i < br.elems.length; i++) {
            if (i > 0) addLit(fixedLit(".."));
            const e = br.elems[i];
            if (e) acc.parts.push(...e.parts);
          }
          addLit(fixedLit("}"));
          break;
        }
        default: {
          j += 1;
          continue;
        }
      }
      last = j + 1;
      j += 1;
    }
    if (last === 0) {
      addLit(wp);
    } else if (last < value.length) {
      addLit({ type: "Literal", value: value.slice(last) });
    }
  }

  // Unclosed open braces fall back to plain literals, preserving the
  // original separator spelling.
  while (acc !== top) {
    const st = pop();
    addLit(fixedLit("{"));
    const sep = st.hadComma ? "," : "..";
    for (let i = 0; i < st.br.elems.length; i++) {
      if (i > 0) addLit(fixedLit(sep));
      const e = st.br.elems[i];
      if (e) acc.parts.push(...e.parts);
    }
  }

  // Replace the input word's parts with the rewritten ones.
  word.parts = top.parts;
  return true;
}

function validSequence(br: BraceExp): boolean {
  if (br.elems.length < 2 || br.elems.length > 3) return false;
  const a = wordLiteralValue(br.elems[0]);
  const b = wordLiteralValue(br.elems[1]);
  if (a === undefined || b === undefined) return false;
  const aIsChar = a.length === 1 && isAsciiLetter(a);
  const bIsChar = b.length === 1 && isAsciiLetter(b);
  if (!((aIsChar && bIsChar) || (isInteger(a) && isInteger(b)))) return false;
  if (br.elems.length === 3) {
    const c = wordLiteralValue(br.elems[2]);
    if (c === undefined || !isInteger(c)) return false;
  }
  return true;
}

function wordLiteralValue(w: Word | undefined): string | undefined {
  if (!w) return undefined;
  let out = "";
  for (const p of w.parts) {
    if (p.type !== "Literal") return undefined;
    out += p.value;
  }
  return out;
}
