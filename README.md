# @rdlabo/hono-kit

Infrastructure toolkit for building APIs on [Hono](https://hono.dev) + [Cloudflare Workers](https://workers.cloudflare.com).

It provides the building blocks a NestJS-style API needs but that don't run on `workerd` (no Node.js AWS SDK, no `firebase-admin`), plus middleware that matches Express / NestJS response semantics byte-for-byte:

- **Firebase ID-token verification** on Workers via [`jose`](https://github.com/panva/jose) (RS256 against Google's securetoken JWKS), with optional Identity Toolkit REST for `getUser` / `deleteUser`.
- **AWS Secrets Manager** via SigV4-signed `fetch` ([`aws4fetch`](https://github.com/mhart/aws4fetch)) — no AWS SDK.
- **Middleware**: `finalizeResponse` (Express-compatible weak ETag + JSON charset), `validate` (NestJS `ValidationPipe`-shaped 400), and zod number-coercion helpers.
- **Deadlock retry** (`ER_LOCK_DEADLOCK` exponential backoff).
- **HTTP helpers**: `getUserProtocol`, `getAppInfo`, `HttpStatus`.

## Install

```bash
npm install @rdlabo/hono-kit
```

Peer dependencies — install the ones you use:

```bash
npm install hono zod @hono/zod-validator jose aws4fetch
```

> **TypeScript sources, no build step.** The package is published as `.ts` via the `exports` field and is meant to be consumed by a bundler that compiles TypeScript — wrangler/esbuild, Vite, etc. — targeting `workerd` or another edge runtime. It relies only on Web-standard APIs (`fetch`, `crypto.subtle`, `Response`) available on Cloudflare Workers.

## API

| Export | Description |
| --- | --- |
| `finalizeResponse()` | Middleware that adds an Express-compatible weak `ETag` and JSON `charset=utf-8`. |
| `validate(target, schema, options?)` | Zod validator → NestJS `ValidationPipe`-shaped `400` (`{ statusCode, message[], error }`). `options.onValidationError(err, c)` to report (e.g. Sentry). |
| `zNum` / `zNumWithDefault` / `zNumOptional` / `zNumNullable` | Number-coercion zod schemas (mirror class-transformer `@Transform`). |
| `getAuthenticationSecret<T>(options, secretId)` / `AwsSecretsOptions` | Fetch a secret from AWS Secrets Manager (SigV4 `fetch`, per-isolate cache). |
| `JoseFirebaseVerifier` / `FirebaseVerifier` / `DecodedIdToken` | Firebase ID-token verification (`verifyIdToken`, `getUser`, `deleteUser`). |
| `createRemoteFirebaseVerifier(projectId)` | Convenience factory: production verifier with a cached remote JWKS. |
| `IdentityToolkit` / `ServiceAccount` / `SECURETOKEN_JWK_URL` | Identity Toolkit REST client + constants for `getUser` / `deleteUser`. |
| `retryWhenDeadlock(fn, retries?, delay?)` | Retry on MySQL `ER_LOCK_DEADLOCK` with exponential backoff. |
| `getUserProtocol(c)` / `IUserProtocol` | Read client IP / UA (`CF-Connecting-IP` → `X-Forwarded-For`). |
| `getAppInfo(c)` / `AppInfo` | Read `x-amz-meta-version` / `x-amz-meta-uuid`. |
| `HttpStatus` | HTTP status enum identical to NestJS `@nestjs/common`. |

## Usage

### Response finalization (ETag / charset)

```ts
import { Hono } from 'hono';
import { finalizeResponse } from '@rdlabo/hono-kit';

const app = new Hono();
app.use('*', finalizeResponse());
```

### Request validation

```ts
import { validate } from '@rdlabo/hono-kit';
import { z } from 'zod';

app.post('/users', validate('json', z.object({ name: z.string() })), (c) => {
  const body = c.req.valid('json'); // typed & validated
  return c.json(body, 201);
});

// Report validation failures (response is unchanged):
validate('json', schema, {
  onValidationError: (err, c) => Sentry.captureException(err),
});
```

`param` / `query` values arrive as strings — coerce numbers with the zod helpers:

```ts
import { zNum, zNumOptional } from '@rdlabo/hono-kit';

const Params = z.object({ id: zNum(z.number().int()), page: zNumOptional() });
```

### Firebase ID-token verification

```ts
import { createRemoteFirebaseVerifier } from '@rdlabo/hono-kit';

const verifier = createRemoteFirebaseVerifier(projectId);
const decoded = await verifier.verifyIdToken(idToken); // { uid, email, ... }
```

With `getUser` / `deleteUser` (needs a service account):

```ts
import { createRemoteJWKSet } from 'jose';
import { JoseFirebaseVerifier, IdentityToolkit, SECURETOKEN_JWK_URL } from '@rdlabo/hono-kit';

const verifier = new JoseFirebaseVerifier({
  projectId,
  keyResolver: createRemoteJWKSet(new URL(SECURETOKEN_JWK_URL)),
  identity: new IdentityToolkit(serviceAccount),
});
```

### AWS Secrets Manager

```ts
import { getAuthenticationSecret } from '@rdlabo/hono-kit';

interface MySecret {
  firebaseProduction: string;
  stripeSecret: string;
}

const secret = await getAuthenticationSecret<MySecret>(
  {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    region: 'ap-northeast-1',
  },
  'myapp/secret',
);
```

### Deadlock retry & HTTP helpers

```ts
import { retryWhenDeadlock, getUserProtocol, getAppInfo, HttpStatus } from '@rdlabo/hono-kit';

await retryWhenDeadlock(() => db.transaction(/* ... */));

const { ipAddress, userAgent } = getUserProtocol(c);
const appInfo = getAppInfo(c);
return c.json(body, HttpStatus.CREATED);
```

## Local development / linking

If you consume this package via a local path (e.g. `"@rdlabo/hono-kit": "../../hono-kit"`) rather than from npm, TypeScript and esbuild resolve the package's bare imports from *its own* `node_modules`, which can create a second `zod` instance. That breaks types where your zod-inferred values flow into other libraries (e.g. Drizzle inserts). Dedupe with tsconfig `paths`:

```jsonc
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "zod": ["node_modules/zod"],
      "zod/*": ["node_modules/zod/*"],
      "@hono/zod-validator": ["node_modules/@hono/zod-validator"]
    }
  }
}
```

When installed from npm normally, package managers dedupe `zod` to a single copy and this is not needed.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest
```

## License

[MIT](./LICENSE) © rdlabo-team
