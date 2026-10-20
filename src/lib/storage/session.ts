/**
 * Same-device session URLs (PRD-SEC-004 "Session URLs"). Query parameters hold local database
 * UUIDs only, never credentials, keys or image data (PRD-SEC-007.4).
 */

export type SessionParams = {
	home?: string;
	room?: string;
	viewpoint?: string;
	mode?: 'register' | 'compare';
	reference?: string;
	session?: string;
	object?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEYS = ['home', 'room', 'viewpoint', 'reference', 'session', 'object'] as const;

export function readSession(url: { searchParams: Pick<URLSearchParams, 'get'> }): SessionParams {
	const out: SessionParams = {};
	for (const k of KEYS) {
		const v = url.searchParams.get(k);
		if (v && UUID.test(v)) out[k] = v.toLowerCase();
	}
	const mode = url.searchParams.get('mode');
	if (mode === 'register' || mode === 'compare') out.mode = mode;
	return out;
}

export function link(path: string, params: SessionParams): string {
	const q = new URLSearchParams();
	for (const k of KEYS) {
		const v = params[k];
		if (v && UUID.test(v)) q.set(k, v);
	}
	if (params.mode) q.set('mode', params.mode);
	const s = q.toString();
	return s ? `${path}?${s}` : path;
}
