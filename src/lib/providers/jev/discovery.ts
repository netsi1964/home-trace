import { iou, parseBox, type Box } from '../../geometry/box.ts';
import type { Detection, MatchProposal } from '../types.ts';
import {
	edgesToBox,
	readBox,
	readChoice,
	readNoul,
	type DecisionsRequest,
	type DecisionsResponse,
	type ImagePart,
	type Question
} from './contract.ts';

/**
 * Phase 0 discovery strategy: "category count, then locate". This is a hypothesis to measure,
 * not a documented JEV capability. JEV has no list-of-boxes answer, so:
 *
 * 1. Count request: one Choice per category (none / one / two / three / four_or_more).
 * 2. Locate request: for each counted instance, one Noul presence check plus one Box,
 *    described by position ("the leftmost chair").
 *
 * Two requests per image regardless of the number of categories. Instances beyond
 * MAX_INSTANCES_PER_CATEGORY are not located; that limitation shows up as missed objects.
 */

export type Category = { key: string; singular: string; plural: string };

export const DEFAULT_CATEGORIES: Category[] = [
	{ key: 'chair', singular: 'chair', plural: 'chairs' },
	{ key: 'sofa', singular: 'sofa', plural: 'sofas' },
	{ key: 'table', singular: 'table', plural: 'tables' },
	{ key: 'lamp', singular: 'lamp', plural: 'lamps' },
	{ key: 'cup', singular: 'cup or mug', plural: 'cups or mugs' },
	{ key: 'bottle', singular: 'bottle', plural: 'bottles' },
	{ key: 'book', singular: 'book', plural: 'books' },
	{ key: 'plant', singular: 'potted plant', plural: 'potted plants' },
	{ key: 'tv', singular: 'television', plural: 'televisions' },
	{ key: 'laptop', singular: 'laptop', plural: 'laptops' },
	{ key: 'picture', singular: 'picture or framed photo', plural: 'pictures or framed photos' },
	{ key: 'cushion', singular: 'cushion', plural: 'cushions' },
	{ key: 'vase', singular: 'vase', plural: 'vases' },
	{ key: 'bowl', singular: 'bowl', plural: 'bowls' },
	{ key: 'clock', singular: 'clock', plural: 'clocks' },
	{ key: 'rug', singular: 'rug', plural: 'rugs' },
	{ key: 'basket', singular: 'basket', plural: 'baskets' },
	{ key: 'remote', singular: 'remote control', plural: 'remote controls' },
	{ key: 'speaker', singular: 'speaker', plural: 'speakers' },
	{ key: 'shoe', singular: 'shoe', plural: 'shoes' }
];

export const MAX_INSTANCES_PER_CATEGORY = 3;

const COUNTS = { none: 0, one: 1, two: 2, three: 3, four_or_more: 4 } as const;

/** Boxes of the same category overlapping this much are the same instance answered twice. */
export const DUPLICATE_IOU = 0.7;

const PHOTO_LABEL = 'Photo of part of a room in a home:';

export function countRequest(model: string, image: ImagePart, categories: Category[]): DecisionsRequest {
	const questions: Record<string, Question> = {};
	for (const c of categories) {
		questions[`count__${c.key}`] = {
			type: 'choice',
			instructions: `How many ${c.plural} are clearly visible in the photo?`,
			criteria: { none: null, one: null, two: null, three: null, four_or_more: 'four or more' }
		};
	}
	return { model, state: [PHOTO_LABEL, image], questions };
}

export type CategoryCount = { category: Category; count: number; confidence: number | null };

export function readCounts(res: DecisionsResponse, categories: Category[]): { counts: CategoryCount[]; rejected: { reason: string; raw: string }[] } {
	const counts: CategoryCount[] = [];
	const rejected: { reason: string; raw: string }[] = [];
	for (const c of categories) {
		const key = `count__${c.key}`;
		const a = readChoice(res.answers[key]);
		if (!a.ok) {
			rejected.push({ reason: `${key}: ${a.reason}`, raw: safeJson(res.answers[key]) });
			continue;
		}
		const count = COUNTS[a.value.choice as keyof typeof COUNTS];
		if (count === undefined) {
			rejected.push({ reason: `${key}: unknown choice`, raw: safeJson(a.value) });
			continue;
		}
		if (count > 0) counts.push({ category: c, count, confidence: a.value.confidence ?? null });
	}
	return { counts, rejected };
}

type Slot = { category: Category; index: number; total: number };

function slots(counts: CategoryCount[]): Slot[] {
	return counts.flatMap((c) => {
		const n = Math.min(c.count, MAX_INSTANCES_PER_CATEGORY);
		return Array.from({ length: n }, (_, index) => ({ category: c.category, index, total: c.count }));
	});
}

