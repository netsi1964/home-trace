import { describe, expect, it } from 'vitest';
import type { AnnotatedImage, GroundTruth } from './groundTruth.ts';
import { GroundTruthSchema, identityPairs } from './groundTruth.ts';
import { scoreImage, summariseDetection, summariseIdentity } from './metrics.ts';

const box = (x: number, y: number, width = 0.1, height = 0.1) => ({ x, y, width, height });

const image = (objects: AnnotatedImage['objects'], emptyRegions: AnnotatedImage['emptyRegions'] = []): AnnotatedImage => ({
	id: 'img',
	file: 'img.jpg',
	width: 1200,
	height: 900,
	room: 'Living room',
	viewpoint: 'From the doorway',
	conditions: ['normal'],
	objects,
	emptyRegions
});

const obj = (objectKey: string, label: string, b: ReturnType<typeof box>, visibility: 'clear' | 'partial' = 'clear') => ({
	objectKey,
	label,
	aliases: [],
	category: null,
	box: b,
	visibility
});

describe('scoreImage', () => {
	it('counts true positives, false positives and misses at IoU ≥ 0.5', () => {
		const img = image([obj('lamp-1', 'lamp', box(0.1, 0.1)), obj('chair-1', 'chair', box(0.5, 0.5))]);
		const r = scoreImage(img, [
			{ label: 'lamp', box: box(0.11, 0.1) },
			{ label: 'plant', box: box(0.8, 0.1) }
		]);
		expect(r).toMatchObject({ truePositives: 1, falsePositives: 1, falseNegatives: 1, missed: ['chair-1'], labelAgreements: 1 });
	});

	it('matches one prediction to at most one object', () => {
		const img = image([obj('a', 'cup', box(0.1, 0.1)), obj('b', 'cup', box(0.12, 0.1))]);
		const r = scoreImage(img, [{ label: 'cup', box: box(0.11, 0.1) }]);
		expect(r.truePositives).toBe(1);
		expect(r.falseNegatives).toBe(1);
	});

	it('neither credits nor penalises predictions on partial objects', () => {
		const img = image([obj('cup-2', 'cup', box(0.1, 0.1), 'partial')]);
		const r = scoreImage(img, [{ label: 'cup', box: box(0.1, 0.1) }]);
		expect(r).toMatchObject({ truePositives: 0, falsePositives: 0, falseNegatives: 0, ignored: 1 });
	});

	it('counts a good box with a different word as a match without label agreement', () => {
		const img = image([{ ...obj('cup-1', 'cup', box(0.1, 0.1)), aliases: ['mug'] }]);
		expect(scoreImage(img, [{ label: 'Coffee mug', box: box(0.1, 0.1) }]).labelAgreements).toBe(1);
		expect(scoreImage(img, [{ label: 'vase', box: box(0.1, 0.1) }]).labelAgreements).toBe(0);
	});

	it('flags hallucinated boxes in known empty regions (T11)', () => {
		const img = image([], [box(0.6, 0.0, 0.3, 0.3)]);
		const r = scoreImage(img, [{ label: 'clock', box: box(0.65, 0.05) }]);
		expect(r.hallucinationsInEmptyRegions).toBe(1);
	});

	it('reports a repeated-instance failure for one box around two cups (T03)', () => {
		const img = image([obj('cup-1', 'cup', box(0.1, 0.5)), obj('cup-2', 'cup', box(0.25, 0.5))]);
		const r = scoreImage(img, [{ label: 'cup', box: { x: 0.1, y: 0.5, width: 0.25, height: 0.1 } }]);
		expect(r.repeatedInstanceFailures).toEqual([{ label: 'cup', expected: 2, found: 0, mergedBoxes: 1 }]);
	});
});

describe('summariseDetection', () => {
	it('keeps rates null when undefined instead of inventing numbers', () => {
		const s = summariseDetection([], 0, 0);
		expect(s.precision).toBeNull();
		expect(s.recall).toBeNull();
		expect(s.usableBoxRate).toBeNull();
		expect(s.gate.precision).toBeNull();
	});

	it('computes precision, recall and usable-box rate', () => {
		const img = image([obj('a', 'lamp', box(0.1, 0.1)), obj('b', 'chair', box(0.5, 0.5))]);
		const s = summariseDetection([scoreImage(img, [{ label: 'lamp', box: box(0.1, 0.1) }])], 1, 1);
		expect(s.precision).toBe(1);
		expect(s.recall).toBe(0.5);
		expect(s.usableBoxRate).toBe(0.5);
		expect(s.gate).toEqual({ precision: true, recall: false, enoughImages: false });
	});
});

describe('identity', () => {
	const gt: GroundTruth = GroundTruthSchema.parse({
		schemaVersion: '1.0.0',
		kind: 'hometrace-phase0-ground-truth',
		demo: true,
		images: [
			{ id: 'a', file: 'a.jpg', width: 10, height: 10, room: 'R', viewpoint: 'V', objects: [obj('lamp-1', 'lamp', box(0, 0)), obj('cup-1', 'cup', box(0.5, 0.5))] },
			{ id: 'b', file: 'b.jpg', width: 10, height: 10, room: 'R', viewpoint: 'W', objects: [obj('lamp-1', 'lamp', box(0.2, 0)), obj('cup-2', 'cup', box(0.5, 0.5))] }
		]
	});

	it('derives positives from shared keys and hard negatives from shared labels', () => {
		const pairs = identityPairs(gt);
		expect(pairs).toHaveLength(2);
		expect(pairs.find((p) => p.expectedSame)?.a.objectKey).toBe('lamp-1');
		expect(pairs.find((p) => p.hardNegative)).toMatchObject({ a: { objectKey: 'cup-1' }, b: { objectKey: 'cup-2' } });
	});

	it('reports false-same on hard negatives separately', () => {
		const [pos, neg] = [identityPairs(gt).find((p) => p.expectedSame)!, identityPairs(gt).find((p) => p.hardNegative)!];
		const s = summariseIdentity([
			{ pair: pos, outcome: 'possible_same' },
			{ pair: neg, outcome: 'possible_same' }
		]);
		expect(s.falseSameRate).toBe(1);
		expect(s.hardNegativeFalseSame).toBe(1);
		expect(s.falseDifferentRate).toBe(0);
	});
});

describe('GroundTruthSchema', () => {
	const base = { schemaVersion: '1.0.0', kind: 'hometrace-phase0-ground-truth', demo: false };
	const img = { id: 'a', width: 10, height: 10, room: 'R', viewpoint: 'V', objects: [] };

	it('rejects path traversal in file names', () => {
		expect(GroundTruthSchema.safeParse({ ...base, images: [{ ...img, file: '../secret.jpg' }] }).success).toBe(false);
		expect(GroundTruthSchema.safeParse({ ...base, images: [{ ...img, file: 'sub/a.jpg' }] }).success).toBe(false);
	});

	it('rejects the same object key twice in one image', () => {
		const objects = [obj('cup-1', 'cup', box(0, 0)), obj('cup-1', 'cup', box(0.5, 0.5))];
		expect(GroundTruthSchema.safeParse({ ...base, images: [{ ...img, file: 'a.jpg', objects }] }).success).toBe(false);
	});

	it('rejects an unknown schema version', () => {
		expect(GroundTruthSchema.safeParse({ ...base, schemaVersion: '2.0.0', images: [{ ...img, file: 'a.jpg' }] }).success).toBe(false);
	});
});
