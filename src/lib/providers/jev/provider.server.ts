import type { AnalysisImage, AnalysisProvider, DiscoveryResult, IdentityResult, JobBudget } from '../types.ts';
import { imagePart, JEV_IMAGE_LIMITS, JEV_MODEL, type JevImageMime } from './contract.ts';
import {
	countRequest,
	DEFAULT_CATEGORIES,
	identityRequest,
	locateRequest,
	readCounts,
	readIdentity,
	readLocations,
	type Category,
	type IdentityThresholds
} from './discovery.ts';
import { addUsage, emptyUsage, type JevTransport } from './jev.server.ts';

export type JevProviderOptions = {
	transport: JevTransport;
	model?: string;
	categories?: Category[];
	presenceThreshold?: number;
	supportedThreshold?: number;
	identity?: IdentityThresholds;
	newId?: () => string;
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
	return imagePart(image.mimeType, Buffer.from(image.bytes).toString('base64'));
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

			const locate = locateRequest(model, part, counts);
			if (!locate) return { detections: [], rejected, usage, durationMs };

			const second = await opts.transport.send(locate, budget, signal);
			usage = addUsage(usage, second.usage);
			durationMs += second.durationMs;
			const located = readLocations(second.response, counts, { presenceThreshold, supportedThreshold, newId });
			return { detections: located.detections, rejected: [...rejected, ...located.rejected], usage, durationMs };
		},

		async compareIdentity(a: AnalysisImage, b: AnalysisImage, budget: JobBudget, signal?: AbortSignal): Promise<IdentityResult> {
			const { response, usage, durationMs } = await opts.transport.send(identityRequest(model, toPart(a), toPart(b)), budget, signal);
			const r = readIdentity(response, identity);
			// Noul has no confidence field; the yes-probability is not a calibrated identity probability.
			return { outcome: r.outcome, providerConfidence: null, rawScore: r.noul, usage: addUsage(emptyUsage(), usage), durationMs };
		}
	};
}
