import { describe, expect, it } from 'vitest';
import { boxFromDrag, emptyDraft, fromGroundTruth, imageIdFor, nextKey, toGroundTruth, type Draft } from './annotationDraft.ts';

const draft = (): Draft => ({
	description: 'Living room test',
	demo: false,
	images: [
		{
			id: 'img-1',
			file: 'IMG_0001.jpg',
			width: 4032,
			height: 3024,
			room: 'Living room',
			viewpoint: 'From the doorway',
			conditions: [],
			objects: [{ objectKey: 'cup-1', label: 'Cup', aliasesText: 'mug, coffee cup ,', visibility: 'clear', box: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 } }],
			emptyRegions: []
		}
	]
});

describe('annotation draft', () => {
	it('normalises a drag in any direction and ignores tiny drags', () => {
		expect(boxFromDrag({ x: 0.6, y: 0.5 }, { x: 0.2, y: 0.1 })).toEqual({ x: 0.2, y: 0.1, width: 0.4, height: 0.4 });
		expect(boxFromDrag({ x: 0.2, y: 0.2 }, { x: 0.205, y: 0.4 })).toBeNull();
		expect(boxFromDrag({ x: -0.2, y: 0.5 }, { x: 0.3, y: 1.4 })).toEqual({ x: 0, y: 0.5, width: 0.3, height: 0.5 });
	});

	it('gives unique keys across the whole draft', () => {
		const d = draft();
		expect(nextKey(d, 'Cup')).toBe('cup-2');
		expect(nextKey(d, 'Reading lamp')).toBe('reading-lamp-1');
	});

	it('derives unique image ids from file names', () => {
		expect(imageIdFor('IMG 0001.JPG', new Set())).toBe('img-0001');
		expect(imageIdFor('a.jpg', new Set(['a']))).toBe('a-2');
	});

	it('exports valid ground truth with split aliases and a default condition', () => {
		const r = toGroundTruth(draft());
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.images[0].objects[0].aliases).toEqual(['mug', 'coffee cup']);
		expect(r.value.images[0].conditions).toEqual(['normal']);
		expect(fromGroundTruth(r.value).images[0].objects[0].aliasesText).toBe('mug, coffee cup');
	});

	it('reports readable issues instead of exporting invalid data', () => {
		const d = draft();
		d.images[0].file = 'my photo (1).heic';
		d.images[0].room = '';
		const r = toGroundTruth(d);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.issues.some((i) => i.startsWith('my photo (1).heic: file'))).toBe(true);
		expect(r.issues.some((i) => i.includes('room'))).toBe(true);
	});

	it('rejects an empty set', () => {
		expect(toGroundTruth(emptyDraft()).ok).toBe(false);
	});
});