/**
 * Position words for repeated instances. Measured on Demo fixtures 2026-10-19: "the second cup
 * from the left" returned the same box as the first, so extremes ("leftmost", "rightmost") are used.
 */
function describe(s: Slot): string {
	const name = s.category.singular;
	if (s.total === 1) return `the ${name} in the photo`;
	const located = Math.min(s.total, MAX_INSTANCES_PER_CATEGORY);
	if (s.index === 0) return `the leftmost ${name} in the photo`;
	if (s.index === located - 1 && s.total <= MAX_INSTANCES_PER_CATEGORY) return `the rightmost ${name} in the photo`;
	return `the ${name} in the photo that is neither the leftmost nor the rightmost one`;
}

export function locateRequest(model: string, image: ImagePart, counts: CategoryCount[]): DecisionsRequest | null {
	const questions: Record<string, Question> = {};
	for (const s of slots(counts)) {
		const k = `${s.category.key}__${s.index}`;
		questions[`present__${k}`] = {
			type: 'noul',
			instructions:
				s.total === 1
					? `A ${s.category.singular} is clearly visible in the photo.`
					: `At least ${s.index + 1} separate ${s.category.plural} are clearly visible in the photo.`
		};
		questions[`box__${k}`] = { type: 'box', instructions: describe(s) };
	}
	return Object.keys(questions).length > 0 ? { model, state: [PHOTO_LABEL, image], questions } : null;
}

export type LocateOptions = {
	/** Noul answers below this drop the box. Tune on fixtures; no documented threshold exists. */
	presenceThreshold: number;
	/** Noul answers at or above `presenceThreshold` but below this are kept as `uncertain`. */
	supportedThreshold: number;
	newId: () => string;
};

export function readLocations(
	res: DecisionsResponse,
	counts: CategoryCount[],
	opts: LocateOptions
): { detections: Detection[]; rejected: { reason: string; raw: string }[]; presence: Record<string, number> } {
	const detections: Detection[] = [];
	const rejected: { reason: string; raw: string }[] = [];
	const presence: Record<string, number> = {};
	for (const s of slots(counts)) {
		const k = `${s.category.key}__${s.index}`;
		const p = readNoul(res.answers[`present__${k}`]);
		const b = readBox(res.answers[`box__${k}`]);
		if (!b.ok) {
			rejected.push({ reason: `box__${k}: ${b.reason}`, raw: safeJson(res.answers[`box__${k}`]) });
			continue;
		}
		if (!p.ok) {
			rejected.push({ reason: `present__${k}: ${p.reason}`, raw: safeJson(res.answers[`present__${k}`]) });
			continue;
		}
		presence[k] = p.value.noul;
		if (p.value.noul < opts.presenceThreshold) {
			rejected.push({ reason: `present__${k}: below presence threshold`, raw: String(p.value.noul) });
			continue;
		}
		const box = edgesToBox(b.value.box);
		if (!box) {
			rejected.push({ reason: `box__${k}: invalid edges`, raw: safeJson(b.value.box) });
			continue;
		}
		const twin = detections.find((d) => d.category === s.category.key && iou(d.box, box) >= DUPLICATE_IOU);
		if (twin) {
			// Not a box error: the same instance was answered for two slots (repeated-instance failure).
			rejected.push({ reason: `duplicate__${k}: same instance as an earlier ${s.category.key}`, raw: safeJson(b.value.box) });
			continue;
		}
		detections.push({
			id: opts.newId(),
			label: s.category.singular,
			category: s.category.key,
			box,
			source: 'jev',
			providerConfidence: b.value.confidence ?? null,
			presence: p.value.noul >= opts.supportedThreshold ? 'supported' : 'uncertain'
		});
	}
	return { detections, rejected, presence };
}

/** Identity check on two crops. One Noul; no confidence field exists for Noul. */
export function identityRequest(model: string, earlier: ImagePart, later: ImagePart): DecisionsRequest {
	return {
		model,
		state: ['Crop A, from an earlier photo:', earlier, 'Crop B, from a later photo:', later],
		questions: {
			same: {
				type: 'noul',
				instructions:
					'Crop A and crop B show the same individual physical object, not merely two similar or identical-looking objects.'
			}
		}
	};
}

export type IdentityThresholds = { possibleSame: number; unlikelySame: number };

export function readIdentity(
	res: DecisionsResponse,
	t: IdentityThresholds
): { outcome: MatchProposal['outcome']; noul: number | null; reason?: string } {
	const a = readNoul(res.answers.same);
	if (!a.ok) return { outcome: 'uncertain', noul: null, reason: a.reason };
	const p = a.value.noul;
	const outcome = p >= t.possibleSame ? 'possible_same' : p <= t.unlikelySame ? 'unlikely_same' : 'uncertain';
	return { outcome, noul: p };
}

