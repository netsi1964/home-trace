import type { AnnotatedImage, IdentityPair } from '../../src/lib/evaluation/groundTruth.ts';
import type { AnalysisImage, AnalysisProvider, Detection } from '../../src/lib/providers/types.ts';
import { parseBox } from '../../src/lib/geometry/box.ts';

/**
 * Demo provider for exercising the evaluation pipeline without paid requests. It derives
 * detections from ground truth with deterministic jitter, one miss and one false box per image.
 * Its numbers say nothing about JEV (T24); every result is labelled Demo.
 */
export function createDemoProvider(lookup: {
	frame: (image: AnalysisImage) => AnnotatedImage | undefined;
	crop: (image: AnalysisImage) => IdentityPair['a'] | undefined;
}): AnalysisProvider {
	let n = 0;
	return {
		id: 'demo',

		async discover(image, budget) {
			budget.spend();
			const gt = lookup.frame(image);
			if (!gt) throw new Error('Demo provider only works on loaded fixtures');
			const rand = seeded(gt.id);
			const targets = gt.objects.filter((o) => o.visibility === 'clear');
			const detections: Detection[] = targets
				.filter((_, i) => i !== targets.length - 1) // miss the last target
				.flatMap((o) => {
					const j = () => (rand() - 0.5) * 0.04;
					const box = parseBox({
						x: clamp(o.box.x + j(), 0, 1 - o.box.width),
						y: clamp(o.box.y + j(), 0, 1 - o.box.height),
						width: o.box.width,
						height: o.box.height
					});
					return box ? [demoDetection(`demo-${++n}`, o.label, box)] : [];
				});
			detections.push(demoDetection(`demo-${++n}`, 'unknown object', { x: 0.02, y: 0.02, width: 0.1, height: 0.1 }));
			return {
				detections,
				rejected: [],
				usage: { requests: 1, inputTokens: null, outputTokens: null, reportedCost: null },
				durationMs: 0
			};
		},

		async compareIdentity(a, b, budget) {
			budget.spend();
			const ra = lookup.crop(a);
			const rb = lookup.crop(b);
			if (!ra || !rb) throw new Error('Demo provider only works on fixture crops');
			// Correct on distinct keys, deliberately uncertain on same-label lookalikes.
			const same = ra.objectKey === rb.objectKey;
			return {
				outcome: same ? 'possible_same' : 'uncertain',
				providerConfidence: null,
				rawScore: null,
				usage: { requests: 1, inputTokens: null, outputTokens: null, reportedCost: null },
				durationMs: 0
			};
		}
	};
}

function demoDetection(id: string, label: string, box: Detection['box']): Detection {
	return { id, label, category: null, box, source: 'demo', providerConfidence: null, presence: 'supported' };
}

function clamp(v: number, lo: number, hi: number) {
	return Math.min(hi, Math.max(lo, v));
}

/** Small deterministic PRNG so demo runs are reproducible. */
function seeded(seed: string): () => number {
	let h = 2166136261;
	for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
	return () => {
		h = Math.imul(h ^ (h >>> 15), 2246822507);
		h = Math.imul(h ^ (h >>> 13), 3266489909);
		return ((h ^= h >>> 16) >>> 0) / 4294967296;
	};
}
