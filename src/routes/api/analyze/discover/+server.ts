import { discover } from '#lib/server/analyze.ts';
import { config, guard, json } from '#lib/server/http.ts';
import type { RequestHandler } from './$types';

/** One bounded discovery job for one captured frame (PRD-FEAT-002, PRD-FEAT-010). */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const c = config();
	const denied = guard(c, cookies);
	if (denied) return denied;
	const form = await request.formData().catch(() => null);
	if (!form) return json(400, { message: 'Expected multipart form data' });
	const r = await discover(c, form);
	return json(r.status, r.body);
};
