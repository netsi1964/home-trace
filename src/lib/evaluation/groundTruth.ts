import { z } from 'zod';
import { BoxSchema } from '../geometry/box.ts';

/**
 * Phase 0 fixture ground truth (PRD-SEC-008). One JSON file describes a set of images with
 * manually annotated objects. `objectKey` names a physical object: the same key in two images
 * means the same physical item, which gives the identity pairs for free.
 */

export const GROUND_TRUTH_SCHEMA_VERSION = '1.0.0';

const id = z.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9._-]*$/, 'Use lowercase letters, digits, ".", "_" or "-"');

/** Plain file name inside the fixture folder. No directories, no "..". */
const fileName = z
	.string()
	.min(1)
	.max(200)
	.regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]*\.(jpe?g|png|webp)$/i, 'Use a plain .jpg, .png or .webp file name');

export const ImageCondition = z.enum(['normal', 'poor_light', 'backlit', 'reflections', 'cluttered', 'blur']);

export const AnnotatedObjectSchema = z
	.object({
		objectKey: id,
		label: z.string().min(1).max(80),
		/** Other names a provider may reasonably use, e.g. "mug" for "cup". */
		aliases: z.array(z.string().min(1).max(80)).max(20).default([]),
		category: z.string().min(1).max(80).nullable().default(null),
		box: BoxSchema,
		/** Only `clear` objects are evaluation targets. `partial` ones are neither required nor penalised. */
		visibility: z.enum(['clear', 'partial'])
	})
	.strict();

export const AnnotatedImageSchema = z
	.object({
		id,
		file: fileName,
		width: z.number().int().positive(),
		height: z.number().int().positive(),
		room: z.string().min(1).max(80),
		viewpoint: z.string().min(1).max(80),
		conditions: z.array(ImageCondition).min(1).default(['normal']),
		objects: z.array(AnnotatedObjectSchema).max(200),
		/** Regions known to contain no object. A detection there is a hallucination (T11). */
		emptyRegions: z.array(BoxSchema).max(20).default([])
	})
	.strict();

export const GroundTruthSchema = z
	.object({
		schemaVersion: z.literal(GROUND_TRUTH_SCHEMA_VERSION),
		kind: z.literal('hometrace-phase0-ground-truth'),
		/** True for synthetic or demo fixtures. Results on demo fixtures never represent JEV quality (T24). */
		demo: z.boolean(),
		description: z.string().max(2000).default(''),
		images: z.array(AnnotatedImageSchema).min(1).max(500)
	})
	.strict()
	.superRefine((gt, ctx) => {
		const ids = new Set<string>();
		const files = new Set<string>();
		gt.images.forEach((img, i) => {
			if (ids.has(img.id)) ctx.addIssue({ code: 'custom', path: ['images', i, 'id'], message: `Duplicate image id "${img.id}"` });
			if (files.has(img.file)) ctx.addIssue({ code: 'custom', path: ['images', i, 'file'], message: `Duplicate file "${img.file}"` });
			ids.add(img.id);
			files.add(img.file);
			const keys = new Set<string>();
			img.objects.forEach((o, j) => {
				if (keys.has(o.objectKey)) {
					ctx.addIssue({
						code: 'custom',
						path: ['images', i, 'objects', j, 'objectKey'],
						message: `Object "${o.objectKey}" appears twice in one image; give each physical instance its own key`
					});
				}
				keys.add(o.objectKey);
			});
		});
	});

export type GroundTruth = z.infer<typeof GroundTruthSchema>;
export type AnnotatedImage = z.infer<typeof AnnotatedImageSchema>;
export type AnnotatedObject = z.infer<typeof AnnotatedObjectSchema>;

export type IdentityPair = {
	a: { imageId: string; objectKey: string };
	b: { imageId: string; objectKey: string };
	expectedSame: boolean;
	/** Different objects that share a label, e.g. two identical cups. These are the hard cases. */
	hardNegative: boolean;
};

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Builds identity pairs across images: every same-key pair is a positive, and every
 * different-key pair with the same label is a hard negative. Only `clear` objects are used.
 */
export function identityPairs(gt: GroundTruth): IdentityPair[] {
	const items = gt.images.flatMap((img) =>
		img.objects.filter((o) => o.visibility === 'clear').map((o) => ({ imageId: img.id, o }))
	);
	const pairs: IdentityPair[] = [];
	for (let i = 0; i < items.length; i++) {
		for (let j = i + 1; j < items.length; j++) {
			const x = items[i];
			const y = items[j];
			if (x.imageId === y.imageId) continue;
			const same = x.o.objectKey === y.o.objectKey;
			const sameLabel = norm(x.o.label) === norm(y.o.label);
			if (!same && !sameLabel) continue;
			pairs.push({
				a: { imageId: x.imageId, objectKey: x.o.objectKey },
				b: { imageId: y.imageId, objectKey: y.o.objectKey },
				expectedSame: same,
				hardNegative: !same && sameLabel
			});
		}
	}
	return pairs;
}
