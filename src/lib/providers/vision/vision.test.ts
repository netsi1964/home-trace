import { describe, expect, it, vi } from 'vitest';
import { BudgetExceededError, JobBudget } from '../types.ts';
import { boxFormatFor, discoveryRequest, readDiscovery, readIdentityAnswer, redactChatRequest } from './contract.ts';
import { createChatTransport, createVisionProvider, type PresenceVerifier } from './vision.server.ts';

const qwen = boxFormatFor('qwen/qwen3-vl-235b-a22b-instruct');
const gemini = boxFormatFor('google/gemini-2.5-flash');
const image = { mimeType: 'image/jpeg' as const, width: 1200, height: 900, bytes: new Uint8Array([1, 2, 3]) };

const chatBody = (content: string, usage = { prompt_tokens: 1000, completion_tokens: 50, cost: 0.0003 }) =>
	JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage });

describe('box formats', () => {
	it('reads Qwen3-VL bbox_2d as [x1, y1, x2, y2] on a 0–1000 scale', () => {
		const { objects } = readDiscovery(JSON.stringify({ objects: [{ label: 'Cup', bbox_2d: [100, 200, 300, 500] }] }), qwen);
		expect(objects).toEqual([{ label: 'cup', box: { x: 0.1, y: 0.2, width: 0.2, height: 0.3 } }]);
	});

	it('reads Gemini box_2d as [ymin, xmin, ymax, xmax] on a 0–1000 scale', () => {
		const { objects } = readDiscovery(JSON.stringify({ objects: [{ label: 'cup', box_2d: [200, 100, 500, 300] }] }), gemini);
		expect(objects[0].box).toEqual({ x: 0.1, y: 0.2, width: 0.2, height: 0.3 });
	});

	it('refuses model families without a verified convention, such as Qwen2.5-VL pixels', () => {
		expect(() => boxFormatFor('qwen/qwen2.5-vl-72b-instruct')).toThrow(/No verified box format/);
		expect(() => boxFormatFor('meta-llama/llama-4-scout')).toThrow();
	});

	it('asks for the family field name in the JSON schema', () => {
		const req = discoveryRequest('qwen/qwen3-vl-235b-a22b-instruct', 'data:image/jpeg;base64,AA');
		expect(JSON.stringify(req.response_format)).toContain('bbox_2d');
		expect(req.temperature).toBe(0);
	});
});

describe('readDiscovery', () => {
	it('rejects invalid entries one by one without repairing them', () => {
		const { objects, rejected } = readDiscovery(
			JSON.stringify({
				objects: [
					{ label: 'lamp', bbox_2d: [0, 0, 100, 400] },
					{ label: 'chair', bbox_2d: [500, 500, 400, 900] },
					{ label: 'table', bbox_2d: [0, 0, 1200, 400] },
					{ label: 'vase', bbox_2d: [1, 2, 3] }
				]
			}),
			qwen
		);
		expect(objects.map((o) => o.label)).toEqual(['lamp']);
		expect(rejected.map((r) => r.reason)).toEqual(['box: invalid coordinates', 'box: invalid coordinates', 'box: malformed entry']);
	});

	it('accepts JSON wrapped in a code fence', () => {
		expect(readDiscovery('```json\n{"objects":[]}\n```', qwen).rejected).toEqual([]);
	});

	it('reports non-JSON answers', () => {
		expect(readDiscovery('I see a lamp.', qwen).rejected[0].reason).toBe('answer: not JSON');
	});

	it('treats an absurd number of objects as a malformed answer', () => {
		const many = Array.from({ length: 61 }, () => ({ label: 'x', bbox_2d: [0, 0, 10, 10] }));
		expect(readDiscovery(JSON.stringify({ objects: many }), qwen).objects).toEqual([]);
	});
});

describe('readIdentityAnswer', () => {
	it('accepts only the three answers', () => {
		expect(readIdentityAnswer('{"answer":"same"}')).toBe('same');
		expect(readIdentityAnswer('{"answer":"probably"}')).toBeNull();
		expect(readIdentityAnswer(null)).toBeNull();
	});
});

describe('vision provider', () => {
	const answer = JSON.stringify({
		objects: [
			{ label: 'cup', bbox_2d: [100, 100, 200, 200] },
			{ label: 'ghost', bbox_2d: [600, 100, 700, 200] }
		]
	});

	it('keeps every valid box as uncertain without a verifier, with null confidence', async () => {
		const fetchMock = vi.fn(async () => new Response(chatBody(answer)));
		const p = createVisionProvider({ transport: createChatTransport({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch }) });
		const r = await p.discover(image, new JobBudget(1));
		expect(r.detections).toHaveLength(2);
		expect(r.detections.every((d) => d.presence === 'uncertain' && d.providerConfidence === null && d.source === 'vision')).toBe(true);
		expect(r.usage).toEqual({ requests: 1, inputTokens: 1000, outputTokens: 50, reportedCost: 0.0003 });
	});

	it('drops boxes the verifier does not support', async () => {
		const fetchMock = vi.fn(async () => new Response(chatBody(answer)));
		const verifier: PresenceVerifier = async (_img, candidates, budget) => {
			budget.spend();
			expect(candidates.map((c) => c.label)).toEqual(['cup', 'ghost']);
			return { scores: [0.95, 0.1], usage: { requests: 1, inputTokens: 10, outputTokens: 0, reportedCost: null }, durationMs: 5 };
		};
		const p = createVisionProvider({ transport: createChatTransport({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch }), verifier });
		const r = await p.discover(image, new JobBudget(2));
		expect(r.detections.map((d) => [d.label, d.presence])).toEqual([['cup', 'supported']]);
		expect(r.rejected[0].reason).toMatch(/below presence threshold/);
		expect(r.usage.requests).toBe(2);
	});

	it('spends the budget before sending and does not retry', async () => {
		const fetchMock = vi.fn(async () => new Response('{"error":"overloaded"}', { status: 503 }));
		const t = createChatTransport({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
		const budget = new JobBudget(1);
		const req = discoveryRequest('qwen/qwen3-vl-235b-a22b-instruct', 'data:image/jpeg;base64,AA');
		await expect(t.send(req, budget)).rejects.toThrow(/HTTP 503/);
		await expect(t.send(req, budget)).rejects.toBeInstanceOf(BudgetExceededError);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('maps identity answers without inventing confidence', async () => {
		const fetchMock = vi.fn(async () => new Response(chatBody('{"answer":"unsure"}')));
		const p = createVisionProvider({ transport: createChatTransport({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch }) });
		const r = await p.compareIdentity(image, image, new JobBudget(1));
		expect(r).toMatchObject({ outcome: 'uncertain', providerConfidence: null, rawScore: null });
	});

	it('never logs image data or the key', async () => {
		const log = vi.fn();
		const fetchMock = vi.fn(async () => new Response(chatBody('{"objects":[]}')));
		const t = createChatTransport({ apiKey: 'secret-key', fetch: fetchMock as unknown as typeof fetch, log });
		await t.send(discoveryRequest('qwen/qwen3-vl-235b-a22b-instruct', `data:image/jpeg;base64,${'Q'.repeat(5000)}`), new JobBudget(1));
		const logged = JSON.stringify(log.mock.calls);
		expect(logged).not.toContain('QQQQ');
		expect(logged).not.toContain('secret-key');
		expect(JSON.stringify(redactChatRequest(discoveryRequest('qwen/qwen3-vl-235b-a22b-instruct', 'data:image/png;base64,AAAA')))).not.toContain('base64');
	});
});
