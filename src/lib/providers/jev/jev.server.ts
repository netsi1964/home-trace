import { DecisionsResponseSchema, JEV_ENDPOINT, JEV_MODEL, redactRequest, type DecisionsRequest, type DecisionsResponse } from './contract.ts';
import type { JobBudget, Usage } from '../types.ts';
import { stripBase64 } from '../shared.ts';

/**
 * Server-only transport for JEV via OpenRouter. The API key never leaves the server and is
 * never logged. No automatic retries: every request is paid (AGENTS.md design rule 9).
 */

export class JevRequestError extends Error {
	readonly status: number | null;
	/** Response body with any echoed image data stripped. Safe to log. */
	readonly detail: string;

	constructor(message: string, status: number | null, detail: string) {
		super(message);
		this.name = 'JevRequestError';
		this.status = status;
		this.detail = detail;
	}
}

export type JevTransport = {
	send(req: DecisionsRequest, budget: JobBudget, signal?: AbortSignal): Promise<{ response: DecisionsResponse; usage: Usage; durationMs: number }>;
};

export type JevTransportOptions = {
	apiKey: string;
	endpoint?: string;
	timeoutMs?: number;
	fetch?: typeof fetch;
	/** Receives redacted request/response pairs for technical logs. Never image data. */
	log?: (entry: { request: unknown; status: number | null; durationMs: number; usage?: Usage; error?: string }) => void;
};

export function createJevTransport(opts: JevTransportOptions): JevTransport {
	if (!opts.apiKey) throw new Error('OPEN_ROUTER_API_KEY is not set');
	const doFetch = opts.fetch ?? fetch;
	const endpoint = opts.endpoint ?? JEV_ENDPOINT;
	const timeoutMs = opts.timeoutMs ?? 60_000;

	return {
		async send(req, budget, signal) {
			budget.spend(); // Throws before any network traffic when the budget is used up.
			const started = Date.now();
			const timeout = AbortSignal.timeout(timeoutMs);
			const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
			let status: number | null = null;
			try {
				const res = await doFetch(endpoint, {
					method: 'POST',
					headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
					body: JSON.stringify(req),
					signal: combined
				});
				status = res.status;
				const text = await res.text();
				const durationMs = Date.now() - started;
				if (!res.ok) {
					const detail = stripBase64(text).slice(0, 1000);
					opts.log?.({ request: redactRequest(req), status, durationMs, error: detail });
					throw new JevRequestError(`JEV request failed with HTTP ${res.status}`, res.status, detail);
				}
				const parsed = DecisionsResponseSchema.safeParse(JSON.parse(text));
				if (!parsed.success) {
					const detail = stripBase64(text).slice(0, 1000);
					opts.log?.({ request: redactRequest(req), status, durationMs, error: 'unexpected response shape' });
					throw new JevRequestError('JEV response did not match the documented shape', res.status, detail);
				}
				const usage: Usage = {
					requests: 1,
					inputTokens: parsed.data.usage?.input_tokens ?? null,
					outputTokens: parsed.data.usage?.output_tokens ?? null,
					reportedCost: parsed.data.usage?.cost ?? null
				};
				opts.log?.({ request: redactRequest(req), status, durationMs, usage });
				return { response: parsed.data, usage, durationMs };
			} catch (e) {
				if (e instanceof JevRequestError) throw e;
				const durationMs = Date.now() - started;
				const message = e instanceof Error ? e.message : String(e);
				opts.log?.({ request: redactRequest(req), status, durationMs, error: message });
				throw new JevRequestError(`JEV request did not complete: ${message}`, status, '');
			}
		}
	};
}

export { JEV_MODEL };
