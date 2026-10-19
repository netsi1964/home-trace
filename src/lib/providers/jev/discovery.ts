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
 *    described by order from the left ("the second chair from the left").
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
const ORDINALS = ['first', 'second', 'third'];

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

function describe(s: Slot): string {
	return s.total === 1
		? `the ${s.category.singular} in the photo`
		: `the ${ORDINALS[s.index]} ${s.category.singular} from the left in the photo`;
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
