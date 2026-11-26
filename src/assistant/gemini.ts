import { runTool, TOOL_DECLARATIONS, unanswerableResult, type ToolContext, type ToolResult } from './tools';

/*
 * Gemini function calling over plain fetch (no SDK).
 *  1. Send the question + tool declarations, forcing a function call (mode ANY).
 *  2. Run the chosen tool locally over the orders in Redux.
 *  3. If answerable, send the result back (mode NONE) so Gemini only phrases it.
 *     If not answerable, reply with our own fixed text - the model never gets to improvise.
 */

export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';
/**
 * Tried in order when the configured model is gone (404), overloaded (500/503) or does not
 * answer in time. Older ids such as gemini-2.5-flash return 404 for new API keys, and the
 * gemini-flash-latest alias can hang for minutes, so it is deliberately not in this list.
 */
export const FALLBACK_GEMINI_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.5-flash'];
/** One request may not take longer than this before the next model is tried. */
export const GEMINI_TIMEOUT_MS = 20_000;
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Declarations as sent to Gemini. A function without arguments is declared with no
 * `parameters` at all: an OBJECT schema with empty `properties` can be rejected by the API.
 */
function declarationsForGemini() {
  return TOOL_DECLARATIONS.map((decl) => {
    const params = (decl as { parameters?: { properties?: Record<string, unknown> } }).parameters;
    if (params && Object.keys(params.properties ?? {}).length === 0) {
      const { parameters: _omit, ...rest } = decl as typeof decl & { parameters?: unknown };
      return rest;
    }
    return decl;
  });
}

export type AssistantErrorKind = 'missing_key' | 'invalid_key' | 'quota' | 'network' | 'service' | 'unknown';

export class AssistantError extends Error {
  readonly kind: AssistantErrorKind;
  constructor(kind: AssistantErrorKind, message: string) {
    super(message);
    this.name = 'AssistantError';
    this.kind = kind;
  }
}

export const ERROR_MESSAGES: Record<AssistantErrorKind, string> = {
  missing_key: 'No Gemini API key found. Add VITE_GEMINI_API_KEY to .env.local and restart the dev server.',
  invalid_key: 'The Gemini API key was rejected. Check VITE_GEMINI_API_KEY in .env.local.',
  quota: 'Gemini quota reached (429). Wait a minute and try again.',
  network: 'Could not reach Gemini. Check your internet connection and retry.',
  service: 'Gemini is having trouble right now. Please retry in a moment.',
  unknown: 'Something went wrong while asking Gemini. Please retry.',
};

export interface GeminiConfig {
  apiKey: string | undefined;
  model: string;
}

export function geminiConfigFromEnv(): GeminiConfig {
  const env = import.meta.env;
  return {
    apiKey: typeof env.VITE_GEMINI_API_KEY === 'string' && env.VITE_GEMINI_API_KEY.trim() ? env.VITE_GEMINI_API_KEY.trim() : undefined,
    model:
      typeof env.VITE_GEMINI_MODEL === 'string' && env.VITE_GEMINI_MODEL.trim() ? env.VITE_GEMINI_MODEL.trim() : DEFAULT_GEMINI_MODEL,
  };
}

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  [key: string]: unknown;
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates?: { content?: GeminiContent }[];
}

export interface AssistantAnswer {
  text: string;
  tool: { name: string; args: Record<string, unknown> } | null;
  /** 'code' when the reply is our deterministic summary instead of Gemini's phrasing. */
  phrasedBy: 'gemini' | 'code';
  note?: string;
}

export function systemInstruction(ctx: ToolContext, today: string): string {
  return [
    'You are the sales assistant inside OrderCraft, used by shop staff.',
    'Always answer by calling exactly one of the provided functions. Never calculate, estimate or invent numbers, names, dates or order ids yourself.',
    'If the question needs information the orders do not contain (customers, people, phone numbers, staff, costs, profit, delivery, ratings) or is not about sales, call explain_unanswerable.',
    'When you receive a function result, reply in one to three short sentences in the language of the question (English or Bangla), using only values from the result and copying amounts exactly as written. Use plain text, no Markdown.',
    `Today is ${today} in the shop time zone (${ctx.timeZone}). Dates passed to get_orders_on_date must be YYYY-MM-DD.`,
  ].join('\n');
}

/** Thrown by one attempt when another model is worth trying (404, 5xx, timeout). */
class TryNextModel extends Error {
  readonly reason: AssistantError;
  constructor(reason: AssistantError) {
    super(reason.message);
    this.reason = reason;
  }
}

