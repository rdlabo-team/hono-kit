import { zValidator } from '@hono/zod-validator';
import type { Context } from 'hono';
import type { ZodType } from 'zod';

/** zod v3(ZodError) / v4(core $ZodError) どちらの error でも受けられる最小形 */
export interface ZodErrorLike {
  issues: readonly { path: PropertyKey[]; message: string }[];
}

export type ValidationTarget = 'json' | 'query' | 'param' | 'header' | 'cookie' | 'form';

export interface ValidateOptions {
  /**
   * 検証失敗時のフック（Sentry 通報など）。**検証の挙動は変えない** — レスポンスは常に
   * NestJS ValidationPipe 同形の 400 を返す。例外を投げても握り潰す。
   * 既定は no-op（receptray 互換 = 4xx を通報しない）。foodlabel は Sentry 実通報を差し込む。
   */
  onValidationError?: (error: ZodErrorLike, c: Context) => void;
}

/**
 * Zod 検証ミドルウェア（フリート共通 = receptray/winecode hono と同一仕様）。
 * 失敗時は NestJS の ValidationPipe と同形の body を返す:
 *   { statusCode: 400, message: string[], error: 'Bad Request' }
 *
 * NOTE(parity): message の文字列内容は class-validator と Zod で異なる。各 repo の固定 app の
 * 正常系では DTO 検証 400 は発生しない前提（ビジネス 400 は各エンドポイントで HttpError 忠実再現）。
 */

function zodToMessages(error: ZodErrorLike): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

function nestValidationBody(error: ZodErrorLike) {
  return {
    statusCode: 400,
    message: zodToMessages(error),
    error: 'Bad Request',
  };
}

export function validate<T>(target: ValidationTarget, schema: ZodType<T>, options?: ValidateOptions) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      try {
        options?.onValidationError?.(result.error, c);
      } catch {
        // Reporting must never change validation error behavior.
      }
      return c.json(nestValidationBody(result.error), 400);
    }
    return undefined;
  });
}

/** Sentry の最小形（`@sentry/cloudflare` 等への直接依存を避けるための構造型）。 */
export interface SentryScopeLike {
  setTag(key: string, value: string): void;
  setContext(key: string, context: Record<string, unknown> | null): void;
}
export interface SentryLike {
  withScope(callback: (scope: SentryScopeLike) => void): void;
  captureException(error: unknown): void;
}

/**
 * DTO 検証 400 を Sentry に通報する `validate` を返すファクトリ（foodlabel/tipsys/winecode で重複していた
 * reportValidationToSentry を集約）。kit は `@sentry/cloudflare` に依存せず、Sentry モジュールを注入する。
 * 通報は `tag error.type=dto_validation` ＋ `context validation={errorCount, errors}`（各 /api の
 * sentry-validation.pipe.ts 準拠）。検証の挙動・レスポンスは `validate` と同一（通報は副作用のみ）。
 */
export function createSentryValidate(sentry: SentryLike) {
  const onValidationError = (error: ZodErrorLike): void => {
    const messages = zodToMessages(error);
    sentry.withScope((scope) => {
      scope.setTag('error.type', 'dto_validation');
      scope.setContext('validation', { errorCount: messages.length, errors: messages });
      sentry.captureException(error);
    });
  };
  return <T>(target: ValidationTarget, schema: ZodType<T>) => validate(target, schema, { onValidationError });
}
