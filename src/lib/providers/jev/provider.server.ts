import type { Box } from '../../geometry/box.ts';
import type { AnalysisImage, AnalysisProvider, Detection, DiscoveryResult, IdentityResult, JobBudget } from '../types.ts';
import { imagePart, JEV_IMAGE_LIMITS, JEV_MODEL, type JevImageMime } from './contract.ts';
import {
	countRequest,
	DEFAULT_CATEGORIES,
	identityRequest,
	locateRequest,
	mergeStripDetections,
	readCounts,
	readStrip,
	stripRequest,
	STRIPS,
	readVerifyCrops,
	verifyCropsRequest,
	readIdentity,
	readLocations,
	type Category,
	type CategoryCount,
	type IdentityThresholds
} from './discovery.ts';
import { addUsage, emptyUsage, toBase64 } from '../shared.ts';
import type { JevTransport } from './jev.server.ts';

export type JevProviderOptions = {
	transport: JevTransport;
	model?: string;
	categories?: Category[];
	presenceThreshold?: number;
	supportedThreshold?: number;
	identity?: IdentityThresholds;
	newId?: () => string;
	/**
	 * Crops a normalised region of the frame. When given, categories counted two or more times
	 * are located per strip (one extra request per strip). Without it, they use position words,
	 * which failed on Demo fixtures.
	 */
	crop?: (image: AnalysisImage, region: Box) => Promise<AnalysisImage>;
};

/** Starting points only. No documented thresholds exist; tune them on fixtures in Phase 0. */
export const DEFAULT_JEV_THRESHOLDS = {
	presenceThreshold: 0.5,
	supportedThreshold: 0.8,
	identity: { possibleSame: 0.7, unlikelySame: 0.3 }
} as const;

export function assertJevImage(image: AnalysisImage): asserts image is AnalysisImage & { mimeType: JevImageMime } {
	const L = JEV_IMAGE_LIMITS;
	if (!(L.mimeTypes as readonly string[]).includes(image.mimeType)) throw new Error(`JEV accepts only PNG or JPEG, got ${image.mimeType}`);
	const { width: w, height: h } = image;
	if (Math.min(w, h) < L.minSide || Math.max(w, h) > L.maxSide) throw new Error(`Image ${w}×${h} is outside ${L.minSide}–${L.maxSide} px per side`);
	if (w * h < L.minPixels || w * h > L.maxPixels) throw new Error(`Image ${w}×${h} is outside the documented pixel range`);
	if (image.bytes.byteLength > L.maxFileBytes) throw new Error('Image is larger than 16 MiB');
}

function toPart(image: AnalysisImage) {
	assertJevImage(image);
	return imagePart(image.mimeType, toBase64(image.bytes));
}

export function createJevProvider(opts: JevProviderOptions): AnalysisProvider {
	const model = opts.model ?? JEV_MODEL;
	const categories = opts.categories ?? DEFAULT_CATEGORIES;
	const presenceThreshold = opts.presenceThreshold ?? DEFAULT_JEV_THRESHOLDS.presenceThreshold;
	const supportedThreshold = opts.supportedThreshold ?? DEFAULT_JEV_THRESHOLDS.supportedThreshold;
	const identity = opts.identity ?? DEFAULT_JEV_THRESHOLDS.identity;
	const newId = opts.newId ?? (() => crypto.randomUUID());

	return {
		id: 'jev',

		async discover(image: AnalysisImage, budget: JobBudget, signal?: AbortSignal): Promise<DiscoveryResult> {
			const part = toPart(image);
			const first = await opts.transport.send(countRequest(model, part, categories), budget, signal);
			const { counts, rejected } = readCounts(first.response, categories);
			let usage = first.usage;
			let durationMs = first.durationMs;

			const repeated = opts.crop ? counts.filter((c) => c.count >= 2) : [];
			const singles = counts.filter((c) => !repeated.includes(c));
			const detections: Detection[] = [];
			const allRejected = [...rejected];
			const locateOpts = { presenceThreshold, supportedThreshold, newId };

			const locate = locateRequest(model, part, singles);
			if (locate) {
				const r = await opts.transport.send(locate, budget, signal);
				usage = addUsage(usage, r.usage);
				durationMs += r.durationMs;
				const located = readLocations(r.response, singles, locateOpts);
				detections.push(...located.detections);
				allRejected.push(...located.rejected);
			}

			if (repeated.length > 0 && opts.crop) {
				const found: Detection[] = [];
				for (const region of STRIPS) {
					const strip = await opts.crop(image, region);
					const req = stripRequest(model, toPart(strip), repeated.map((c: CategoryCount) => c.category))!;
					const r = await opts.transport.send(req, budget, signal);
					usage = addUsage(usage, r.usage);
					durationMs += r.durationMs;
					const s = readStrip(r.response, repeated.map((c) => c.category), region, locateOpts);
					found.push(...s.detections);
					allRejected.push(...s.rejected);
				}
				const merged = mergeStripDetections(found, new Map(repeated.map((c) => [c.category.key, c.count])));
				detections.push(...merged.kept);
				allRejected.push(...merged.dropped);
			}

			return { detections, rejected: allRejected, usage, durationMs };
		},

		async compareIdentity(a: AnalysisImage, b: AnalysisImage, budget: JobBudget, signal?: AbortSignal): Promise<IdentityResult> {
			const { response, usage, durationMs } = await opts.transport.send(identityRequest(model, toPart(a), toPart(b)), budget, signal);
			const r = readIdentity(response, identity);
			// Noul has no confidence field; the yes-probability is not a calibrated identity probability.
			return { outcome: r.outcome, providerConfidence: null, rawScore: r.noul, usage: addUsage(emptyUsage(), usage), durationMs };
		}
	};
}

/** Crops per JEV verification request; keeps each request far below the 32 MiB body limit. */
const VERIFY_BATCH = 24;

/**
 * JEV as a presence verifier for boxes from another detector (combined Phase 0 strategy).
 * `crop` must return padded crops that meet JEV's minimum size.
 */
export function createJevVerifier(opts: {
	transport: JevTransport;
	crop: (image: AnalysisImage, box: Box) => Promise<AnalysisImage>;
	model?: string;
}) {
	const model = opts.model ?? JEV_MODEL;
	return async (image: AnalysisImage, candidates: { label: string; box: Box }[], budget: JobBudget, signal?: AbortSignal) => {
		const scores: (number | null)[] = [];
		let usage = emptyUsage();
		let durationMs = 0;
		for (let start = 0; start < candidates.length; start += VERIFY_BATCH) {
			const batch = candidates.slice(start, start + VERIFY_BATCH);
			const crops = await Promise.all(batch.map(async (c) => ({ label: c.label, part: toPart(await opts.crop(image, c.box)) })));
			const r = await opts.transport.send(verifyCropsRequest(model, crops), budget, signal);
			scores.push(...readVerifyCrops(r.response, batch.length));
			usage = addUsage(usage, r.usage);
			durationMs += r.durationMs;
		}
		return { scores, usage, durationMs };
	};
}
