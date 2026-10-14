import { ilike, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/** Escapes LIKE wildcards so a search term is matched literally. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

/**
 * Typo-tolerant name search: substring (ILIKE) or trigram similarity (pg_trgm's `%`, threshold 0.3).
 * Both can use the trigram GIN index on the column.
 */
export const nameMatches = (column: PgColumn, q: string): SQL =>
  or(ilike(column, `%${escapeLike(q)}%`), sql`${column} OPERATOR(extensions.%) ${q}`)!;
