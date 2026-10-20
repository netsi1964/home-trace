import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Invite-code access for the private analysis proxy (PRD-SEC-007.5/6). The code is checked in
 * constant time; success sets an httpOnly cookie holding an expiry and an HMAC. Same-origin
 * rules alone are not authentication.
 */

export const ACCESS_COOKIE = 'ht_access';
export const ACCESS_DAYS = 30;

const digest = (s: string) => createHash('sha256').update(s).digest();

export function codeMatches(given: string, expected: string): boolean {
	if (!expected) return false;
	return timingSafeEqual(digest(given), digest(expected));
}

function sign(payload: string, secret: string): string {
	return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function issueToken(secret: string, now = Date.now()): string {
	const expires = String(now + ACCESS_DAYS * 86_400_000);
	return `${expires}.${sign(expires, secret)}`;
}

export function tokenValid(token: string | undefined, secret: string, now = Date.now()): boolean {
	if (!token || !secret) return false;
	const [expires, mac] = token.split('.');
	if (!expires || !mac || !/^\d+$/.test(expires) || Number(expires) < now) return false;
	const expected = Buffer.from(sign(expires, secret));
	const given = Buffer.from(mac);
	return given.length === expected.length && timingSafeEqual(given, expected);
}
