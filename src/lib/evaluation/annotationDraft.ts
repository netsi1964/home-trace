import type { Box } from '../geometry/box.ts';
import {
	GROUND_TRUTH_SCHEMA_VERSION,
	GroundTruthSchema,
	type GroundTruth,
	type ImageCondition
} from './groundTruth.ts';
import type { z } from 'zod';

/**
 * Editable annotation state for the Phase 0 annotation tool. Holds no image data: photos stay
 * as local object URLs in the page and are matched back to the draft by file name.
 */

export type Condition = z.infer<typeof ImageCondition>;
export const CONDITIONS: Condition[] = ['normal', 'poor_light', 'backlit', 'reflections', 'cluttered', 'blur'];

export type DraftObject = {
	objectKey: string;
	label: string;
	aliasesText: string;
	visibility: 'clear' | 'partial';
	box: Box;
};

export type DraftImage = {
	id: string;
	file: string;
	width: number;
	height: number;
	room: string;
	viewpoint: string;
	conditions: Condition[];
	objects: DraftObject[];
	emptyRegions: Box[];
};

export type Draft = { description: string; demo: boolean; images: DraftImage[] };

export const emptyDraft = (): Draft => ({ description: '', demo: false, images: [] });

export function slug(s: string): string {
	return (
		s
			.toLowerCase()
			.normalize('NFKD')
			.replace(/[̀-ͯ]/g, '')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 60) || 'item'
	);
}

export function imageIdFor(file: string, taken: Set<string>): string {
	const base = slug(file.replace(/\.[^.]+$/, ''));
	let id = base;
	for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
	return id;
}

/** All object keys used anywhere in the draft, with the label they were first given. */
export function knownKeys(draft: Draft): Map<string, string> {
	const keys = new Map<string, string>();
	for (const img of draft.images) for (const o of img.objects) if (!keys.has(o.objectKey)) keys.set(o.objectKey, o.label);
	return keys;
}

/** Next free key for a label, unique across the whole draft, e.g. "cup-3". */
export function nextKey(draft: Draft, label: string): string {
	const base = slug(label);
	const used = knownKeys(draft);
	let n = 1;
	while (used.has(`${base}-${n}`)) n++;
	return `${base}-${n}`;
}

const round = (v: number) => Math.round(v * 10_000) / 10_000;

/** Turns two drag points into a normalised box inside the frame, or null when too small. */
export function boxFromDrag(a: { x: number; y: number }, b: { x: number; y: number }, min = 0.01): Box | null {
	const clamp = (v: number) => Math.min(1, Math.max(0, v));
	const x0 = clamp(Math.min(a.x, b.x));
	const y0 = clamp(Math.min(a.y, b.y));
	const x1 = clamp(Math.max(a.x, b.x));
	const y1 = clamp(Math.max(a.y, b.y));
	if (x1 - x0 < min || y1 - y0 < min) return null;
	return { x: round(x0), y: round(y0), width: round(x1 - x0), height: round(y1 - y0) };
}

export function toGroundTruth(draft: Draft): { ok: true; value: GroundTruth } | { ok: false; issues: string[] } {
	const candidate = {
		schemaVersion: GROUND_TRUTH_SCHEMA_VERSION,
		kind: 'hometrace-phase0-ground-truth',
		demo: draft.demo,
		description: draft.description.trim(),
		images: draft.images.map((img) => ({
			id: img.id,
			file: img.file,
			width: img.width,
			height: img.height,
			room: img.room.trim(),
			viewpoint: img.viewpoint.trim(),
			conditions: img.conditions.length ? img.conditions : ['normal'],
			objects: img.objects.map((o) => ({
				objectKey: o.objectKey.trim(),
				label: o.label.trim(),
				aliases: o.aliasesText
					.split(',')
					.map((a) => a.trim())
					.filter(Boolean),
				category: null,
				box: o.box,
				visibility: o.visibility
			})),
			emptyRegions: img.emptyRegions
		}))
	};
	const r = GroundTruthSchema.safeParse(candidate);
	if (r.success) return { ok: true, value: r.data };
	return {
		ok: false,
		issues: r.error.issues.map((i) => {
			const [, idx, ...rest] = i.path;
			const img = typeof idx === 'number' ? draft.images[idx] : undefined;
			return `${img ? `${img.file}: ` : ''}${rest.join('.') || i.path.join('.')} — ${i.message}`;
		})
	};
}

export function fromGroundTruth(gt: GroundTruth): Draft {
	return {
		description: gt.description,
		demo: gt.demo,
		images: gt.images.map((img) => ({
			id: img.id,
			file: img.file,
			width: img.width,
			height: img.height,
			room: img.room,
			viewpoint: img.viewpoint,
			conditions: img.conditions,
			objects: img.objects.map((o) => ({
				objectKey: o.objectKey,
				label: o.label,
				aliasesText: o.aliases.join(', '),
				visibility: o.visibility,
				box: o.box
			})),
			emptyRegions: img.emptyRegions
		}))
	};
}

export function stats(draft: Draft): { photos: number; boxes: number; objects: number } {
	return {
		photos: draft.images.length,
		boxes: draft.images.reduce((n, i) => n + i.objects.length, 0),
		objects: knownKeys(draft).size
	};
}
