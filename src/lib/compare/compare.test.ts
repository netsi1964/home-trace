import { describe, expect, it } from 'vitest';
import { applyMutation } from '../inventory/mutation.ts';
import { setReference } from '../inventory/rooms.ts';
import { addObservation, addScan, box, homeWithRooms } from '../inventory/testkit.ts';
import { answerYes, applyResult, createObjectFrom } from '../matching/decisions.ts';
import type { HomeData } from '../inventory/model.ts';
import { boxSuggestsMove, deriveComparison, displayStatus, recompute, reviewMovement, summarise } from './compare.ts';

/** Reference scan with a chair and a cup, both registered as items. */
function reference() {
	const h = homeWithRooms();
	let s = addScan(h.d, h.doorway);
	const chair = addObservation(s.d, s.scan.id, 'chair', box(0.6, 0.4, 0.2, 0.4));
	const cup = addObservation(chair.d, s.scan.id, 'cup', box(0.4, 0.45, 0.05, 0.08));
	let d = applyResult(cup.d, createObjectFrom(cup.d, chair.o.id, 'Chair', 'chair'));
	d = applyResult(d, createObjectFrom(d, cup.o.id, 'Cup', 'cup'));
	d = applyMutation(d, setReference(d, h.doorway, s.scan.id)!);
	return { h, d, ref: s.scan, chairId: d.objects[0].id, cupId: d.objects[1].id };
}

function compareScan(d: HomeData, viewpointId: string, refId: string, uncertainViewpoint = false) {
	return addScan(d, viewpointId, { mode: 'compare', referenceScanId: refId, uncertainViewpoint });
}

function link(d: HomeData, scanId: string, label: string, b: ReturnType<typeof box>, objectId: string) {
	const o = addObservation(d, scanId, label, b);
	return applyResult(o.d, answerYes(o.d, o.o.id, objectId));
}

describe('PRD-FEAT-006 comparison', () => {
	it('T07: a visibly moved chair is only "possibly moved" until the user confirms', () => {
		const r = reference();
		const c = compareScan(r.d, r.h.doorway, r.ref.id);
		let d = link(c.d, c.scan.id, 'chair', box(0.1, 0.4, 0.2, 0.4), r.chairId);
		d = applyMutation(d, recompute(d, c.scan.id));
		const item = d.comparisonItems.find((i) => i.currentObservationId !== null)!;
		expect(displayStatus(item)).toBe('possibly_moved');

		d = applyMutation(d, reviewMovement(d, item.id, true)!);
		expect(displayStatus(d.comparisonItems.find((i) => i.id === item.id)!)).toBe('moved_confirmed');
		// A later recompute keeps the user's verdict.
		d = applyMutation(d, recompute(d, c.scan.id));
		expect(displayStatus(d.comparisonItems.find((i) => i.id === item.id)!)).toBe('moved_confirmed');
	});

	it('T08: a cup hidden behind a book is not rediscovered, never removed', () => {
		const r = reference();
		const c = compareScan(r.d, r.h.doorway, r.ref.id);
		let d = link(c.d, c.scan.id, 'chair', box(0.6, 0.4, 0.2, 0.4), r.chairId);
		d = applyMutation(d, recompute(d, c.scan.id));
		const cupItem = d.comparisonItems.find((i) => i.currentObservationId === null)!;
		expect(displayStatus(cupItem)).toBe('not_rediscovered');
		expect(d.objects.find((o) => o.id === r.cupId)?.mergedIntoId).toBeNull();
		expect(d.objects).toHaveLength(2);
	});

	it('an unresolved detection with the same label makes visibility uncertain', () => {
		const r = reference();
		const c = compareScan(r.d, r.h.doorway, r.ref.id);
		let d = addObservation(c.d, c.scan.id, 'cup', box(0.42, 0.45, 0.05, 0.08)).d;
		d = applyMutation(d, recompute(d, c.scan.id));
		const statuses = d.comparisonItems.map(displayStatus).sort();
		expect(statuses).toEqual(['not_rediscovered', 'unresolved']);
	});

	it('T09: box displacement alone never confirms movement', () => {
		const r = reference();
		const c = compareScan(r.d, r.h.doorway, r.ref.id);
		let d = link(c.d, c.scan.id, 'chair', box(0.45, 0.4, 0.2, 0.4), r.chairId);
		d = applyMutation(d, recompute(d, c.scan.id));
		expect(d.comparisonItems.every((i) => i.movementState !== 'confirmed_moved')).toBe(true);
	});

	it('poor alignment makes position uncertain: movement unknown, shown as unresolved', () => {
		const r = reference();
		const c = compareScan(r.d, r.h.doorway, r.ref.id, true);
		let d = link(c.d, c.scan.id, 'chair', box(0.1, 0.4, 0.2, 0.4), r.chairId);
		d = applyMutation(d, recompute(d, c.scan.id));
		const item = d.comparisonItems.find((i) => i.currentObservationId !== null)!;
		expect(item.movementState).toBe('unknown');
		expect(displayStatus(item)).toBe('unresolved');
	});

	it('T21: an item moved away and back reads "found again — no change detected"', () => {
		const r = reference();
		const c = compareScan(r.d, r.h.doorway, r.ref.id);
		let d = link(c.d, c.scan.id, 'chair', box(0.61, 0.4, 0.2, 0.4), r.chairId);
		d = applyMutation(d, recompute(d, c.scan.id));
		expect(summarise(d, c.scan.id)).toMatchObject({ found_no_change: 1, not_rediscovered: 1 });
	});

	it('T19: a new reference affects future scans; historical comparisons keep theirs', () => {
		const r = reference();
		const c1 = compareScan(r.d, r.h.doorway, r.ref.id);
		let d = link(c1.d, c1.scan.id, 'chair', box(0.6, 0.4, 0.2, 0.4), r.chairId);
		d = applyMutation(d, recompute(d, c1.scan.id));
		const before = structuredClone(d.comparisonItems);

		d = applyMutation(d, setReference(d, r.h.doorway, c1.scan.id)!);
		expect(d.viewpoints.find((v) => v.id === r.h.doorway)?.referenceScanId).toBe(c1.scan.id);
		expect(d.scans.find((s) => s.id === c1.scan.id)?.referenceScanId).toBe(r.ref.id);
		expect(deriveComparison(d, c1.scan.id).map((i) => i.baselineObservationId).sort()).toEqual(
			before.map((i) => i.baselineObservationId).sort()
		);
	});

	it('identity, visibility and movement are independent', () => {
		expect(
			displayStatus({
				id: 'x',
				scanId: 'y',
				baselineObservationId: 'z',
				currentObservationId: 'w',
				identityState: 'confirmed',
				visibilityState: 'found',
				movementState: 'unknown',
				reviewedAt: null
			})
		).toBe('unresolved');
		expect(boxSuggestsMove(box(0.1, 0.1), box(0.11, 0.1))).toBe(false);
	});
});
