# @rdlabo/hono-kit

rdlabo の Hono + Cloudflare Workers フリート（`receptray/hono`・`winecode/hono`・`foodlabel/hono`）で
重複していた**インフラ層**コードを抽出・抽象化した共通パッケージ。

ドメイン・DB 層・各 repo 固有の parity 差異（auth のエラー status/body、secretId、Secret スキーマ、
context key）は各 repo 側に残し、ここには「設定注入で汎用化できるインフラ」だけを置く。

## 配布形態（npm 未公開）

ビルド無し・TS ソースを直接 `exports`（各 repo は `moduleResolution: Bundler` + wrangler/esbuild で bundle）。
各 repo の `package.json` でローカル参照する:

```jsonc
"dependencies": { "@rdlabo/hono-kit": "../../hono-kit" }
```

外部依存（hono / zod / jose / aws4fetch / @hono/zod-validator）は **peerDependencies**。
各 repo の node_modules から自前バージョンが供給される。

### ⚠️ zod の重複インスタンスに注意（consumer 側の tsconfig 設定）

このパッケージは `../../hono-kit` の symlink で参照されるため、TS / esbuild はパッケージ内の
bare import（`zod` など）を **`hono-kit/node_modules`** から解決する。consumer 自身の `zod` とは
別インスタンスになり、`zNum()` や `validate()` の zod 推論型が consumer のコード（特に Drizzle insert へ
流れる型）と食い違って typecheck が壊れることがある。

**対策**: zod を使うエンドポイント（`zNum` / `validate` で z スキーマを合成する repo）では、consumer の
`tsconfig.json` に paths を足して zod を 1 インスタンスに寄せる:

```jsonc
"compilerOptions": {
  "baseUrl": ".",
  "paths": {
    "zod": ["node_modules/zod"],
    "zod/*": ["node_modules/zod/*"],
    "@hono/zod-validator": ["node_modules/@hono/zod-validator"]
  }
}
```

`hono` は本パッケージでは型のみ（`import type`）なので dedupe 不要。`jose` / `aws4fetch` は
ステートレス関数のみで、bundle に重複コピーが入っても挙動は不変（サイズ増のみ）。
実績: winecode は上記 paths が必要、receptray は zNum 不使用で paths 無しでも green。

## 公開 API

| import | 用途 |
| --- | --- |
| `finalizeResponse()` | Express/Nest 互換の charset + weak ETag 付与ミドルウェア |
| `validate(target, schema, options?)` | Zod 検証 → NestJS ValidationPipe 同形 400。`options.onValidationError` で Sentry 等を注入 |
| `zNum` / `zNumWithDefault` / `zNumOptional` / `zNumNullable` | class-transformer @Transform 相当の数値強制 zod schema |
| `getUserProtocol(c)` / `IUserProtocol` | CF-Connecting-IP / UA 取得 |
| `HttpStatus` | NestJS `@nestjs/common` と同一の HTTP ステータス enum |
| `retryWhenDeadlock(fn, retries?, delay?)` | ER_LOCK_DEADLOCK 指数バックオフ retry |
| `getAuthenticationSecret<T>(options, secretId)` / `AwsSecretsOptions` | AWS Secrets Manager GetSecretValue（aws4fetch 署名・isolate キャッシュ） |
| `FirebaseVerifier` / `DecodedIdToken` | firebase-admin Auth 境界の interface |
| `JoseFirebaseVerifier` / `SECURETOKEN_JWK_URL` | jose RS256 で Firebase ID トークン検証 |
| `IdentityToolkit` / `ServiceAccount` | accounts:lookup / delete（getUser/deleteUser 用） |
| `createRemoteFirebaseVerifier(projectId)` | 本番用便宜ファクトリ（JWKS を isolate キャッシュ） |

## 検証

```bash
npm install
npm run typecheck && npm run lint && npm run test
```
