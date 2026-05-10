import { expect } from "vitest";
import { stripPos } from "./strip-pos";

declare module "vitest" {
  // Extending `Matchers` is the supported way to register a custom matcher.
  // The default type parameter (`T = any`) must match vitest's declaration.
  // biome-ignore lint/suspicious/noExplicitAny: must match vitest declaration
  interface Matchers<T = any> {
    /**
     * Deep equality check that ignores `pos`/`end` location fields anywhere
     * in the actual or expected values. Use for parser tests so fixtures can
     * focus on AST shape.
     */
    toMatchAst(expected: unknown): T;
  }
}

expect.extend({
  toMatchAst(received: unknown, expected: unknown) {
    const cleanReceived = stripPos(received);
    const cleanExpected = stripPos(expected);
    const pass = this.equals(cleanReceived, cleanExpected);
    return {
      pass,
      message: () =>
        pass
          ? `Expected AST not to match.\nGot: ${this.utils.printReceived(cleanReceived)}`
          : `AST did not match.\n${this.utils.diff(cleanExpected, cleanReceived) ?? ""}`,
      actual: cleanReceived,
      expected: cleanExpected,
    };
  },
});
