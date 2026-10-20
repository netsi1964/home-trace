import type { Detection, MatchProposal, Usage } from './types.ts';

/**
 * Browser client for the private analysis proxy (PRD-SEC-004). It never sees a provider key.
 * No automatic retries: every failure is reported, and the user decides whether to retry.
 */

export type LiveFailure = 'unavailable' | 'locked' | 'budget' | 'network' | 'provider' | 'cancelled';

export type LiveError = { kind: LiveFailure; message: string; requests: number };

export type DiscoverResponse = { detections: Detection[]; rejected: number; usage: Usage; durationMs: number; provider: string; model: string | null };

export type IdentityResponse = { outcome: MatchProposal['outcome']; usage: Usage; durationMs: number };

async function call<T>(path: string, body: FormData, signal?: AbortSignal): Promise<{ ok: true; value: T } | { ok: false; error: LiveError }> {
	let res: Response;
	try {
		res = await fetch(path, { method: 'POST', body, signal, credentials: 'same-origin' });
	} catch (e) {
		if (signal?.aborted) return { ok: false, error: { kind: 'cancelled', message: 'Cancelled', requests: 0 } };
		return { ok: false, error: { kind: 'network', message: e instanceof Error ? e.message : 'Network error', requests: 0 } };
	}
	let json: Record<string, unknown> = {};
	try {
		json = await res.json();
	} catch {
		/* non-JSON error page */
	}
	if (res.ok) return { ok: true, value: json as T };
	const requests = typeof json.requests === 'number' ? json.requests : 0;
	const message = typeof json.message === 'string' ? json.message : `HTTP ${res.status}`;
	const kind: LiveFailure = res.status === 503 ? 'unavailable' : res.status === 401 ? 'locked' : res.status === 429 ? 'budget' : 'provider';
	return { ok: false, error: { kind, message, requests } };
}

export function discoverLive(frame: Blob, signal?: AbortSignal) {
	const fd = new FormData();
	fd.append('image', frame, 'frame.jpg');
	return call<DiscoverResponse>('/api/analyze/discover', fd, signal);
}

export function identityLive(earlier: Blob, later: Blob, signal?: AbortSignal) {
	const fd = new FormData();
	fd.append('earlier', earlier, 'earlier.jpg');
	fd.append('later', later, 'later.jpg');
	return call<IdentityResponse>('/api/analyze/identity', fd, signal);
}

export async function unlock(code: string): Promise<boolean> {
	const res = await fetch('/api/access', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ code }),
		credentials: 'same-origin'
	}).catch(() => null);
	return !!res?.ok;
}

export async function accessStatus(): Promise<{ configured: boolean; unlocked: boolean; provider: string | null }> {
	const res = await fetch('/api/access', { credentials: 'same-origin' }).catch(() => null);
	if (!res?.ok) return { configured: false, unlocked: false, provider: null };
	return res.json();
}
