import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ParseOptions } from "../ast";
import { parse } from "../parse";

/**
 * Differential test corpus extracted from mvdan/sh (github.com/mvdan/sh,
 * syntax/filetests_test.go at c6351e9). Each case is a list of equivalent
 * input spellings; for each input, `langs` holds per-language expectations:
 * an array of [bash, posix, mksh, bats, zsh] entries where
 *
 * - `null`      → the language is not tested for this input
 * - `""`        → mvdan parses the input successfully
 * - non-empty   → mvdan rejects the input (the string is its error message)
 *
 * Bats (index 3) is skipped: @aliou/sh does not support the Bats dialect
 * yet, so its expectations are dropped when building the flat test list.
 *
 * These are the *expected behaviours of mvdan/sh*. Failing tests in this
 * file are the parity backlog; do not fix tests to match @aliou/sh's
 * current behaviour.
 */
const corpus: { inputs: string[]; langs: (Array<string | null> | null)[] }[] =
  JSON.parse(
    readFileSync(
      new URL("./corpus/mvdan-filetests.json", import.meta.url),
      "utf8",
    ),
  );

// index 3 (bats) is intentionally dropped; index 4 is zsh.
const langIndexToOptions: (ParseOptions | null)[] = [
  { dialect: "bash" },
  { dialect: "posix" },
  { dialect: "mksh" },
  null,
  { dialect: "zsh" },
];

type FlatCase = {
  input: string;
  options: ParseOptions;
  expected: "accept" | "reject";
  expectedErr: string;
};

const cases: FlatCase[] = [];
for (const c of corpus) {
  c.inputs.forEach((input, j) => {
    const perLang = c.langs[j];
    if (!perLang) return;
    perLang.forEach((want, i) => {
      const options = langIndexToOptions[i];
      if (want === null || want === undefined || !options) return;
      cases.push({
        input,
        options,
        expected: want === "" ? "accept" : "reject",
        expectedErr: want,
      });
    });
  });
}

describe("mvdan/sh filetests parity", () => {
  for (const c of cases) {
    const label = `[${c.options.dialect}] ${JSON.stringify(c.input)}`;
    it(label, () => {
      let ours: "accept" | "reject" = "accept";
      let ourErr: string | undefined;
      try {
        parse(c.input, { ...c.options, keepComments: true });
      } catch (e) {
        ours = "reject";
        ourErr = (e as Error).message;
      }
      if (c.expected === "accept") {
        expect(
          ourErr,
          `mvdan/sh parses this, we reject with: ${ourErr}`,
        ).toBeUndefined();
      } else {
        expect(ours, "mvdan/sh rejects this, we accept").toBe("reject");
      }
    });
  }
});
