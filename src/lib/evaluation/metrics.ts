import { iou, type Box } from '../geometry/box.ts';
import type { MatchProposal } from '../providers/types.ts';
import type { AnnotatedImage, IdentityPair } from './groundTruth.ts';

/** Evaluation gate from PRD-SEC-008. Targets, not measured or promised JEV quality. */
export const GATE = { precision: 0.9, recall: 0.8, iouThreshold: 0.5, minImages: 12 } as const;

export type Prediction = { label: string; box: Box };

export type ImageDetectionResult = {
	imageId: string;
	truePositives: number;
	falsePositives: number;
	falseNegatives: number;
	/** Predictions on `partial` objects: neither credited nor penalised. */
	ignored: number;
	labelAgreements: number;
	hallucinationsInEmptyRegions: number;
	repeatedInstanceFailures: RepeatedInstanceFailure[];
	matches: { objectKey: string; predictionIndex: number; iou: number; labelAgrees: boolean }[];
	missed: string[];
};

export type RepeatedInstanceFailure = {
	label: string;
	expected: number;
	found: number;
	/** A single prediction overlapping two or more instances, e.g. one box around two cups. */
	mergedBoxes: number;
};

const norm = (s: string) => s.trim().toLowerCase();

function labelAgrees(prediction: string, label: string, aliases: string[]): boolean {
	const p = norm(prediction);
	return [label, ...aliases].some((l) => {
		const n = norm(l);
		return p === n || p.includes(n) || n.includes(p);
	});
}

/**
 * Scores one image. Matching is class-agnostic, greedy by highest IoU, one-to-one, at
 * IoU ≥ threshold. Label agreement is reported separately so a good box with a different
 * word is visible instead of silently counted as a miss.
 */
export function scoreImage(image: AnnotatedImage, predictions: Prediction[], threshold: number = GATE.iouThreshold): ImageDetectionResult {
	const candidates: { o: number; p: number; v: number }[] = [];
	image.objects.forEach((obj, o) =>
		predictions.forEach((pred, p) => {
			const v = iou(obj.box, pred.box);
			if (v >= threshold) candidates.push({ o, p, v });
		})
	);
	candidates.sort((a, b) => b.v - a.v);

	const usedObjects = new Set<number>();
	const usedPredictions = new Set<number>();
	const matches: ImageDetectionResult['matches'] = [];
	let ignored = 0;
	let truePositives = 0;
	let labelAgreements = 0;

	for (const c of candidates) {
		if (usedObjects.has(c.o) || usedPredictions.has(c.p)) continue;
		usedObjects.add(c.o);
		usedPredictions.add(c.p);
		const obj = image.objects[c.o];
		if (obj.visibility === 'partial') {
			ignored++;
			continue;
		}
		const agrees = labelAgrees(predictions[c.p].label, obj.label, obj.aliases);
		truePositives++;
		if (agrees) labelAgreements++;
		matches.push({ objectKey: obj.objectKey, predictionIndex: c.p, iou: c.v, labelAgrees: agrees });
	}

	const unmatched = predictions.map((_, p) => p).filter((p) => !usedPredictions.has(p));
	const hallucinationsInEmptyRegions = unmatched.filter((p) =>
		image.emptyRegions.some((r) => iou(r, predictions[p].box) >= threshold || contains(r, predictions[p].box))
	).length;

	const targets = image.objects.filter((o) => o.visibility === 'clear');
	const missed = targets.filter((o) => !matches.some((m) => m.objectKey === o.objectKey)).map((o) => o.objectKey);

	return {
		imageId: image.id,
		truePositives,
		falsePositives: unmatched.length,
		falseNegatives: missed.length,
		ignored,
		labelAgreements,
		hallucinationsInEmptyRegions,
		repeatedInstanceFailures: repeatedInstanceFailures(image, predictions, matches),
		matches,
		missed
	};
}

