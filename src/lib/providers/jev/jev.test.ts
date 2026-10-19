import { describe, expect, it, vi } from 'vitest';
import { BudgetExceededError, JobBudget } from '../types.ts';
import { edgesToBox, imagePart, JEV_MODEL, redactRequest } from './contract.ts';
import { countRequest, DEFAULT_CATEGORIES, locateRequest, readCounts, readIdentity, readLocations } from './discovery.ts';
import { createJevTransport, JevRequestError, stripBase64 } from './jev.server.ts';

const part = imagePart('image/jpeg', 'AAAA');
const lamp = DEFAULT_CATEGORIES.find((c) => c.key === 'lamp')!;
const cup = DEFAULT_CATEGORIES.find((c) => c.key === 'cup')!;

describe('edgesToBox', () => {
	it('converts documented edges to x/y/width/height', () => {
		// Example answer from docs.typesafe.ai/primitives/box
		const b = edgesToBox({ top: 0.25, bottom: 0.82, left: 0.44, right: 0.84 })!;
		expect(b.x).toBeCloseTo(0.44);
		expect(b.y).toBeCloseTo(0.25);
		expect(b.width).toBeCloseTo(0.4);
		expect(b.height).toBeCloseTo(0.57);
	});

	it('rejects inverted or empty edges', () => {
		expect(edgesToBox({ top: 0.5, bottom: 0.4, left: 0.1, right: 0.2 })).toBeNull();
		expect(edgesToBox({ top: 0.5, bottom: 0.6, left: 0.3, right: 0.3 })).toBeNull();
	});
});

describe('count then locate', () => {
	it('asks one count question per category in a single request', () => {
		const req = countRequest(JEV_MODEL, part, [lamp, cup]);
		expect(req.model).toBe('typesafe/jev-1.14');
		expect(Object.keys(req.questions)).toEqual(['count__lamp', 'count__cup']);
		expect(req.state[1]).toEqual(part);
	});

	it('pairs every box with a presence check and orders repeated instances from the left', () => {
		const req = locateRequest(JEV_MODEL, part, [
			{ category: lamp, count: 1, confidence: 0.9 },
			{ category: cup, count: 2, confidence: 0.8 }
		])!;
		expect(Object.keys(req.questions).sort()).toEqual(
			['present__lamp__0', 'box__lamp__0', 'present__cup__0', 'box__cup__0', 'present__cup__1', 'box__cup__1'].sort()
		);
		expect(req.questions.box__cup__1.instructions).toBe('the second cup or mug from the left in the photo');
		expect(req.questions.box__lamp__0.type).toBe('box');
	});

	it('returns no locate request when nothing was counted', () => {
		expect(locateRequest(JEV_MODEL, part, [])).toBeNull();
	});

	it('caps located instances per category', () => {
		const req = locateRequest(JEV_MODEL, part, [{ category: cup, count: 4, confidence: null }])!;
		expect(Object.keys(req.questions).filter((k) => k.startsWith('box__'))).toHaveLength(3);
	});

	it('reads counts and rejects unknown choices', () => {
		const { counts, rejected } = readCounts(
			{
				answers: {
					count__lamp: { type: 'choice', choice: 'one', probabilities: { one: 0.9, none: 0.1 }, confidence: 0.85 },
					count__cup: { type: 'choice', choice: 'dozens', probabilities: {}, confidence: 0.5 }
				}
			},
			[lamp, cup]
		);
		expect(counts).toEqual([{ category: lamp, count: 1, confidence: 0.85 }]);
		expect(rejected[0].reason).toMatch(/count__cup/);
	});

	it('drops boxes whose presence check is low, because Box has no "not found" answer', () => {
		const ids = ['d1', 'd2'];
		const { detections, rejected } = readLocations(
			{
				answers: {
					present__cup__0: { type: 'noul', noul: 0.95 },
					box__cup__0: { type: 'box', box: { top: 0.4, bottom: 0.5, left: 0.1, right: 0.2 }, confidence: 0.9 },
					present__cup__1: { type: 'noul', noul: 0.1 },
					box__cup__1: { type: 'box', box: { top: 0.4, bottom: 0.5, left: 0.5, right: 0.6 }, confidence: 0.4 }
				}
			},
			[{ category: cup, count: 2, confidence: null }],
			{ presenceThreshold: 0.5, supportedThreshold: 0.8, newId: () => ids.shift()! }
		);
		expect(detections).toHaveLength(1);
		expect(detections[0]).toMatchObject({ id: 'd1', category: 'cup', source: 'jev', providerConfidence: 0.9, presence: 'supported' });
		expect(rejected[0].reason).toMatch(/below presence threshold/);
	});

	it('keeps missing confidence as null', () => {
		const { detections } = readLocations(
			{
				answers: {
					present__lamp__0: { type: 'noul', noul: 0.6 },
					box__lamp__0: { type: 'box', box: { top: 0.1, bottom: 0.9, left: 0.1, right: 0.3 } }
				}
			},
			[{ category: lamp, count: 1, confidence: null }],
			{ presenceThreshold: 0.5, supportedThreshold: 0.8, newId: () => 'x' }
		);
		expect(detections[0].providerConfidence).toBeNull();
		expect(detections[0].presence).toBe('uncertain');
	});
});