async function generateOnce(config: GeminiConfig, body: unknown, signal?: AbortSignal): Promise<GeminiResponse> {
  const timeout = AbortSignal.timeout(GEMINI_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}/${encodeURIComponent(config.model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey ?? '' },
      body: JSON.stringify(body),
      signal: combined,
    });
  } catch {
    if (timeout.aborted && !signal?.aborted) {
      throw new TryNextModel(new AssistantError('service', `Gemini (${config.model}) did not answer within ${GEMINI_TIMEOUT_MS / 1000}s. Please retry.`));
    }
    throw new AssistantError('network', ERROR_MESSAGES.network);
  }
  if (response.ok) return (await response.json()) as GeminiResponse;

  let detail = '';
  try {
    const err = (await response.json()) as { error?: { message?: string; status?: string } };
    detail = `${err.error?.status ?? ''} ${err.error?.message ?? ''}`;
  } catch {
    detail = '';
  }
  if (response.status === 429) throw new AssistantError('quota', ERROR_MESSAGES.quota);
  if (response.status === 404) {
    throw new TryNextModel(new AssistantError('unknown', `${ERROR_MESSAGES.unknown} (model ${config.model} is not available)`));
  }
  if (response.status === 401 || response.status === 403 || /API[_ ]KEY/i.test(detail)) {
    throw new AssistantError('invalid_key', ERROR_MESSAGES.invalid_key);
  }
  if (response.status >= 500) throw new TryNextModel(new AssistantError('service', ERROR_MESSAGES.service));
  throw new AssistantError('unknown', `${ERROR_MESSAGES.unknown} (${response.status}${detail.trim() ? `: ${detail.trim()}` : ''})`);
}

/**
 * Calls the configured model, then each fallback, until one answers. Returns the model that
 * answered so a follow-up call (which carries its thought signature) can go to the same one.
 */
async function generate(
  config: GeminiConfig,
  body: unknown,
  signal?: AbortSignal,
  useFallbacks = true,
): Promise<{ response: GeminiResponse; model: string }> {
  const models = useFallbacks ? [config.model, ...FALLBACK_GEMINI_MODELS.filter((m) => m !== config.model)] : [config.model];
  let last: AssistantError = new AssistantError('service', ERROR_MESSAGES.service);
  for (const model of models) {
    try {
      return { response: await generateOnce({ ...config, model }, body, signal), model };
    } catch (error) {
      if (!(error instanceof TryNextModel)) throw error;
      last = error.reason;
    }
  }
  throw last;
}

function firstFunctionCall(
  res: GeminiResponse,
): { content: GeminiContent; call: { name: string; args: Record<string, unknown>; id?: string } } | null {
  const content = res.candidates?.[0]?.content;
  const part = content?.parts?.find((p) => p.functionCall);
  if (!content || !part?.functionCall) return null;
  const { name, args, id } = part.functionCall;
  return { content, call: { name, args: args ?? {}, ...(id ? { id } : {}) } };
}

function textOf(res: GeminiResponse): string {
  return (res.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim();
}

/**
 * One question, one tool. No chat history is sent: every answer is computed fresh from the
 * current orders, so an old number in the conversation can never leak into a new answer.
 */
export async function askAssistant(
  question: string,
  ctx: ToolContext,
  config: GeminiConfig,
  today: string,
  signal?: AbortSignal,
): Promise<AssistantAnswer> {
  if (!config.apiKey) throw new AssistantError('missing_key', ERROR_MESSAGES.missing_key);

  const userTurn: GeminiContent = { role: 'user', parts: [{ text: question }] };
  const base = {
    systemInstruction: { parts: [{ text: systemInstruction(ctx, today) }] },
    tools: [{ functionDeclarations: declarationsForGemini() }],
  };

  const first = await generate(
    config,
    { ...base, contents: [userTurn], toolConfig: { functionCallingConfig: { mode: 'ANY' } } },
    signal,
  );
  const picked = firstFunctionCall(first.response);
  const result: ToolResult = picked ? runTool(picked.call.name, picked.call.args, ctx) : unanswerableResult();

  if (!picked || !result.answerable) {
    return { text: result.summary, tool: picked ? { name: result.name, args: result.args } : null, phrasedBy: 'code' };
  }

  try {
    const second = await generate(
      { ...config, model: first.model }, // same model: the thought signature is model-specific
      {
        ...base,
        contents: [
          userTurn,
          picked.content, // returned as-is (keeps any thought signature)
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: result.name,
                  response: result.data,
                  ...(picked.call.id ? { id: picked.call.id } : {}),
                },
              },
            ],
          },
        ],
        toolConfig: { functionCallingConfig: { mode: 'NONE' } },
      },
      signal,
      false,
    );
    const text = textOf(second.response);
    if (text) return { text, tool: { name: result.name, args: result.args }, phrasedBy: 'gemini' };
  } catch (error) {
    if (!(error instanceof AssistantError)) throw error;
    return {
      text: result.summary,
      tool: { name: result.name, args: result.args },
      phrasedBy: 'code',
      note: `Gemini could not phrase the answer (${error.kind.replace('_', ' ')}), so this is the computed result.`,
    };
  }
  return { text: result.summary, tool: { name: result.name, args: result.args }, phrasedBy: 'code' };
}
