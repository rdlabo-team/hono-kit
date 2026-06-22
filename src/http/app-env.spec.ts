import { describe, expect, it } from 'vitest';
import { isProductionEnv, resolveAppEnv } from './app-env';

describe('resolveAppEnv', () => {
  it('APP_ENV=development の時だけ development', () => {
    expect(resolveAppEnv({ APP_ENV: 'development' })).toBe('development');
  });

  it('注入が無ければ本番（api の catch=本番と同義）', () => {
    expect(resolveAppEnv({})).toBe('production');
    expect(resolveAppEnv(undefined)).toBe('production');
    expect(resolveAppEnv(null)).toBe('production');
  });

  it('development 以外の値はすべて本番に倒す', () => {
    expect(resolveAppEnv({ APP_ENV: 'production' })).toBe('production');
    expect(resolveAppEnv({ APP_ENV: 'test' })).toBe('production');
    expect(resolveAppEnv({ APP_ENV: '' })).toBe('production');
  });
});

describe('isProductionEnv', () => {
  it('resolveAppEnv と整合する', () => {
    expect(isProductionEnv({ APP_ENV: 'development' })).toBe(false);
    expect(isProductionEnv({ APP_ENV: 'production' })).toBe(true);
    expect(isProductionEnv({})).toBe(true);
    expect(isProductionEnv(undefined)).toBe(true);
  });
});
