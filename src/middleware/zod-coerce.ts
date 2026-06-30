import { z } from 'zod';

/**
 * Zod preprocessors that coerce string path/query parameters into numbers.
 *
 * @remarks
 * These mirror a class-transformer `@Transform(() => Number)` coercion: path and query parameters
 * always arrive as strings, so they must be forced to numbers before number validation. Whitespace-only
 * strings are mapped to `NaN` so the downstream number schema rejects them (matching class-validator's
 * `@IsInt`/`@IsNumber`, which reject `NaN`; zod v4's `z.number()` also rejects `NaN` by default).
 */

/** Return `true` when `value` is a string that is empty or contains only whitespace. */
const isBlankString = (value: unknown): value is string => typeof value === 'string' && value.trim() === '';

// toNumber: blank string → NaN, otherwise → Number(value).
const rawToNumber = (value: unknown): unknown => (isBlankString(value) ? Number(undefined) : Number(value));

// toNumberWithDefault: undefined/'' → default, blank → NaN, else Number.
const rawToNumberWithDefault =
  (defaultValue: number) =>
  (value: unknown): unknown => {
    if (value === undefined || value === '') {
      return defaultValue;
    }
    if (isBlankString(value)) {
      return Number(undefined);
    }
    return Number(value);
  };

// toOptionalNumber: undefined/null/'' → undefined, blank → NaN, else Number.
const rawToOptionalNumber = (value: unknown): unknown => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (isBlankString(value)) {
    return Number(undefined);
  }
  return Number(value);
};

// toNullableNumber: null/undefined → passthrough, '' → undefined, blank → NaN, else Number.
const rawToNullableNumber = (value: unknown): unknown => {
  if (value === null || value === undefined) {
    return value;
  }
  if (value === '') {
    return undefined;
  }
  if (isBlankString(value)) {
    return Number(undefined);
  }
  return Number(value);
};

/**
 * Build a required number schema that coerces string input to a number.
 *
 * @param inner - The inner number schema to apply after coercion; pass e.g. `z.number().int()` to add
 * constraints. Defaults to `z.number()`.
 * @returns A zod schema yielding a `number`.
 *
 * @example
 * ```ts
 * // Require an integer path param:
 * const schema = z.object({ id: zNum(z.number().int()) });
 * // '42' → 42, '' / '  ' → NaN (rejected)
 * ```
 */
export const zNum = (inner: z.ZodNumber = z.number()): z.ZodType<number> => z.preprocess(rawToNumber, inner);

/**
 * Build a number schema that coerces string input and substitutes a default for missing values.
 *
 * `undefined` or an empty string yields `defaultValue`; a whitespace-only string yields `NaN`
 * (rejected by the inner schema); anything else is passed through `Number`.
 *
 * @param defaultValue - The value used when the input is `undefined` or an empty string.
 * @param inner - The inner number schema applied after coercion. Defaults to `z.number()`.
 * @returns A zod schema yielding a `number`.
 *
 * @example
 * ```ts
 * // Default page to 1 when the query param is absent:
 * const schema = z.object({ page: zNumWithDefault(1) });
 * ```
 */
export const zNumWithDefault = (defaultValue: number, inner: z.ZodNumber = z.number()): z.ZodType<number> =>
  z.preprocess(rawToNumberWithDefault(defaultValue), inner);

/**
 * Build an optional number schema that coerces string input.
 *
 * `undefined`, `null`, or an empty string yields `undefined`; a whitespace-only string yields `NaN`
 * (rejected); anything else is passed through `Number`.
 *
 * @param inner - The inner number schema applied after coercion. Defaults to `z.number()`.
 * @returns A zod schema yielding `number | undefined`.
 *
 * @example
 * ```ts
 * const schema = z.object({ limit: zNumOptional(z.number().int()) });
 * ```
 */
export const zNumOptional = (inner: z.ZodNumber = z.number()): z.ZodType<number | undefined> =>
  z.preprocess(rawToOptionalNumber, inner.optional());

/**
 * Build a nullable, optional number schema that coerces string input.
 *
 * `null`/`undefined` pass through unchanged; an empty string yields `undefined`; a whitespace-only
 * string yields `NaN` (rejected); anything else is passed through `Number`.
 *
 * @param inner - The inner number schema applied after coercion. Defaults to `z.number()`.
 * @returns A zod schema yielding `number | null | undefined`.
 *
 * @example
 * ```ts
 * const schema = z.object({ parentId: zNumNullable(z.number().int()) });
 * ```
 */
export const zNumNullable = (inner: z.ZodNumber = z.number()): z.ZodType<number | null | undefined> =>
  z.preprocess(rawToNullableNumber, inner.nullish());
