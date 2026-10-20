import { z } from 'zod';
import { BoxSchema } from '../geometry/box.ts';

/**
 * Conceptual data model (PRD-SEC-005). Stable UUIDs, UTC ISO 8601 timestamps, metadata
 * separate from image bytes. The same schemas validate storage, imports and tests.
 */

export const SCHEMA_VERSION = '1.0.0';
export const APP_VERSION = '0.2.0';

const id = z.string().uuid();
const ts = z.string().datetime({ offset: true });
const text = (max: number) => z.string().max(max);

export const ScanStatus = z.enum(['draft', 'analyzing', 'review', 'complete', 'failed', 'cancelled']);
export const ScanMode = z.enum(['register', 'compare']);
export const Resolution = z.enum(['unresolved', 'linked', 'created', 'ignored']);
export const IdentityState = z.enum(['confirmed', 'rejected', 'unresolved']);
export const VisibilityState = z.enum(['found', 'not_rediscovered', 'uncertain']);
export const MovementState = z.enum(['no_change_detected', 'possibly_moved', 'confirmed_moved', 'unknown']);
export const ObservationSource = z.enum(['jev', 'vision', 'manual', 'demo']);

export const HomeSchema = z.object({ id, name: text(80).min(1), createdAt: ts, lastExportedAt: ts.nullable() }).strict();

export const RoomSchema = z.object({ id, homeId: id, name: text(80).min(1), createdAt: ts }).strict();

export const ViewpointSchema = z
	.object({ id, roomId: id, name: text(80).min(1), referenceScanId: id.nullable(), createdAt: ts })
	.strict();

export const ScanSchema = z
	.object({
		id,
		viewpointId: id,
		capturedAt: ts,
		mode: ScanMode,
		imageAssetId: id,
		/** The reference selected for this scan; kept even if the viewpoint's reference changes later. */
		referenceScanId: id.nullable(),
		status: ScanStatus,
		/** User flag: the images cannot reasonably be compared (PRD-FEAT-005). */
		uncertainViewpoint: z.boolean(),
		/** Demo scans are always labelled Demo (T24). */
		demo: z.boolean()
	})
	.strict();

export const AssetSchema = z
	.object({
		id,
		path: z.string().regex(/^assets\/[0-9a-f-]{36}\.(jpg|png)$/),
		mimeType: z.enum(['image/jpeg', 'image/png']),
		width: z.number().int().positive(),
		height: z.number().int().positive(),
		byteLength: z.number().int().positive(),
		sha256: z.string().regex(/^[0-9a-f]{64}$/)
	})
	.strict();

export const InventoryObjectSchema = z
	.object({
		id,
		homeId: id,
		name: text(80).min(1),
		category: text(80).nullable(),
		notes: text(2000),
		createdAt: ts,
		/** Set when merged into another object; history is preserved. */
		mergedIntoId: id.nullable()
	})
	.strict();

export const ObservationSchema = z
	.object({
		id,
		scanId: id,
		/** null while unresolved (invariant 1). */
		objectId: id.nullable(),
		box: BoxSchema,
		cropAssetId: id.nullable(),
		label: text(80).min(1),
		source: ObservationSource,
		resolution: Resolution,
		providerConfidence: z.number().min(0).max(1).nullable(),
		presence: z.enum(['supported', 'uncertain'])
	})
	.strict();

export const MatchDecisionSchema = z
	.object({
		id,
		observationId: id,
		candidateObjectId: id.nullable(),
		answer: z.enum(['yes', 'no', 'skip', 'new']),
		decidedAt: ts
	})
	.strict();

export const ComparisonItemSchema = z
	.object({
		id,
		scanId: id,
		baselineObservationId: id,
		currentObservationId: id.nullable(),
		identityState: IdentityState,
		visibilityState: VisibilityState,
		movementState: MovementState,
		reviewedAt: ts.nullable()
	})
	.strict();

export const AnalysisJobSchema = z
	.object({
		id,
		scanId: id,
		provider: z.enum(['demo', 'jev', 'vision', 'vision-jev']),
		model: text(200).nullable(),
		status: z.enum(['pending', 'running', 'done', 'failed', 'cancelled']),
		callCount: z.number().int().nonnegative(),
		usage: z
			.object({
				inputTokens: z.number().nonnegative().nullable(),
				outputTokens: z.number().nonnegative().nullable(),
				reportedCost: z.number().nonnegative().nullable()
			})
			.strict(),
		startedAt: ts,
		finishedAt: ts.nullable(),
		/** Technical message only. Never image data or secrets. */
		error: text(500).nullable()
	})
	.strict();

export const ReviewEventSchema = z
	.object({
		id,
		entityType: z.enum(['observation', 'object', 'viewpoint', 'comparison']),
		entityId: id,
		action: z.enum(['link', 'unlink', 'create', 'merge', 'rename', 'note', 'reference', 'movement', 'dismiss', 'restore']),
		/** JSON snapshot of the affected records before the change, for undo. */
		previousValue: z.unknown(),
		createdAt: ts,
		undoneAt: ts.nullable()
	})
	.strict();

export type Home = z.infer<typeof HomeSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type Viewpoint = z.infer<typeof ViewpointSchema>;
export type Scan = z.infer<typeof ScanSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type InventoryObject = z.infer<typeof InventoryObjectSchema>;
export type Observation = z.infer<typeof ObservationSchema>;
export type MatchDecision = z.infer<typeof MatchDecisionSchema>;
export type ComparisonItem = z.infer<typeof ComparisonItemSchema>;
export type AnalysisJob = z.infer<typeof AnalysisJobSchema>;
export type ReviewEvent = z.infer<typeof ReviewEventSchema>;

