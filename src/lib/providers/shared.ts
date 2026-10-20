import type { Usage } from './types.ts';

/** Provider-neutral helpers shared by adapters. */

export function addUsage(a: Usage, b: Usage): Usage {
	const add = (x: number | null, y: number | null) => (x === null && y === null ? null : (x ?? 0) + (y ?? 0));
	return {
		requests: a.requests + b.requests,
		inputTokens: add(a.inputTokens, b.inputTokens),
		outputTokens: add(a.outputTokens, b.outputTokens),
		reportedCost: add(a.reportedCost, b.reportedCost)
	};
}

export const emptyUsage = (): Usage => ({ requests: 0, inputTokens: null, outputTokens: null, reportedCost: null });

/** Removes long base64 runs and data URLs so error bodies can be logged (PRD-SEC-007). */
export function stripBase64(text: string): string {
	return text
		.replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, '[data url redacted]')
		.replace(/[A-Za-z0-9+/=]{200,}/g, '[base64 redacted]');
}

export function toBase64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('base64');
}
