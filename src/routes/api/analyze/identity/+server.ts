import { identity } from '#lib/server/analyze.ts';
import { config, guard, json } from '#lib/server/http.ts';
import type { RequestHandler } from './$types';

/** An identity proposal for two crops. Only a proposal: the user decides (PRD-FEAT-004). */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const c = config();
	const denied = guard(c, cookies);
	if (denied) return denied;
	const form = await request.formData().catch(() => null);
	if (!form) return json(400, { message: 'Expected multipart form data' });
	const r = await identity(c, form);
	return json(r.status, r.body);
};
