import { z } from 'zod';
import { parseBox, type Box } from '../../geometry/box.ts';

/**
 * Vision-LLM object discovery via OpenRouter Chat Completions. Verified 2026-10-20 against
 * official sources only (see docs/vision-contract.md):
 * - Qwen3-VL 2D grounding cookbook: `{"bbox_2d": [x1, y1, x2, y2], "label": ...}`, relative 0–1000
 * - Gemini image understanding: `box_2d` as [ymin, xmin, ymax, xmax] normalised to 0–1000
 * - OpenRouter structured outputs (`response_format.type = "json_schema"`) and the Chat
 *   Completions image part `{ type: 'image_url', image_url: { url: 'data:…' } }`
 * Output is generated text constrained by a schema. It is validated, never trusted.
 */

export const CHAT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
export const DEFAULT_VISION_MODEL = 'qwen/qwen3-vl-235b-a22b-instruct';

/** Upper bound on detections accepted from one answer; more is treated as a malformed answer. */
export const MAX_DETECTIONS = 60;

export type BoxFormat = {
	/** Field name the model family was trained to emit. */
	key: 'bbox_2d' | 'box_2d';
	/** Order of the four numbers. */
	order: 'xyxy' | 'yxyx';
	/** Sentence that tells the model the format, taken from the family's docs. */
	instruction: string;
};

const QWEN3_VL: BoxFormat = {
	key: 'bbox_2d',
	order: 'xyxy',
	instruction: 'Give each bbox_2d as [x1, y1, x2, y2] in relative coordinates from 0 to 1000.'
};

const GEMINI: BoxFormat = {
	key: 'box_2d',
	order: 'yxyx',
	instruction: 'The box_2d should be [ymin, xmin, ymax, xmax] normalized to 0-1000.'
};

/**
 * Only families with a verified coordinate convention are allowed. Qwen2.5-VL uses absolute
 * pixels instead, so it is deliberately not matched.
 */
export function boxFormatFor(model: string): BoxFormat {
	if (/^qwen\/qwen3-vl-/.test(model)) return QWEN3_VL;
	if (/^~?google\/gemini-/.test(model)) return GEMINI;
	throw new Error(`No verified box format for "${model}". Supported: qwen/qwen3-vl-*, google/gemini-*`);
}

export type ChatContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export type ChatRequest = {
	model: string;
	messages: { role: 'system' | 'user'; content: string | ChatContentPart[] }[];
	response_format: { type: 'json_schema'; json_schema: { name: string; strict: boolean; schema: unknown } };
	temperature: number;
};

export function discoveryPrompt(format: BoxFormat): string {
	return [
		'You are labelling a photo of part of a room in a home for a personal inventory.',
		'List every distinct physical object that is clearly visible: furniture, lamps, electronics, decorations, plants, books, dishes and similar movable belongings.',
		'Give each individual item its own entry: two identical cups are two entries with two boxes.',
		'Leave out walls, floor, ceiling, windows, doors, built-in fixtures and anything you can only guess at.',
		'Use a short, lowercase English name for each label, without colours or positions.',
		format.instruction
	].join('\n');
}

export function discoveryRequest(model: string, imageDataUrl: string): ChatRequest {
	const format = boxFormatFor(model);
	return {
		model,
		messages: [
			{
				role: 'user',
				content: [
					{ type: 'text', text: discoveryPrompt(format) },
					{ type: 'image_url', image_url: { url: imageDataUrl } }
				]
			}
		],
		response_format: {
			type: 'json_schema',
			json_schema: {
				name: 'detections',
				strict: true,
				schema: {
					type: 'object',
					properties: {
						objects: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									label: { type: 'string' },
									[format.key]: { type: 'array', items: { type: 'number' } }
								},
								required: ['label', format.key],
								additionalProperties: false
							}
						}
					},
					required: ['objects'],
					additionalProperties: false
				}
			}
		},
		temperature: 0
	};
}

