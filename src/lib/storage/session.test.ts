import { describe, expect, it } from 'vitest';
import { link, readSession } from './session.ts';

const id = '123e4567-e89b-42d3-a456-426614174000';

describe('session URLs', () => {
	it('round-trips UUID parameters and mode', () => {
		const url = new URL(link('/scan', { room: id, viewpoint: id, mode: 'compare', reference: id }), 'https://x.test');
		expect(readSession(url)).toEqual({ room: id, viewpoint: id, mode: 'compare', reference: id });
	});

	it('drops anything that is not a UUID, so nothing sensitive can travel in the URL', () => {
		const url = new URL(`https://x.test/scan?room=${id}&session=sk-or-secret&image=data:abc&mode=evil`);
		expect(readSession(url)).toEqual({ room: id });
		expect(link('/x', { session: 'not-a-uuid' } as never)).toBe('/x');
	});
});