function contains(outer: Box, inner: Box): boolean {
	return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

function repeatedInstanceFailures(
	image: AnnotatedImage,
	predictions: Prediction[],
	matches: ImageDetectionResult['matches']
): RepeatedInstanceFailure[] {
	const groups = new Map<string, AnnotatedImage['objects']>();
	for (const o of image.objects.filter((o) => o.visibility === 'clear')) {
		const key = norm(o.label);
		groups.set(key, [...(groups.get(key) ?? []), o]);
	}
	const failures: RepeatedInstanceFailure[] = [];
	for (const [label, objs] of groups) {
		if (objs.length < 2) continue;
		const found = objs.filter((o) => matches.some((m) => m.objectKey === o.objectKey)).length;
		// A box counts as merged when it covers most of two or more instances.
		const mergedBoxes = predictions.filter(
			(p) => objs.filter((o) => overlapShare(o.box, p.box) >= 0.5).length >= 2
		).length;
		if (found < objs.length || mergedBoxes > 0) failures.push({ label, expected: objs.length, found, mergedBoxes });
	}
	return failures;
}

/** Share of `target` covered by `cover`. */
function overlapShare(target: Box, cover: Box): number {
	const ix = Math.max(0, Math.min(target.x + target.width, cover.x + cover.width) - Math.max(target.x, cover.x));
	const iy = Math.max(0, Math.min(target.y + target.height, cover.y + cover.height) - Math.max(target.y, cover.y));
	return (ix * iy) / (target.width * target.height);
}

export type DetectionSummary = {
	images: number;
	truePositives: number;
	falsePositives: number;
	falseNegatives: number;
	/** null when undefined (no predictions or no targets). Never invented. */
	precision: number | null;
	recall: number | null;
	labelAgreementRate: number | null;
	usableBoxRate: number | null;
	hallucinationsInEmptyRegions: number;
	repeatedInstanceFailures: number;
	gate: { precision: boolean | null; recall: boolean | null; enoughImages: boolean };
};

const ratio = (n: number, d: number) => (d > 0 ? n / d : null);

/**
 * @param validBoxes predictions with a valid box
 * @param rejectedBoxes provider outputs that were rejected as invalid boxes
 */
export function summariseDetection(results: ImageDetectionResult[], validBoxes: number, rejectedBoxes: number): DetectionSummary {
	const tp = sum(results, (r) => r.truePositives);
	const fp = sum(results, (r) => r.falsePositives);
	const fn = sum(results, (r) => r.falseNegatives);
	const precision = ratio(tp, tp + fp);
	const recall = ratio(tp, tp + fn);
	return {
		images: results.length,
		truePositives: tp,
		falsePositives: fp,
		falseNegatives: fn,
		precision,
		recall,
		labelAgreementRate: ratio(sum(results, (r) => r.labelAgreements), tp),
		usableBoxRate: ratio(validBoxes, validBoxes + rejectedBoxes),
		hallucinationsInEmptyRegions: sum(results, (r) => r.hallucinationsInEmptyRegions),
		repeatedInstanceFailures: sum(results, (r) => r.repeatedInstanceFailures.length),
		gate: {
			precision: precision === null ? null : precision >= GATE.precision,
			recall: recall === null ? null : recall >= GATE.recall,
			enoughImages: results.length >= GATE.minImages
		}
	};
}

export type IdentityOutcome = { pair: IdentityPair; outcome: MatchProposal['outcome'] };

export type IdentitySummary = {
	pairs: number;
	positives: { total: number; possibleSame: number; unlikelySame: number; uncertain: number };
	negatives: { total: number; possibleSame: number; unlikelySame: number; uncertain: number };
	/** Different objects proposed as the same. The costly error: it would merge two items. */
	falseSameRate: number | null;
	hardNegativeFalseSame: number;
	/** Same object judged different. */
	falseDifferentRate: number | null;
	uncertainRate: number | null;
};

export function summariseIdentity(outcomes: IdentityOutcome[]): IdentitySummary {
	const tally = (xs: IdentityOutcome[]) => ({
		total: xs.length,
		possibleSame: xs.filter((x) => x.outcome === 'possible_same').length,
		unlikelySame: xs.filter((x) => x.outcome === 'unlikely_same').length,
		uncertain: xs.filter((x) => x.outcome === 'uncertain').length
	});
	const positives = tally(outcomes.filter((x) => x.pair.expectedSame));
	const negatives = tally(outcomes.filter((x) => !x.pair.expectedSame));
	return {
		pairs: outcomes.length,
		positives,
		negatives,
		falseSameRate: ratio(negatives.possibleSame, negatives.total),
		hardNegativeFalseSame: outcomes.filter((x) => x.pair.hardNegative && x.outcome === 'possible_same').length,
		falseDifferentRate: ratio(positives.unlikelySame, positives.total),
		uncertainRate: ratio(positives.uncertain + negatives.uncertain, outcomes.length)
	};
}

function sum<T>(xs: T[], f: (x: T) => number): number {
	return xs.reduce((acc, x) => acc + f(x), 0);
}
