import { z } from 'zod';

/**
 * `/api` の class-transformer @Transform（number-transform.util.ts）を Zod preprocess で忠実再現する。
 * path/query は常に文字列で来るため数値強制が必要。空白のみ文字列は NaN にして後段の数値スキーマで弾く
 * （class-validator の @IsInt/@IsNumber が NaN を拒否する挙動と一致。zod v4 は z.number() が NaN を既定拒否）。
 */

const isBlankString = (value: unknown): value is string => typeof value === 'string' && value.trim() === '';

// toNumber: 空白文字列 → NaN、それ以外 → Number(value)
const rawToNumber = (value: unknown): unknown => (isBlankString(value) ? Number(undefined) : Number(value));

// toNumberWithDefault: undefined/'' → default、空白 → NaN、else Number
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

// toOptionalNumber: undefined/null/'' → undefined、空白 → NaN、else Number
const rawToOptionalNumber = (value: unknown): unknown => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (isBlankString(value)) {
    return Number(undefined);
  }
  return Number(value);
};

// toNullableNumber: null/undefined → passthrough、'' → undefined、空白 → NaN、else Number
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
 * 数値強制スキーマ。`inner` に `z.number().int()` 等を渡して制約を足せる（既定は z.number()）。
 * 例: zNum(z.number().int()) で整数必須。
 */
export const zNum = (inner: z.ZodNumber = z.number()): z.ZodType<number> => z.preprocess(rawToNumber, inner);

export const zNumWithDefault = (defaultValue: number, inner: z.ZodNumber = z.number()): z.ZodType<number> =>
  z.preprocess(rawToNumberWithDefault(defaultValue), inner);

export const zNumOptional = (inner: z.ZodNumber = z.number()): z.ZodType<number | undefined> =>
  z.preprocess(rawToOptionalNumber, inner.optional());

export const zNumNullable = (inner: z.ZodNumber = z.number()): z.ZodType<number | null | undefined> =>
  z.preprocess(rawToNullableNumber, inner.nullish());
