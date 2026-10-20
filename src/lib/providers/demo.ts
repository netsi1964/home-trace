import gt from '../../../fixtures/demo/groundtruth.json';
import { GroundTruthSchema } from '../evaluation/groundTruth.ts';
import type { Detection } from './types.ts';

/**
 * Client-side Demo provider (PRD-SEC-008 Phase 1, T24). It only "detects" objects on the
 * bundled Demo drawings, using their ground truth with a small deterministic offset and one
 * missed item, so the review and identity flow can be tried without AI. On any other photo it
 * returns nothing: objects are then marked manually. Everything it produces is labelled Demo.
 */

export const DEMO_FIXTURES = GroundTruthSchema.parse(gt);

const urls = import.meta.glob('../../../fixtures/demo/*.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export function demoImageUrl(fixtureId: string): string | undefined {
	const img = DEMO_FIXTURES.images.find((i) => i.id === fixtureId);
	return img ? Object.entries(urls).find(([path]) => path.endsWith(`/${img.file}`))?.[1] : undefined;
}

export function demoPhotos(): { id: string; room: string; viewpoint: string; url: string }[] {
	return DEMO_FIXTURES.images.flatMap((i) => {
		const url = demoImageUrl(i.id);
		return url ? [{ id: i.id, room: i.room, viewpoint: i.viewpoint, url }] : [];
	});
}

export function demoDetections(fixtureId: string | null): Detection[] {
	const img = DEMO_FIXTURES.images.find((i) => i.id === fixtureId);
	if (!img) return [];
	const visible = img.objects.filter((o) => o.visibility === 'clear');
	return visible.slice(0, Math.max(0, visible.length - 1)).map((o, i) => ({
		id: crypto.randomUUID(),
		label: o.label,
		category: o.category,
		box: {
			x: Math.min(1 - o.box.width, Math.max(0, o.box.x + (i % 2 ? 0.005 : -0.005))),
			y: o.box.y,
			width: o.box.width,
			height: o.box.height
		},
		source: 'demo',
		providerConfidence: null,
		presence: 'supported'
	}));
}
