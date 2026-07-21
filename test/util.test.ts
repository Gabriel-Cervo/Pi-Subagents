import { test, expect } from "vitest";
import { MAX_OUTPUT_BYTES, truncate } from "../src/util.ts";

test("truncation is UTF-8 byte safe and includes a bounded notice", () => {
  const result = truncate("é".repeat(MAX_OUTPUT_BYTES), MAX_OUTPUT_BYTES);
  expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(MAX_OUTPUT_BYTES);
  expect(result).toContain("[truncated");
});
