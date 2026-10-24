import type { Pos } from "../ast";

export class PositionedError extends Error {
  constructor(
    message: string,
    readonly position: Pos,
  ) {
    super(message);
    this.name = "PositionedError";
  }
}
