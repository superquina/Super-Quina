export class RoundSettlementError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "ROUND_NOT_FOUND"
      | "ROUND_NOT_DRAWN"
      | "INVALID_RULE_SNAPSHOT"
      | "INCONSISTENT_SETTLEMENT",
  ) {
    super(message);
    this.name = "RoundSettlementError";
  }
}
