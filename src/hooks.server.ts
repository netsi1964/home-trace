import type { Handle } from '@sveltejs/kit/hooks';

/**
 * Security headers for server-rendered responses. Host config (netlify.toml) only covers
 * static files, so the same headers are set here for everything SvelteKit renders.
 * Private prototype: not indexed, no referrer, camera for this origin only, no microphone
 * (PRD-FEAT-002.1, PRD-SEC-007).
 */
export const SECURITY_HEADERS: Record<string, string> = {
	'X-Robots-Tag': 'noindex, nofollow',
	'Referrer-Policy': 'no-referrer',
	'X-Content-Type-Options': 'nosniff',
	'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()'
};

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		if (!response.headers.has(name)) response.headers.set(name, value);
	}
	return response;
};
