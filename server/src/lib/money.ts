/** JSON-safe paise: use a number while it is a safe JS integer, otherwise a decimal string. */
export function paiseJson(value: bigint): number | string {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
    ? Number(value)
    : value.toString();
}
