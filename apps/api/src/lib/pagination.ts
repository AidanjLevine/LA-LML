import { z } from "@hono/zod-openapi";
import { ApiError } from "./errors.js";

export const PaginationQuery = {
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .openapi({ description: "Page size (1–100)", example: 50 }),
  cursor: z.string().optional().openapi({ description: "`next_cursor` from the previous page" }),
};

export const nextCursorSchema = z.string().nullable().openapi({ description: "Pass as `cursor` for the next page; null on the last page" });

export const encodeCursor = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** Decodes an opaque cursor, or throws a 400 if it's malformed or from another endpoint. */
export function decodeCursor<T>(cursor: string, schema: z.ZodType<T>): T {
  try {
    return schema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    throw new ApiError(400, "invalid_request", "cursor: invalid cursor");
  }
}

/** Splits a `limit + 1` result into the page and the cursor for the next one. */
export function paginate<T>(rows: T[], limit: number, toCursor: (last: T) => unknown) {
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return { page, nextCursor: rows.length > limit && last ? encodeCursor(toCursor(last)) : null };
}
