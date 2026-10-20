/**
 * Server-enforced aggregate request budget (PRD-SEC-007.5, PRD-FEAT-010). Every provider
 * request is recorded before it is sent; when today's limit is reached, nothing is sent.
 *
 * Storage is an append-only log (one entry per request under the UTC date), not a counter, so
 * concurrent requests never lose updates. Under concurrency the limit can be exceeded by at
 * most the number of in-flight requests; that is acceptable for a private prototype.
 */

export class DailyLimitError extends Error {
	readonly limit: number;
	constructor(limit: number) {
		super(`Daily limit of ${limit} provider requests reached`);
		this.name = 'DailyLimitError';
		this.limit = limit;
	}
}

export type RequestLog = {
	countToday(day: string): Promise<number>;
	record(day: string): Promise<void>;
};

export const utcDay = (now = new Date()) => now.toISOString().slice(0, 10);

export function memoryLog(): RequestLog {
	const days = new Map<string, number>();
	return {
		async countToday(day) {
			return days.get(day) ?? 0;
		},
		async record(day) {
			days.set(day, (days.get(day) ?? 0) + 1);
		}
	};
}

/** Netlify Blobs log: one key per request, `YYYY-MM-DD/<uuid>`, listed with strong consistency. */
export async function blobsLog(): Promise<RequestLog> {
	const { getStore } = await import('@netlify/blobs');
	const store = getStore({ name: 'hometrace-request-log', consistency: 'strong' });
	return {
		async countToday(day) {
			const { blobs } = await store.list({ prefix: `${day}/` });
			return blobs.length;
		},
		async record(day) {
			await store.set(`${day}/${crypto.randomUUID()}`, '1', { onlyIfNew: true });
		}
	};
}

/**
 * Wraps fetch so that every outgoing provider request first checks and records the daily
 * budget. Used as the transports' `fetch`, so no adapter can bypass it.
 */
export type BudgetState = { sent: number; limitHit: boolean };

export function budgetedFetch(log: RequestLog, limit: number, state: BudgetState, inner: typeof fetch = fetch): typeof fetch {
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		const day = utcDay();
		if ((await log.countToday(day)) >= limit) {
			state.limitHit = true;
			throw new DailyLimitError(limit);
		}
		await log.record(day);
		state.sent++;
		return inner(input, init);
	}) as typeof fetch;
}
