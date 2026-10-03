import { z } from "@hono/zod-openapi";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export type ErrorCode = "invalid_request" | "not_found" | "internal_error";

export const ErrorSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "not_found" }),
      message: z.string().openapi({ example: "No venue with slug 'nope'" }),
    }),
  })
  .openapi("Error");

export const errorBody = (code: ErrorCode, message: string) => ({ error: { code, message } });

/** Thrown from handlers; app.onError turns it into `{ error: { code, message } }`. */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: ErrorSchema } },
});

/** OpenAPI response docs for the errors a route can return. */
export const errorResponses = {
  400: errorResponse("Invalid request parameters"),
  404: errorResponse("Not found"),
};