function safeJson(v: unknown): string {
	try {
		return JSON.stringify(v)?.slice(0, 500) ?? 'undefined';
	} catch {
		return '[unserialisable]';
	}
}

/**
 * Region splitting for repeated instances, as the Box docs recommend ("split the image into
 * regions and ask again on each"). Measured on Demo fixtures 2026-10-19: position words such as
 * "the rightmost cup" still returned the left cup, so categories counted two or more times are
 * located per overlapping vertical strip instead.
 */
export const STRIPS: Box[] = [
	{ x: 0, y: 0, width: 0.45, height: 1 },
	{ x: 0.275, y: 0, width: 0.45, height: 1 },
	{ x: 0.55, y: 0, width: 0.45, height: 1 }
];

const CROP_LABEL = 'Vertical strip cut from a photo of part of a room in a home:';

export function stripRequest(model: string, strip: ImagePart, categories: Category[]): DecisionsRequest | null {
	const questions: Record<string, Question> = {};
	for (const c of categories) {
		questions[`present__${c.key}`] = { type: 'noul', instructions: `A ${c.singular} is clearly visible in the image.` };
		questions[`box__${c.key}`] = { type: 'box', instructions: `the ${c.singular} in the image` };
	}
	return categories.length > 0 ? { model, state: [CROP_LABEL, strip], questions } : null;
}

/** Reads one strip's answers and maps boxes back to full-frame coordinates. */
export function readStrip(
	res: DecisionsResponse,
	categories: Category[],
	region: Box,
	opts: LocateOptions
): { detections: Detection[]; rejected: { reason: string; raw: string }[] } {
	const detections: Detection[] = [];
	const rejected: { reason: string; raw: string }[] = [];
	const tag = `strip@${region.x}`;
	for (const c of categories) {
		const p = readNoul(res.answers[`present__${c.key}`]);
		const b = readBox(res.answers[`box__${c.key}`]);
		if (!b.ok) {
			rejected.push({ reason: `box__${c.key} ${tag}: ${b.reason}`, raw: safeJson(res.answers[`box__${c.key}`]) });
			continue;
		}
		if (!p.ok || p.value.noul < opts.presenceThreshold) {
			rejected.push({ reason: `present__${c.key} ${tag}: ${p.ok ? 'below presence threshold' : p.reason}`, raw: p.ok ? String(p.value.noul) : '' });
			continue;
		}
		const local = edgesToBox(b.value.box);
		const box = local && parseBox({
			x: region.x + local.x * region.width,
			y: region.y + local.y * region.height,
			width: local.width * region.width,
			height: local.height * region.height
		});
		if (!box) {
			rejected.push({ reason: `box__${c.key} ${tag}: invalid edges`, raw: safeJson(b.value.box) });
			continue;
		}
		detections.push({
			id: opts.newId(),
			label: c.singular,
			category: c.key,
			box,
			source: 'jev',
			providerConfidence: b.value.confidence ?? null,
			presence: p.value.noul >= opts.supportedThreshold ? 'supported' : 'uncertain'
		});
	}
	return { detections, rejected };
}

/**
 * Merges strip detections: strips overlap, so one object can be found twice, possibly cut at a
 * strip edge. A box mostly inside another of the same category is the same instance; the larger
 * box wins. Keeps at most `limit` per category, largest boxes first.
 */
export function mergeStripDetections(
	detections: Detection[],
	limit: Map<string, number>
): { kept: Detection[]; dropped: { reason: string; raw: string }[] } {
	const kept: Detection[] = [];
	const dropped: { reason: string; raw: string }[] = [];
	const byArea = [...detections].sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height);
	for (const d of byArea) {
		const same = kept.find((k) => k.category === d.category && coverOfSmaller(k.box, d.box) >= 0.6);
		if (same) {
			dropped.push({ reason: `duplicate__${d.category}: same instance seen in two strips`, raw: safeJson(d.box) });
			continue;
		}
		const n = kept.filter((k) => k.category === d.category).length;
		if (n >= (limit.get(d.category ?? '') ?? Infinity)) {
			dropped.push({ reason: `excess__${d.category}: more boxes than counted`, raw: safeJson(d.box) });
			continue;
		}
		kept.push(d);
	}
	return { kept, dropped };
}

function coverOfSmaller(a: Box, b: Box): number {
	const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
	const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
	return (ix * iy) / Math.min(a.width * a.height, b.width * b.height);
}
