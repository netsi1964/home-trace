import { ACCESS_COOKIE, ACCESS_DAYS, codeMatches, issueToken, tokenValid } from '#lib/server/access.ts';
import { config, json } from '#lib/server/http.ts';
import type { RequestHandler } from './$types';

/** Whether live AI is set up and whether this browser is unlocked. Reveals no secrets. */
export const GET: RequestHandler = ({ cookies }) => {
	const c = config();
	return json(200, {
		configured: c.configured,
		unlocked: c.configured && tokenValid(cookies.get(ACCESS_COOKIE), c.sessionSecret),
		provider: c.configured ? c.provider : null
	});
};

export const POST: RequestHandler = async ({ request, cookies }) => {
	const c = config();
	if (!c.configured) return json(503, { message: 'AI analysis is not configured on this server' });
	const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
	const code = typeof body?.code === 'string' ? body.code.slice(0, 200) : '';
	if (!codeMatches(code, c.accessCode)) {
		await new Promise((r) => setTimeout(r, 600)); // slows guessing
		return json(401, { message: 'Wrong access code' });
	}
	cookies.set(ACCESS_COOKIE, issueToken(c.sessionSecret), {
		path: '/',
		httpOnly: true,
		sameSite: 'strict',
		secure: true,
		maxAge: ACCESS_DAYS * 86_400
	});
	return json(200, { ok: true });
};