export function identityRequest(model: string, earlierDataUrl: string, laterDataUrl: string): ChatRequest {
	return {
		model,
		messages: [
			{
				role: 'user',
				content: [
					{ type: 'text', text: 'Crop A, from an earlier photo:' },
					{ type: 'image_url', image_url: { url: earlierDataUrl } },
					{ type: 'text', text: 'Crop B, from a later photo:' },
					{ type: 'image_url', image_url: { url: laterDataUrl } },
					{
						type: 'text',
						text: 'Do crop A and crop B show the same individual physical object, not merely two similar or identical-looking objects? Answer "unsure" unless a distinguishing detail decides it.'
					}
				]
			}
		],
		response_format: {
			type: 'json_schema',
			json_schema: {
				name: 'identity',
				strict: true,
				schema: {
					type: 'object',
					properties: { answer: { type: 'string', enum: ['same', 'different', 'unsure'] } },
					required: ['answer'],
					additionalProperties: false
				}
			}
		},
		temperature: 0
	};
}

export const ChatResponseSchema = z.object({
	id: z.string().optional(),
	model: z.string().optional(),
	choices: z
		.array(z.object({ message: z.object({ content: z.string().nullable() }), finish_reason: z.string().nullable().optional() }))
		.min(1),
	usage: z
		.object({
			prompt_tokens: z.number().nonnegative().optional(),
			completion_tokens: z.number().nonnegative().optional(),
			cost: z.number().nonnegative().optional()
		})
		.optional()
});

export type ChatResponse = z.infer<typeof ChatResponseSchema>;

const coord = z.number().finite();

/**
 * Reads the discovery answer and converts it to normalised boxes. Invalid entries are
 * rejected one by one, never repaired.
 */
export function readDiscovery(
	content: string | null,
	format: BoxFormat
): { objects: { label: string; box: Box }[]; rejected: { reason: string; raw: string }[] } {
	const rejected: { reason: string; raw: string }[] = [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(stripFences(content ?? ''));
	} catch {
		return { objects: [], rejected: [{ reason: 'answer: not JSON', raw: (content ?? '').slice(0, 300) }] };
	}
	const list = z.object({ objects: z.array(z.unknown()) }).safeParse(parsed);
	if (!list.success) return { objects: [], rejected: [{ reason: 'answer: no objects array', raw: JSON.stringify(parsed).slice(0, 300) }] };
	if (list.data.objects.length > MAX_DETECTIONS) {
		return { objects: [], rejected: [{ reason: `answer: more than ${MAX_DETECTIONS} objects`, raw: String(list.data.objects.length) }] };
	}

	const entry = z.object({ label: z.string().trim().min(1).max(80), [format.key]: z.array(coord).length(4) });
	const objects: { label: string; box: Box }[] = [];
	for (const raw of list.data.objects) {
		const e = entry.safeParse(raw);
		if (!e.success) {
			rejected.push({ reason: 'box: malformed entry', raw: JSON.stringify(raw).slice(0, 300) });
			continue;
		}
		const nums = e.data[format.key] as number[];
		const [x1, y1, x2, y2] = format.order === 'xyxy' ? nums : [nums[1], nums[0], nums[3], nums[2]];
		const box =
			[x1, y1, x2, y2].every((v) => v >= 0 && v <= 1000) && x1 < x2 && y1 < y2
				? parseBox({ x: x1 / 1000, y: y1 / 1000, width: (x2 - x1) / 1000, height: (y2 - y1) / 1000 })
				: null;
		if (!box) {
			rejected.push({ reason: 'box: invalid coordinates', raw: JSON.stringify(raw).slice(0, 300) });
			continue;
		}
		objects.push({ label: (e.data.label as string).toLowerCase(), box });
	}
	return { objects, rejected };
}

export function readIdentityAnswer(content: string | null): 'same' | 'different' | 'unsure' | null {
	try {
		const r = z.object({ answer: z.enum(['same', 'different', 'unsure']) }).safeParse(JSON.parse(stripFences(content ?? '')));
		return r.success ? r.data.answer : null;
	} catch {
		return null;
	}
}

/** Some models wrap JSON in a Markdown code fence even with structured outputs. */
function stripFences(s: string): string {
	return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

/** Strips image data from a request so it can be logged (PRD-SEC-007). */
export function redactChatRequest(req: ChatRequest): unknown {
	return {
		...req,
		messages: req.messages.map((m) => ({
			...m,
			content: typeof m.content === 'string' ? m.content : m.content.map((p) => (p.type === 'image_url' ? { type: 'image_url', image_url: { url: '[image redacted]' } } : p))
		}))
	};
}
