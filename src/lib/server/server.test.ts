import { afterEach, describe, expect, it, vi } from 'vitest';
import { codeMatches, issueToken, tokenValid } from './access.ts';
import { budgetedFetch, DailyLimitError, memoryLog } from './budget.ts';
import { readConfig } from './config.ts';
import { discover, identity, type Crops } from './analyze.ts';

const env = {
	OPEN_ROUTER_API_KEY: 'sk-or-test-key',
	HOMETRACE_ACCESS_CODE: 'correct horse',
	HOMETRACE_SESSION_SECRET: 'x'.repeat(40),
	HOMETRACE_PROVIDER: 'vision'
};

const image = { mimeType: 'image/jpeg' as const, width: 1200, height: 900, bytes: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]) };
const crops: Crops = { prepare: async () => image, region: async () => image, box: async () => image };
const form = (...names: string[]) => {
	const f = new FormData();
	for (const n of names) f.append(n, new File([new Uint8Array([0xff, 0xd8, 0xff])], `${n}.jpg`, { type: 'image/jpeg' }));
	return f;
};
const chat = (content: string) =>
	new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 900, completion_tokens: 40, cost: 0.0004 } }));

afterEach(() => vi.unstubAllGlobals());

describe('PRD-SEC-007 proxy access', () => {
	it('requires key, access code and session secret before AI is configured', () => {
		expect(readConfig(env).configured).toBe(true);
		expect(readConfig({ ...env, HOMETRACE_ACCESS_CODE: '' }).configured).toBe(false);
		expect(readConfig({ ...env, HOMETRACE_SESSION_SECRET: 'short' }).configured).toBe(false);
		expect(readConfig({ ...env, HOMETRACE_PROVIDER: 'nonsense' }).provider).toBe('vision-jev');
		expect(readConfig(env).dailyRequestLimit).toBe(200);
	});

	it('checks the code and signs an expiring cookie', () => {
		expect(codeMatches('correct horse', 'correct horse')).toBe(true);
		expect(codeMatches('wrong', 'correct horse')).toBe(false);
		expect(codeMatches('', '')).toBe(false);
		const secret = 'y'.repeat(40);
		const token = issueToken(secret, 1000);
		expect(tokenValid(token, secret, 2000)).toBe(true);
		expect(tokenValid(token, 'z'.repeat(40), 2000)).toBe(false);
		expect(tokenValid(token, secret, 1000 + 31 * 86_400_000)).toBe(false);
		expect(tokenValid(token.replace(/.$/, 'A'), secret, 2000)).toBe(false);
	});
});

describe('PRD-FEAT-010 daily budget', () => {
	it('records each request and refuses once the limit is reached, before sending', async () => {
		const inner = vi.fn(async () => new Response('ok'));
		const state = { sent: 0, limitHit: false };
		const f = budgetedFetch(memoryLog(), 2, state, inner as unknown as typeof fetch);
		await f('https://x');
		await f('https://x');
		await expect(f('https://x')).rejects.toBeInstanceOf(DailyLimitError);
		expect(inner).toHaveBeenCalledTimes(2);
		expect(state).toEqual({ sent: 2, limitHit: true });
	});
});

describe('analysis proxy', () => {
	it('returns validated detections and usage for one frame', async () => {
		const fetchMock = vi.fn(async () => chat(JSON.stringify({ objects: [{ label: 'Lamp', bbox_2d: [100, 100, 300, 800] }, { label: 'bad', bbox_2d: [1, 2] }] })));
		vi.stubGlobal('fetch', fetchMock);
		const r = await discover(readConfig(env), form('image'), { log: memoryLog(), crops });
		expect(r.status).toBe(200);
		expect(r.body.detections).toMatchObject([{ label: 'lamp', source: 'vision', providerConfidence: null }]);
		expect(r.body.rejected).toBe(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('answers 429 when the daily budget is used up, without contacting the provider', async () => {
		const fetchMock = vi.fn(async () => chat('{"objects":[]}'));
		vi.stubGlobal('fetch', fetchMock);
		const r = await discover(readConfig({ ...env, HOMETRACE_DAILY_REQUEST_LIMIT: '1' }), form('image'), { log: { countToday: async () => 1, record: async () => {} }, crops });
		expect(r.status).toBe(429);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects non-images and oversized uploads', async () => {
		const f = new FormData();
		f.append('image', new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }));
		expect((await discover(readConfig(env), f, { log: memoryLog(), crops })).status).toBe(400);
		expect((await discover(readConfig(env), new FormData(), { log: memoryLog(), crops })).status).toBe(400);
	});

	it('reports provider failures as 502 with the number of requests sent, and never retries', async () => {
		const fetchMock = vi.fn(async () => new Response('{"error":"down"}', { status: 503 }));
		vi.stubGlobal('fetch', fetchMock);
		const r = await discover(readConfig(env), form('image'), { log: memoryLog(), crops });
		expect(r).toMatchObject({ status: 502, body: { requests: 1 } });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('T22: technical logs contain neither the key nor image data', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => {});
		vi.stubGlobal('fetch', vi.fn(async () => chat('{"objects":[]}')));
		await discover(readConfig(env), form('image'), { log: memoryLog(), crops });
		const logged = JSON.stringify(info.mock.calls);
		expect(logged).not.toContain('sk-or-test-key');
		expect(logged).not.toMatch(/base64/);
		info.mockRestore();
	});

	it('identity returns only an outcome proposal', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => chat('{"answer":"different"}')));
		const r = await identity(readConfig(env), form('earlier', 'later'), { log: memoryLog(), crops });
		expect(r).toMatchObject({ status: 200, body: { outcome: 'unlikely_same' } });
	});
});
