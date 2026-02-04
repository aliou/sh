import type { TokenWordPart } from "./types";

export function tokenPartsText(parts: TokenWordPart[]): string {
  return parts
    .map((p) => {
      if (p.type === "lit") return p.value;
      if (p.type === "sgl") return p.value;
      if (p.type === "dbl")
        return p.parts
          .map((dp) => (dp.type === "lit" ? dp.value : ""))
          .join("");
      return "";
    })
    .join("");
}
