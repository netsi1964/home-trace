import type { Cookies } from '@sveltejs/kit';
import { ACCESS_COOKIE, tokenValid } from './access.ts';
import { readConfig, type ServerConfig } from './config.ts';

/** Netlify sets these in the function environment; locally vite.config.ts loads .env for the server. */
export const config = (): ServerConfig => readConfig(process.env);

export function json(status: number, body: Record<string, unknown>): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
	});
}

/** 503 when AI is not set up, 401 without a valid access cookie, otherwise null (allowed). */
export function guard(c: ServerConfig, cookies: Cookies): Response | null {
	if (!c.configured) return json(503, { message: 'AI analysis is not configured on this server' });
	if (!tokenValid(cookies.get(ACCESS_COOKIE), c.sessionSecret)) return json(401, { message: 'Access code required' });
	return null;
}
