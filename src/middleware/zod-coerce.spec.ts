import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zNum, zNumNullable, zNumOptional, zNumWithDefault } from './zod-coerce';

describe('zNum', () => {
  it('数値文字列を number に強制する', () => {
    const r = zNum().safeParse('5');
    expect(r).toEqual({ success: true, data: 5 });
  });

  it('空文字・空白は NaN になり拒否される（@IsNumber 相当）', () => {
    expect(zNum().safeParse('').success).toBe(false);
    expect(zNum().safeParse('   ').success).toBe(false);
    expect(zNum().safeParse('abc').success).toBe(false);
  });

  it('inner 制約（int）を足せる', () => {
    expect(zNum(z.number().int()).safeParse('5').success).toBe(true);
    expect(zNum(z.number().int()).safeParse('5.5').success).toBe(false);
  });
});

describe('zNumWithDefault', () => {
  it('undefined / 空文字は default にフォールバックする', () => {
    expect(zNumWithDefault(10).safeParse(undefined)).toEqual({ success: true, data: 10 });
    expect(zNumWithDefault(10).safeParse('')).toEqual({ success: true, data: 10 });
  });

  it('値があれば number 強制', () => {
    expect(zNumWithDefault(10).safeParse('3')).toEqual({ success: true, data: 3 });
  });

  it('空白は NaN で拒否（default にしない）', () => {
    expect(zNumWithDefault(10).safeParse('  ').success).toBe(false);
  });
});

describe('zNumOptional', () => {
  it('undefined / null / 空文字は undefined になる', () => {
    expect(zNumOptional().safeParse(undefined)).toEqual({ success: true, data: undefined });
    expect(zNumOptional().safeParse(null)).toEqual({ success: true, data: undefined });
    expect(zNumOptional().safeParse('')).toEqual({ success: true, data: undefined });
  });

  it('値があれば number、空白は拒否', () => {
    expect(zNumOptional().safeParse('7')).toEqual({ success: true, data: 7 });
    expect(zNumOptional().safeParse('  ').success).toBe(false);
  });
});

describe('zNumNullable', () => {
  it('null は null のまま通す', () => {
    expect(zNumNullable().safeParse(null)).toEqual({ success: true, data: null });
  });

  it('undefined / 空文字は undefined、値は number', () => {
    expect(zNumNullable().safeParse(undefined)).toEqual({ success: true, data: undefined });
    expect(zNumNullable().safeParse('')).toEqual({ success: true, data: undefined });
    expect(zNumNullable().safeParse('9')).toEqual({ success: true, data: 9 });
  });
});
