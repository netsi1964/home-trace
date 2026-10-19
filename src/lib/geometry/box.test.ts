import { describe, expect, it } from 'vitest';
import { iou, normaliseBox, parseBox } from './box.ts';

describe('parseBox', () => {
	it('accepts a box inside the frame', () => {
		expect(parseBox({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 })).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 });
	});

	it.each([
		['negative origin', { x: -0.1, y: 0, width: 0.2, height: 0.2 }],
		['zero area', { x: 0.1, y: 0.1, width: 0, height: 0.2 }],
		['outside the frame', { x: 0.9, y: 0.1, width: 0.2, height: 0.2 }],
		['pixel coordinates', { x: 120, y: 40, width: 300, height: 200 }],
		['NaN', { x: Number.NaN, y: 0, width: 0.1, height: 0.1 }],
		['extra fields', { x: 0, y: 0, width: 0.1, height: 0.1, z: 3 }]
	])('rejects %s instead of clamping', (_, value) => {
		expect(parseBox(value)).toBeNull();
	});
});

describe('iou', () => {
	const a = { x: 0, y: 0, width: 0.5, height: 0.5 };

	it('is 1 for identical boxes and 0 for disjoint ones', () => {
		expect(iou(a, a)).toBe(1);
		expect(iou(a, { x: 0.6, y: 0.6, width: 0.2, height: 0.2 })).toBe(0);
	});

	it('is 1/3 for two half-overlapping boxes of equal size', () => {
		expect(iou(a, { x: 0.25, y: 0, width: 0.5, height: 0.5 })).toBeCloseTo(1 / 3);
	});
});

describe('normaliseBox', () => {
	it('divides by the oriented frame size', () => {
		expect(normaliseBox({ x: 300, y: 200, width: 600, height: 400 }, { width: 1200, height: 800 })).toEqual({
			x: 0.25,
			y: 0.25,
			width: 0.5,
			height: 0.5
		});
	});
});
