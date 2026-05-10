export const operatorChars = new Set([";", "|", "&"]);
export const redirChars = new Set([">", "<"]);
export const symbolChars = new Set(["(", ")", "{", "}"]);

export const isDigit = (c: string) => c >= "0" && c <= "9";
export const isAsciiLetter = (c: string) =>
  (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
export const isHexDigit = (c: string) =>
  isDigit(c) || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");

/** Valid first character of a shell name (`[A-Za-z_]`). */
export const isNameStart = (c: string) => isAsciiLetter(c) || c === "_";
/** Valid character inside a shell name (`[A-Za-z0-9_]`). */
export const isNameChar = (c: string) => isNameStart(c) || isDigit(c);

/** Whether `s` parses as a (signed) integer. */
export const isInteger = (s: string): boolean => {
  if (s.length === 0) return false;
  let i = 0;
  if (s[0] === "+" || s[0] === "-") {
    if (s.length === 1) return false;
    i = 1;
  }
  for (; i < s.length; i++) {
    if (!isDigit(s[i] as string)) return false;
  }
  return true;
};

export const specialParams = new Set(["@", "*", "#", "?", "-", "$", "!"]);
