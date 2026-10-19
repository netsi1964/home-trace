import { z } from 'zod';
import { parseBox, type Box } from '../../geometry/box.ts';

/**
 * JEV via the OpenRouter Decisions API. Verified 2026-10-19 against official docs only:
 * - https://openrouter.ai/docs/guides/community/jev (Box questions, model IDs, endpoints)
 * - https://openrouter.ai/docs/guides/community/multimodal-decisions (image part format, limits)
 * - https://docs.typesafe.ai/primitives/box (edges, no "not found" answer, one box per question)
 * See docs/jev-contract.md. Images and Box are a TypeSafe preview: the format can change.
 */

export const JEV_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
/** Pinned. `~typesafe/jev-latest` moves; Box needs 1.14 and 1.13 rejects it with a 400. */
export const JEV_MODEL = 'typesafe/jev-1.14';

/** Image limits from the docs. OpenRouter states 256 px min side, TypeSafe 280 px: use the stricter one. */
export const JEV_IMAGE_LIMITS = {
	minSide: 280,
	maxSide: 1568,
	minPixels: 78_400,
	maxPixels: 2_458_624,
	maxFileBytes: 16 * 1024 * 1024,
	mimeTypes: ['image/jpeg', 'image/png'] as const
};

export type JevImageMime = (typeof JEV_IMAGE_LIMITS.mimeTypes)[number];

export type ImagePart = { type: 'image_url'; image_url: { url: string } };
export type StateItem = string | ImagePart;

export type ChoiceQuestion = { type: 'choice'; instructions: string; criteria: Record<string, string | null> };
export type NoulQuestion = { type: 'noul'; instructions: string };
export type BoxQuestion = { type: 'box'; instructions: string };
export type Question = ChoiceQuestion | NoulQuestion | BoxQuestion;

export type DecisionsRequest = {
	model: string;
	state: StateItem[];
	questions: Record<string, Question>;
};

export function imagePart(mime: JevImageMime, base64: string): ImagePart {
	return { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } };
}

// Response shapes, as documented. Unknown extra fields are allowed so additive API changes don't break parsing.

const unit = z.number().finite().min(0).max(1);

export const BoxAnswerSchema = z.object({
	type: z.literal('box'),
	box: z.object({ top: unit, bottom: unit, left: unit, right: unit }),
	confidence: unit.nullable().optional()
});

export const NoulAnswerSchema = z.object({ type: z.literal('noul'), noul: unit });

export const ChoiceAnswerSchema = z.object({
	type: z.literal('choice'),
	choice: z.string(),
	probabilities: z.record(z.string(), unit),
	confidence: unit.nullable().optional()
});

export const AnswerSchema = z.discriminatedUnion('type', [BoxAnswerSchema, NoulAnswerSchema, ChoiceAnswerSchema]);

export const DecisionsResponseSchema = z.object({
	model: z.string().optional(),
	answers: z.record(z.string(), z.unknown()),
	usage: z
		.object({
			input_tokens: z.number().nonnegative().optional(),
			output_tokens: z.number().nonnegative().optional(),
			cost: z.number().nonnegative().optional()
		})
		.optional(),
	id: z.string().optional(),
	provider: z.string().optional()
});

export type DecisionsResponse = z.infer<typeof DecisionsResponseSchema>;
export type BoxAnswer = z.infer<typeof BoxAnswerSchema>;
export type NoulAnswer = z.infer<typeof NoulAnswerSchema>;
export type ChoiceAnswer = z.infer<typeof ChoiceAnswerSchema>;

export type ParsedAnswer<T> = { ok: true; value: T } | { ok: false; reason: string };

function parseAnswer<T>(schema: z.ZodType<T>, raw: unknown): ParsedAnswer<T> {
	if (raw === undefined) return { ok: false, reason: 'missing answer' };
	const r = schema.safeParse(raw);
	return r.success ? { ok: true, value: r.data } : { ok: false, reason: r.error.issues[0]?.message ?? 'invalid answer' };
}

export const readBox = (raw: unknown) => parseAnswer(BoxAnswerSchema, raw);
export const readNoul = (raw: unknown) => parseAnswer(NoulAnswerSchema, raw);
export const readChoice = (raw: unknown) => parseAnswer(ChoiceAnswerSchema, raw);

/**
 * Converts JEV edges to the app's x/y/width/height box. Returns null for degenerate or
 * out-of-range edges; invalid provider coordinates are rejected, never repaired.
 */
export function edgesToBox(edges: BoxAnswer['box']): Box | null {
	if (!(edges.left < edges.right && edges.top < edges.bottom)) return null;
	return parseBox({ x: edges.left, y: edges.top, width: edges.right - edges.left, height: edges.bottom - edges.top });
}

/** Strips image data from a request so it can be logged (PRD-SEC-007: no base64 in logs). */
export function redactRequest(req: DecisionsRequest): unknown {
	return {
		...req,
		state: req.state.map((s) => (typeof s === 'string' ? s : { type: 'image_url', image_url: { url: '[image redacted]' } }))
	};
}
