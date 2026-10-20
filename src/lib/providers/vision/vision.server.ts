import { addUsage, emptyUsage, stripBase64, toBase64 } from '../shared.ts';
import type { AnalysisImage, AnalysisProvider, Detection, DiscoveryResult, IdentityResult, JobBudget, Usage } from '../types.ts';
import {
	boxFormatFor,
	CHAT_ENDPOINT,
	ChatResponseSchema,
	DEFAULT_VISION_MODEL,
	discoveryRequest,
	identityRequest,
	readDiscovery,
	readIdentityAnswer,
	redactChatRequest,
	type ChatRequest,
	type ChatResponse
} from './contract.ts';

/**
 * Server-only vision-LLM adapter (OpenRouter Chat Completions). Same rules as the JEV adapter:
 * the key never leaves the server, every request spends the budget first, nothing is retried,
 * and logs never contain image data.
 */

export class VisionRequestError extends Error {
	readonly status: number | null;
	readonly detail: string;

	constructor(message: string, status: number | null, detail: string) {
		super(message);
		this.name = 'VisionRequestError';
		this.status = status;
		this.detail = detail;
	}
}

export type ChatTransport = {
	send(req: ChatRequest, budget: JobBudget, signal?: AbortSignal): Promise<{ response: ChatResponse; usage: Usage; durationMs: number }>;
};

export type ChatTransportOptions = {
	apiKey: string;
	endpoint?: string;
	timeoutMs?: number;
	fetch?: typeof fetch;
	log?: (entry: { request: unknown; status: number | null; durationMs: number; usage?: Usage; error?: string }) => void;
};

export function createChatTransport(opts: ChatTransportOptions): ChatTransport {
	if (!opts.apiKey) throw new Error('OPEN_ROUTER_API_KEY is not set');
	const doFetch = opts.fetch ?? fetch;
	const endpoint = opts.endpoint ?? CHAT_ENDPOINT;
	const timeoutMs = opts.timeoutMs ?? 120_000;

	return {
		async send(req, budget, signal) {
			budget.spend();
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
					opts.log?.({ request: redactChatRequest(req), status, durationMs, error: detail });
					throw new VisionRequestError(`Vision request failed with HTTP ${res.status}`, res.status, detail);
				}
				const parsed = ChatResponseSchema.safeParse(JSON.parse(text));
				if (!parsed.success) {
					opts.log?.({ request: redactChatRequest(req), status, durationMs, error: 'unexpected response shape' });
					throw new VisionRequestError('Vision response did not match the chat completions shape', res.status, stripBase64(text).slice(0, 1000));
				}
				const usage: Usage = {
					requests: 1,
					inputTokens: parsed.data.usage?.prompt_tokens ?? null,
					outputTokens: parsed.data.usage?.completion_tokens ?? null,
					reportedCost: parsed.data.usage?.cost ?? null
				};
				opts.log?.({ request: redactChatRequest(req), status, durationMs, usage });
				return { response: parsed.data, usage, durationMs };
			} catch (e) {
				if (e instanceof VisionRequestError) throw e;
				const durationMs = Date.now() - started;
				const message = e instanceof Error ? e.message : String(e);
				opts.log?.({ request: redactChatRequest(req), status, durationMs, error: message });
				throw new VisionRequestError(`Vision request did not complete: ${message}`, status, '');
			}
		}
	};
}

export type PresenceVerifier = (
	image: AnalysisImage,
	candidates: { label: string; box: Detection['box'] }[],
	budget: JobBudget,
	signal?: AbortSignal
) => Promise<{ scores: (number | null)[]; usage: Usage; durationMs: number }>;

export type VisionProviderOptions = {
	transport: ChatTransport;
	model?: string;
	newId?: () => string;
	/**
	 * Optional second opinion on each box (e.g. JEV Noul on a crop). Boxes scoring below
	 * `presenceThreshold` are dropped; without a verifier every box stays `uncertain`.
	 */
	verifier?: PresenceVerifier;
	presenceThreshold?: number;
	supportedThreshold?: number;
};

const dataUrl = (image: AnalysisImage) => `data:${image.mimeType};base64,${toBase64(image.bytes)}`;

export function createVisionProvider(opts: VisionProviderOptions): AnalysisProvider & { readonly model: string } {
	const model = opts.model ?? DEFAULT_VISION_MODEL;
	const format = boxFormatFor(model); // fail fast on an unverified model family
	const newId = opts.newId ?? (() => crypto.randomUUID());
	const presenceThreshold = opts.presenceThreshold ?? 0.5;
	const supportedThreshold = opts.supportedThreshold ?? 0.8;

	return {
		id: 'vision',
		model,

		async discover(image, budget, signal): Promise<DiscoveryResult> {
			const r = await opts.transport.send(discoveryRequest(model, dataUrl(image)), budget, signal);
			let usage = r.usage;
			let durationMs = r.durationMs;
			const { objects, rejected } = readDiscovery(r.response.choices[0].message.content, format);

			let scores: (number | null)[] = objects.map(() => null);
			if (opts.verifier && objects.length > 0) {
				const v = await opts.verifier(image, objects, budget, signal);
				scores = v.scores;
				usage = addUsage(usage, v.usage);
				durationMs += v.durationMs;
			}

			const detections: Detection[] = [];
			objects.forEach((o, i) => {
				const score = scores[i];
				if (opts.verifier && (score === null || score < presenceThreshold)) {
					rejected.push({ reason: `present__${i}: ${score === null ? 'no verifier answer' : 'below presence threshold'}`, raw: `${o.label} ${score}` });
					return;
				}
				detections.push({
					id: newId(),
					label: o.label,
					category: null,
					box: o.box,
					source: 'vision',
					providerConfidence: null,
					presence: score !== null && score >= supportedThreshold ? 'supported' : 'uncertain'
				});
			});
			return { detections, rejected, usage, durationMs };
		},

		async compareIdentity(a, b, budget, signal): Promise<IdentityResult> {
			const r = await opts.transport.send(identityRequest(model, dataUrl(a), dataUrl(b)), budget, signal);
			const answer = readIdentityAnswer(r.response.choices[0].message.content);
			const outcome = answer === 'same' ? 'possible_same' : answer === 'different' ? 'unlikely_same' : 'uncertain';
			return { outcome, providerConfidence: null, rawScore: null, usage: addUsage(emptyUsage(), r.usage), durationMs: r.durationMs };
		}
	};
}
