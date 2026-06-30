/**
 * Cloudflare AI Gateway provider factory built on the Vercel AI SDK and `ai-gateway-provider`.
 *
 * Routes OpenAI, Anthropic, and Google Vertex `@ai-sdk/*` models through the AI Gateway Universal
 * Endpoint. The wrapper returned by `createAiGateway` intercepts the provider-bound requests the SDK
 * assembles (`api.openai.com`, `api.anthropic.com`, `*-aiplatform.googleapis.com`, etc.) and redirects
 * them through the Gateway. Every provider is routed transparently via the same `aigateway(model)` call.
 *
 * @remarks
 * This module is purely the infrastructure layer: it injects only the Gateway identifier and (optionally)
 * the Gateway authentication token. Provider API keys and Vertex service-account credentials are supplied
 * by the caller at model-construction time and passed through untouched.
 */
import { createAiGateway } from 'ai-gateway-provider';
import type { AiGateway, AiGatewayBindingSettings, AiGatewayOptions } from 'ai-gateway-provider';

export type { AiGateway, AiGatewayOptions } from 'ai-gateway-provider';

/**
 * Minimal shape of a Workers AI binding (`env.AI.gateway(name)`).
 *
 * @remarks
 * Cloudflare's runtime `AiGateway` type is structurally compatible with this binding shape.
 */
export type AiGatewayBinding = AiGatewayBindingSettings['binding'];

/**
 * Configuration for the AI Gateway provider. This is a union with two mutually exclusive forms.
 *
 * @remarks
 * - **Binding form** — for the Workers runtime (production and `wrangler dev`). Pass the
 *   `env.AI.gateway(name)` binding. Requests through a binding are pre-authenticated within the same
 *   Cloudflare account, so no Gateway token is required.
 * - **REST form** — for non-Workers contexts where a binding is unavailable (e.g. a Node evaluation
 *   harness). Supply `accountId`, `gateway`, and (for authenticated Gateways) `token` to reach the
 *   Gateway over REST.
 */
export type AiGatewayConfig =
  | {
      /** The AI Gateway binding, typically obtained via `env.AI.gateway(name)`. */
      binding: AiGatewayBinding;
      /** Optional Gateway options such as caching, retries, and request metadata. */
      options?: AiGatewayOptions;
    }
  | {
      /** Cloudflare account ID that owns the Gateway. */
      accountId: string;
      /** AI Gateway name. */
      gateway: string;
      /**
       * Gateway authentication token sent in the `cf-aig-authorization` header. Required only for an
       * Authenticated Gateway; omit it for an unauthenticated Gateway. This authenticates the request to
       * the Gateway itself and is distinct from any provider API key.
       */
      token?: string;
      /** Optional Gateway options such as caching, retries, and request metadata. */
      options?: AiGatewayOptions;
    };

/** Provider object exposing the AI Gateway model wrapper. */
export interface AiGatewayProvider {
  /**
   * Wraps an `@ai-sdk/*` model so its requests are routed through the AI Gateway.
   *
   * @remarks
   * Example invocation: `aigateway(createAnthropic({ apiKey })('claude-...'))`. Passing an array of
   * models enables fallback behavior — each model is attempted in order from the start of the array.
   */
  aigateway: AiGateway;
}

/**
 * Create an AI Gateway provider from either the binding form or the REST form of the configuration.
 *
 * @param config - The Gateway configuration; either the binding form or the REST form.
 * @returns A provider whose `aigateway` wrapper routes models through the AI Gateway.
 * @throws Error When the REST form is used and `accountId` or `gateway` is missing (fail-fast).
 * @example
 * ```ts
 * // Binding form (Workers runtime: production / wrangler dev)
 * import { createAnthropic } from '@ai-sdk/anthropic';
 *
 * const { aigateway } = createAiGatewayProvider({ binding: env.AI.gateway('my-gateway') });
 * const model = aigateway(createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })('claude-3-5-sonnet-latest'));
 * ```
 * @example
 * ```ts
 * // REST form (non-Workers context, e.g. a Node evaluation harness)
 * import { createOpenAI } from '@ai-sdk/openai';
 *
 * const { aigateway } = createAiGatewayProvider({
 *   accountId: process.env.CF_ACCOUNT_ID!,
 *   gateway: 'my-gateway',
 *   token: process.env.CF_AIG_TOKEN, // only for an Authenticated Gateway
 * });
 * const model = aigateway(createOpenAI({ apiKey: process.env.OPENAI_API_KEY })('gpt-4o'));
 * ```
 */
export function createAiGatewayProvider(config: AiGatewayConfig): AiGatewayProvider {
  if ('binding' in config) {
    return { aigateway: createAiGateway({ binding: config.binding, options: config.options }) };
  }

  if (!config.accountId) {
    throw new Error('AI Gateway: accountId is not set');
  }
  if (!config.gateway) {
    throw new Error('AI Gateway: gateway name is not set');
  }

  // The token is sent as apiKey only for an Authenticated Gateway; undefined is fine when unauthenticated.
  return {
    aigateway: createAiGateway({
      accountId: config.accountId,
      gateway: config.gateway,
      apiKey: config.token,
      options: config.options,
    }),
  };
}
