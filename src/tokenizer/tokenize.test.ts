import { describe, expect, it } from "vitest";
import { tokenize } from "./tokenize";

describe("tokenize", () => {
  it("does not treat an escaped question mark as an extglob opener", () => {
    const tokens = tokenize("\\?(");

    expect(tokens).toMatchObject([
      { type: "word", parts: [{ type: "lit", value: "?" }] },
      { type: "symbol", value: "(" },
    ]);
  });
});
