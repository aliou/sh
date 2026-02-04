export const operatorChars = new Set([";", "|", "&"]);
export const redirChars = new Set([">", "<"]);
export const symbolChars = new Set(["(", ")", "{", "}"]);

export const isDigit = (value: string) => value >= "0" && value <= "9";

export const isNameChar = (c: string) =>
  (c >= "a" && c <= "z") ||
  (c >= "A" && c <= "Z") ||
  (c >= "0" && c <= "9") ||
  c === "_";

export const isNameStart = (c: string) =>
  (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";

export const specialParams = new Set(["@", "*", "#", "?", "-", "$", "!"]);
