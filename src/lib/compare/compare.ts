import { iou, type Box } from '../geometry/box.ts';
import { newId, now, type ComparisonItem, type HomeData, type Observation, type ReviewEvent } from '../inventory/model.ts';
import { mergeMutations, snapshotFor, type Mutation } from '../inventory/mutation.ts';
import { canonicalId, observationsOfScan, scanById } from '../inventory/queries.ts';

/**
 * Comparison with a selected reference scan (PRD-FEAT-006). Identity, visibility and movement
 * are independent states (PRD-SEC-005). A changed 2D box can at most suggest "possibly moved";
 * only the user confirms movement. Not rediscovered never means removed.
 */

/** Box change that makes movement worth reviewing. Tunable; never a proof of movement. */
export const MOVE_HINT = { minCentreShift: 0.08, maxIou: 0.4 } as const;

export type DisplayStatus =
	| 'found_no_change'
	| 'possibly_moved'
	| 'moved_confirmed'
	| 'new_to_inventory'
	| 'not_rediscovered'
	| 'unresolved';

export const STATUS_ICON: Record<DisplayStatus, string> = {
	found_no_change: '✓',
	possibly_moved: '↔?',
	moved_confirmed: '↔',
	new_to_inventory: '＋',
	not_rediscovered: '◌',
	unresolved: '?'
};

function centre(b: Box) {
	return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

export function boxSuggestsMove(a: Box, b: Box): boolean {
	const ca = centre(a);
	const cb = centre(b);
	const shift = Math.hypot(ca.x - cb.x, ca.y - cb.y);
	return shift >= MOVE_HINT.minCentreShift || iou(a, b) <= MOVE_HINT.maxIou;
}

const active = (o: Observation) => o.resolution !== 'ignored';

/**
 * Derives the comparison items for a compare scan. Items the user already reviewed keep their
 * movement decision. Ids are stable per (scan, baseline observation).
 */
export function deriveComparison(d: HomeData, currentScanId: string): ComparisonItem[] {
	const scan = scanById(d, currentScanId);
	if (!scan || scan.mode !== 'compare' || !scan.referenceScanId) return [];
	const baseline = observationsOfScan(d, scan.referenceScanId).filter(active);
	const current = observationsOfScan(d, scan.id).filter(active);
	const existing = new Map(d.comparisonItems.filter((c) => c.scanId === scan.id).map((c) => [c.baselineObservationId, c]));

	return baseline.map((b): ComparisonItem => {
		const prev = existing.get(b.id);
		const base = { id: prev?.id ?? newId(), scanId: scan.id, baselineObservationId: b.id, reviewedAt: prev?.reviewedAt ?? null };

		if (b.objectId === null) {
			return { ...base, currentObservationId: null, identityState: 'unresolved', visibilityState: 'uncertain', movementState: 'unknown' };
		}
		const objectId = canonicalId(d, b.objectId);
		const match = current.find((c) => c.objectId !== null && canonicalId(d, c.objectId) === objectId);

		if (!match) {
			// Something unresolved with a similar label could still be it: then visibility is uncertain.
			const maybe = current.some((c) => c.resolution === 'unresolved' && c.label.toLowerCase() === b.label.toLowerCase());
			return {
				...base,
				currentObservationId: null,
				identityState: 'unresolved',
				visibilityState: maybe ? 'uncertain' : 'not_rediscovered',
				movementState: 'unknown'
			};
		}

		let movementState: ComparisonItem['movementState'];
		if (prev?.reviewedAt && prev.currentObservationId === match.id) movementState = prev.movementState;
		else if (scan.uncertainViewpoint) movementState = 'unknown';
		else movementState = boxSuggestsMove(b.box, match.box) ? 'possibly_moved' : 'no_change_detected';

		return {
			...base,
			reviewedAt: prev?.currentObservationId === match.id ? base.reviewedAt : null,
			currentObservationId: match.id,
			identityState: 'confirmed',
			visibilityState: 'found',
			movementState
		};
	});
}

/** Replaces the scan's comparison items with freshly derived ones. */
export function recompute(d: HomeData, currentScanId: string): Mutation {
	const items = deriveComparison(d, currentScanId);
	const keep = new Set(items.map((i) => i.id));
	const stale = d.comparisonItems.filter((c) => c.scanId === currentScanId && !keep.has(c.id)).map((c) => c.id);
	return { put: { comparisonItems: items }, remove: { comparisonItems: stale } };
}

export function displayStatus(c: ComparisonItem): DisplayStatus {
	if (c.visibilityState === 'not_rediscovered') return 'not_rediscovered';
	if (c.identityState !== 'confirmed' || c.visibilityState !== 'found') return 'unresolved';
	if (c.movementState === 'confirmed_moved') return 'moved_confirmed';
	if (c.movementState === 'possibly_moved') return 'possibly_moved';
	if (c.movementState === 'no_change_detected') return 'found_no_change';
	return 'unresolved'; // identity known, comparability insufficient
}

/** Items the user created in this scan; they may have been in the home for years. */
export function newToInventory(d: HomeData, scanId: string): Observation[] {
	return observationsOfScan(d, scanId).filter((o) => o.resolution === 'created');
}

export type ComparisonSummary = Record<DisplayStatus, number>;

export function summarise(d: HomeData, scanId: string): ComparisonSummary {
	const out: ComparisonSummary = {
		found_no_change: 0,
		possibly_moved: 0,
		moved_confirmed: 0,
		new_to_inventory: newToInventory(d, scanId).length,
		not_rediscovered: 0,
		unresolved: 0
	};
	for (const c of d.comparisonItems.filter((x) => x.scanId === scanId)) out[displayStatus(c)]++;
	return out;
}

/** The user's verdict on movement for one item. Only this can produce `confirmed_moved`. */
export function reviewMovement(d: HomeData, itemId: string, moved: boolean): Mutation | null {
	const c = d.comparisonItems.find((x) => x.id === itemId);
	if (!c || c.identityState !== 'confirmed') return null;
	const change: Mutation = {
		put: { comparisonItems: [{ ...c, movementState: moved ? 'confirmed_moved' : 'no_change_detected', reviewedAt: now() }] }
	};
	const event: ReviewEvent = {
		id: newId(),
		entityType: 'comparison',
		entityId: c.id,
		action: 'movement',
		previousValue: snapshotFor(d, change),
		createdAt: now(),
		undoneAt: null
	};
	return mergeMutations(change, { put: { reviewEvents: [event] } });
}
