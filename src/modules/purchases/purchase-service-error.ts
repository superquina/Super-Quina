export class PurchaseServiceError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_ACTOR"
      | "INVALID_IDEMPOTENCY_KEY"
      | "IDEMPOTENCY_CONFLICT"
      | "ROUND_UNAVAILABLE"
      | "INVALID_PURCHASE"
      | "INSUFFICIENT_BALANCE"
      | "INVALID_PRIZE_CONFIGURATION",
  ) {
    super(message);
    this.name = "PurchaseServiceError";
  }
}