describe('readIdentity', () => {
	const t = { possibleSame: 0.7, unlikelySame: 0.3 };
	it.each([
		[0.9, 'possible_same'],
		[0.5, 'uncertain'],
		[0.1, 'unlikely_same']
	])('maps %s to %s', (noul, outcome) => {
		expect(readIdentity({ answers: { same: { type: 'noul', noul } } }, t).outcome).toBe(outcome);
	});

	it('is uncertain when the answer is missing', () => {
		expect(readIdentity({ answers: {} }, t)).toMatchObject({ outcome: 'uncertain', noul: null });
	});
});

describe('transport', () => {
	const okBody = JSON.stringify({ answers: {}, usage: { input_tokens: 300, output_tokens: 0, cost: 0.0000126 } });

	it('spends the budget before sending and never retries', async () => {
		const fetchMock = vi.fn(async () => new Response('{"error":"boom"}', { status: 500 }));
		const t = createJevTransport({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
		const budget = new JobBudget(5);
		await expect(t.send(countRequest(JEV_MODEL, part, [lamp]), budget)).rejects.toBeInstanceOf(JevRequestError);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(budget.used).toBe(1);
	});

	it('refuses to send once the budget is used up', async () => {
		const fetchMock = vi.fn(async () => new Response(okBody));
		const t = createJevTransport({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
		const budget = new JobBudget(1);
		await t.send(countRequest(JEV_MODEL, part, [lamp]), budget);
		await expect(t.send(countRequest(JEV_MODEL, part, [lamp]), budget)).rejects.toBeInstanceOf(BudgetExceededError);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('enforces a parent run budget across jobs', () => {
		const run = new JobBudget(2);
		new JobBudget(20, run).spend();
		new JobBudget(20, run).spend();
		expect(() => new JobBudget(20, run).spend()).toThrow(BudgetExceededError);
	});

	it('reports provider usage and cost, and logs without image data or the key', async () => {
		const log = vi.fn();
		const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
			expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-key');
			return new Response(okBody);
		});
		const t = createJevTransport({ apiKey: 'secret-key', fetch: fetchMock as unknown as typeof fetch, log });
		const { usage } = await t.send(countRequest(JEV_MODEL, imagePart('image/jpeg', 'Q'.repeat(5000)), [lamp]), new JobBudget(1));
		expect(usage).toEqual({ requests: 1, inputTokens: 300, outputTokens: 0, reportedCost: 0.0000126 });
		const logged = JSON.stringify(log.mock.calls);
		expect(logged).not.toContain('QQQQ');
		expect(logged).not.toContain('secret-key');
	});

	it('requires an API key', () => {
		expect(() => createJevTransport({ apiKey: '' })).toThrow(/OPEN_ROUTER_API_KEY/);
	});
});

describe('redaction', () => {
	it('removes image data from requests and error bodies', () => {
		expect(JSON.stringify(redactRequest(countRequest(JEV_MODEL, part, [lamp])))).not.toContain('base64');
		expect(stripBase64(`bad image data:image/png;base64,${'A'.repeat(300)} end`)).toBe('bad image [data url redacted] end');
	});
});