/** One home's metadata, as held in memory, stored in IndexedDB and exported as inventory.json. */
export const HomeDataSchema = z
	.object({
		schemaVersion: z.literal(SCHEMA_VERSION),
		home: HomeSchema,
		rooms: z.array(RoomSchema),
		viewpoints: z.array(ViewpointSchema),
		scans: z.array(ScanSchema),
		assets: z.array(AssetSchema),
		objects: z.array(InventoryObjectSchema),
		observations: z.array(ObservationSchema),
		matchDecisions: z.array(MatchDecisionSchema),
		comparisonItems: z.array(ComparisonItemSchema),
		analysisJobs: z.array(AnalysisJobSchema),
		reviewEvents: z.array(ReviewEventSchema)
	})
	.strict();

export type HomeData = z.infer<typeof HomeDataSchema>;

export const COLLECTIONS = [
	'rooms',
	'viewpoints',
	'scans',
	'assets',
	'objects',
	'observations',
	'matchDecisions',
	'comparisonItems',
	'analysisJobs',
	'reviewEvents'
] as const;
export type Collection = (typeof COLLECTIONS)[number];

export type EntityOf<C extends Collection> = HomeData[C][number];

export const newId = (): string => crypto.randomUUID();
let lastNow = 0;
/** Strictly increasing UTC timestamps, so events created in the same millisecond still have an order. */
export const now = (): string => {
	lastNow = Math.max(Date.now(), lastNow + 1);
	return new Date(lastNow).toISOString();
};

export function emptyHome(name = 'My home'): HomeData {
	return {
		schemaVersion: SCHEMA_VERSION,
		home: { id: newId(), name, createdAt: now(), lastExportedAt: null },
		rooms: [],
		viewpoints: [],
		scans: [],
		assets: [],
		objects: [],
		observations: [],
		matchDecisions: [],
		comparisonItems: [],
		analysisJobs: [],
		reviewEvents: []
	};
}

/**
 * Referential integrity and data invariants (PRD-SEC-005). Returns readable problems; an
 * empty list means the data is consistent. Used before every import.
 */
export function checkIntegrity(d: HomeData): string[] {
	const problems: string[] = [];
	const ids = (xs: { id: string }[]) => new Set(xs.map((x) => x.id));
	const rooms = ids(d.rooms);
	const viewpoints = ids(d.viewpoints);
	const scans = ids(d.scans);
	const assets = ids(d.assets);
	const objects = ids(d.objects);
	const observations = ids(d.observations);

	const unique = (name: string, xs: { id: string }[]) => {
		if (new Set(xs.map((x) => x.id)).size !== xs.length) problems.push(`${name}: duplicate ids`);
	};
	for (const c of COLLECTIONS) unique(c, d[c]);

	for (const r of d.rooms) if (r.homeId !== d.home.id) problems.push(`room ${r.id}: wrong home`);
	for (const v of d.viewpoints) {
		if (!rooms.has(v.roomId)) problems.push(`viewpoint ${v.id}: missing room`);
		if (v.referenceScanId && !scans.has(v.referenceScanId)) problems.push(`viewpoint ${v.id}: missing reference scan`);
	}
	for (const s of d.scans) {
		if (!viewpoints.has(s.viewpointId)) problems.push(`scan ${s.id}: missing viewpoint`);
		if (!assets.has(s.imageAssetId)) problems.push(`scan ${s.id}: missing image asset`);
		if (s.referenceScanId && !scans.has(s.referenceScanId)) problems.push(`scan ${s.id}: missing reference scan`);
	}
	for (const o of d.objects) {
		if (o.homeId !== d.home.id) problems.push(`object ${o.id}: wrong home`);
		if (o.mergedIntoId && !objects.has(o.mergedIntoId)) problems.push(`object ${o.id}: merged into missing object`);
		if (o.mergedIntoId === o.id) problems.push(`object ${o.id}: merged into itself`);
	}
	for (const o of d.observations) {
		if (!scans.has(o.scanId)) problems.push(`observation ${o.id}: missing scan`);
		if (o.objectId && !objects.has(o.objectId)) problems.push(`observation ${o.id}: missing object`);
		if (o.cropAssetId && !assets.has(o.cropAssetId)) problems.push(`observation ${o.id}: missing crop asset`);
		const linked = o.resolution === 'linked' || o.resolution === 'created';
		if (linked !== (o.objectId !== null)) problems.push(`observation ${o.id}: resolution does not match object link`);
	}
	for (const m of d.matchDecisions) {
		if (!observations.has(m.observationId)) problems.push(`decision ${m.id}: missing observation`);
		if (m.candidateObjectId && !objects.has(m.candidateObjectId)) problems.push(`decision ${m.id}: missing object`);
	}
	for (const c of d.comparisonItems) {
		if (!scans.has(c.scanId)) problems.push(`comparison ${c.id}: missing scan`);
		if (!observations.has(c.baselineObservationId)) problems.push(`comparison ${c.id}: missing baseline observation`);
		if (c.currentObservationId && !observations.has(c.currentObservationId)) problems.push(`comparison ${c.id}: missing current observation`);
	}
	for (const j of d.analysisJobs) if (!scans.has(j.scanId)) problems.push(`job ${j.id}: missing scan`);
	return problems;
}
