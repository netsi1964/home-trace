import { z } from 'zod';

/**
 * Axis-aligned box normalised to 0..1 in the correctly oriented captured frame.
 * Origin is the top-left corner. Never a 3D position (AGENTS.md design rule 3).
 */
export type Box = { x: number; y: number; width: number; height: number };

const unit = z.number().finite().min(0).max(1);

export const BoxSchema = z
	.object({ x: unit, y: unit, width: unit, height: unit })
	.strict()
	.refine((b) => b.width > 0 && b.height > 0, 'Box must have a positive area')
	.refine((b) => b.x + b.width <= 1 + 1e-9 && b.y + b.height <= 1 + 1e-9, 'Box must stay inside the frame');

/** Returns the box if it is valid, otherwise null. Invalid provider coordinates are rejected, never clamped. */
export function parseBox(value: unknown): Box | null {
	const result = BoxSchema.safeParse(value);
	return result.success ? result.data : null;
}

/** Converts a pixel-space box to normalised coordinates for a frame of the given size. */
export function normaliseBox(
	px: { x: number; y: number; width: number; height: number },
	frame: { width: number; height: number }
): Box {
	return {
		x: px.x / frame.width,
		y: px.y / frame.height,
		width: px.width / frame.width,
		height: px.height / frame.height
	};
}

export function area(b: Box): number {
	return b.width * b.height;
}

/** Intersection over union of two boxes. */
export function iou(a: Box, b: Box): number {
	const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
	const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
	const inter = ix * iy;
	const union = area(a) + area(b) - inter;
	return union > 0 ? inter / union : 0;
}
