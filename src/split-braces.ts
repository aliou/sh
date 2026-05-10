import type { BraceExp, Literal, Word, WordPart } from "./ast";

/**
 * Parse Bash brace expansions inside a word's literal parts, replacing them
 * with `BraceExp` nodes. Mutates the word in place. Returns true if the word
 * was modified.
 *
 * Mirrors the contract of mvdan/sh's `syntax.SplitBraces`: malformed brace
 * expressions are left as plain literals rather than producing errors.
 */
export function splitBraces(word: Word): boolean {
  const hasBrace = word.parts.some(
    (p) => p.type === "Literal" && p.value.includes("{"),
  );
  if (!hasBrace) return false;

  const top: Word = { type: "Word", parts: [] };
  let acc: Word = top;
  let cur: BraceExp | undefined;
  const open: BraceExp[] = [];

  const litLeft = (): Literal => ({ type: "Literal", value: "{" });
  const litRight = (): Literal => ({ type: "Literal", value: "}" });
  const litComma = (): Literal => ({ type: "Literal", value: "," });
  const litDots = (): Literal => ({ type: "Literal", value: ".." });

  const addLit = (l: WordPart) => {
    acc.parts.push(l);
  };

  const pop = (): BraceExp => {
    const old = cur;
    open.pop();
    if (open.length === 0) {
      cur = undefined;
      acc = top;
    } else {
      cur = open[open.length - 1];
      const lastElem = cur?.elems[cur.elems.length - 1];
      if (lastElem) acc = lastElem;
    }
    if (!old) {
      // Should never happen given the call sites, but keep the type checker happy.
      throw new Error("invariant: pop called with no current brace");
    }
    return old;
  };

  for (const wp of word.parts) {
    if (wp.type !== "Literal") {
      acc.parts.push(wp);
      continue;
    }
    const value = wp.value;
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
          const next: BraceExp = { type: "BraceExp", elems: [inner] };
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
          const inner: Word = { type: "Word", parts: [] };
          cur.elems.push(inner);
          acc = inner;
          break;
        }
        case ".": {
          if (!cur || value[j + 1] !== ".") {
            j += 1;
            continue;
          }
          flushSlice(j);
          cur.sequence = true;
          const inner: Word = { type: "Word", parts: [] };
          cur.elems.push(inner);
          acc = inner;
          j += 1; // consume the second dot below via last = j+1
          break;
        }
        case "}": {
          if (!cur) {
            j += 1;
            continue;
          }
          flushSlice(j);
          const br = pop();
          if (br.elems.length === 1) {
            // Single-element braces collapse back to literals.
            addLit(litLeft());
            const only = br.elems[0];
            if (only) acc.parts.push(...only.parts);
            addLit(litRight());
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
          // Broken sequence falls back to literals: { e1 .. e2 [.. e3] }
          addLit(litLeft());
          for (let i = 0; i < br.elems.length; i++) {
            if (i > 0) addLit(litDots());
            const e = br.elems[i];
            if (e) acc.parts.push(...e.parts);
          }
          addLit(litRight());
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

  // Unclosed open braces fall back to plain literals.
  while (acc !== top) {
    const br = pop();
    addLit(litLeft());
    for (let i = 0; i < br.elems.length; i++) {
      if (i > 0) addLit(br.sequence ? litDots() : litComma());
      const e = br.elems[i];
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
  const aIsChar = isAsciiLetter(a);
  const bIsChar = isAsciiLetter(b);
  const aIsInt = isInteger(a);
  const bIsInt = isInteger(b);
  if (!((aIsChar && bIsChar) || (aIsInt && bIsInt))) return false;
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
    if (p.type === "Literal") out += p.value;
    else return undefined;
  }
  return out;
}

function isAsciiLetter(s: string): boolean {
  if (s.length !== 1) return false;
  const code = s.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isInteger(s: string): boolean {
  if (s.length === 0) return false;
  let i = 0;
  if (s[0] === "+" || s[0] === "-") {
    if (s.length === 1) return false;
    i = 1;
  }
  for (; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (ch < 48 || ch > 57) return false;
  }
  return true;
}
