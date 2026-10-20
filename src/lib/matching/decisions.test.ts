import { describe, expect, it } from 'vitest';
import { checkIntegrity, type HomeData } from '../inventory/model.ts';
import { counts, lastSeen, observationsOf } from '../inventory/queries.ts';
import { addObservation, addScan, box, homeWithRooms } from '../inventory/testkit.ts';
import { candidatesFor } from './candidates.ts';
import {
	answerNo,
	answerSkip,
	answerYes,
	applyResult,
	createObjectFrom,
	dismiss,
	mergeObjects,
	undo,
	unlink,
	type DecisionResult
} from './decisions.ts';

const ok = (d: HomeData, r: DecisionResult) => {
	expect(r.kind).toBe('ok');
	return applyResult(d, r);
};

describe('PRD-FEAT-004 identity decisions', () => {
	it('T02: after Yes, one lamp has two observations from two viewpoints', () => {
		const h = homeWithRooms();
		let { d, scan: s1 } = addScan(h.d, h.doorway);
		let a = addObservation(d, s1.id, 'lamp', box(0.1, 0.1));
		d = ok(a.d, createObjectFrom(a.d, a.o.id, 'Floor lamp', 'lamp'));
		const lampId = d.objects[0].id;

		const s2 = addScan(d, h.sofa);
		const b = addObservation(s2.d, s2.scan.id, 'lamp', box(0.7, 0.2));
		expect(candidatesFor(b.d, b.o.id)[0].object.id).toBe(lampId);
		d = ok(b.d, answerYes(b.d, b.o.id, lampId));

		expect(counts(d).items).toBe(1);
		expect(observationsOf(d, lampId)).toHaveLength(2);
		expect(checkIntegrity(d)).toEqual([]);
	});

	it('T04: No rejects that candidate, remembers it, and creates nothing', () => {
		const h = homeWithRooms();
		let { d, scan } = addScan(h.d, h.doorway);
		const a = addObservation(d, scan.id, 'lamp', box(0.1, 0.1));
		d = ok(a.d, createObjectFrom(a.d, a.o.id, 'Floor lamp', 'lamp'));
		const lampId = d.objects[0].id;
		const s2 = addScan(d, h.doorway);
		const b = addObservation(s2.d, s2.scan.id, 'lamp', box(0.5, 0.1));

		d = ok(b.d, answerNo(b.d, b.o.id, lampId));
		expect(d.objects).toHaveLength(1);
		expect(d.observations.find((o) => o.id === b.o.id)?.resolution).toBe('unresolved');
		expect(candidatesFor(d, b.o.id).map((c) => c.object.id)).not.toContain(lampId);
	});

	it('T05: Skip keeps the observation unresolved and out of the item count', () => {
		const h = homeWithRooms();
		const { d, scan } = addScan(h.d, h.doorway);
		const a = addObservation(d, scan.id, 'vase', box(0.1, 0.1));
		const after = ok(a.d, answerSkip(a.d, a.o.id, null));
		expect(counts(after)).toMatchObject({ items: 0, unresolved: 1 });
	});

	it('T03: two identical chairs are never merged automatically', () => {
		const h = homeWithRooms();
		let { d, scan } = addScan(h.d, h.doorway);
		const a = addObservation(d, scan.id, 'chair', box(0.1, 0.5));
		const b = addObservation(a.d, scan.id, 'chair', box(0.6, 0.5));
		d = ok(b.d, createObjectFrom(b.d, a.o.id, 'Chair', 'chair'));
		const chairId = d.objects[0].id;
		// Linking the second chair in the same scan to the same object needs explicit review (T23).
		const r = answerYes(d, b.o.id, chairId);
		expect(r).toEqual({ kind: 'needsDuplicateReview', otherObservationId: a.o.id });
		expect(d.observations.find((o) => o.id === b.o.id)?.objectId).toBeNull();
	});

	it('T23: the duplicate link is allowed only after explicit confirmation', () => {
		const h = homeWithRooms();
		let { d, scan } = addScan(h.d, h.doorway);
		const a = addObservation(d, scan.id, 'cup', box(0.1, 0.5));
		const b = addObservation(a.d, scan.id, 'cup', box(0.3, 0.5));
		d = ok(b.d, createObjectFrom(b.d, a.o.id, 'Cup', 'cup'));
		d = ok(d, answerYes(d, b.o.id, d.objects[0].id, { confirmDuplicate: true }));
		expect(observationsOf(d, d.objects[0].id)).toHaveLength(2);
	});

	it('T10: an item from another room can be chosen; history keeps the old room', () => {
		const h = homeWithRooms();
		let { d, scan } = addScan(h.d, h.doorway);
		const a = addObservation(d, scan.id, 'lamp', box(0.1, 0.1));
		d = ok(a.d, createObjectFrom(a.d, a.o.id, 'Floor lamp', 'lamp'));
		const lampId = d.objects[0].id;

		const k = addScan(d, h.counter);
		const b = addObservation(k.d, k.scan.id, 'lamp', box(0.4, 0.2));
		expect(candidatesFor(b.d, b.o.id, { otherRooms: true }).map((c) => c.object.id)).toContain(lampId);
		d = ok(b.d, answerYes(b.d, b.o.id, lampId));

		expect(lastSeen(d, lampId)?.room?.id).toBe(h.kitchen);
		const first = d.observations.find((o) => o.id === a.o.id)!;
		expect(d.scans.find((s) => s.id === first.scanId)?.viewpointId).toBe(h.doorway);
	});

	it('T18: an incorrect merge can be undone exactly', () => {
		const h = homeWithRooms();
		let { d, scan } = addScan(h.d, h.doorway);
		const a = addObservation(d, scan.id, 'lamp', box(0.1, 0.1));
		const b = addObservation(a.d, scan.id, 'vase', box(0.5, 0.1));
		d = ok(b.d, createObjectFrom(b.d, a.o.id, 'Lamp', null));
		d = ok(d, createObjectFrom(d, b.o.id, 'Vase', null));
		const before = structuredClone(d);
		const [lamp, vase] = d.objects;

		d = ok(d, mergeObjects(d, vase.id, lamp.id));
		expect(counts(d).items).toBe(1);
		expect(observationsOf(d, lamp.id)).toHaveLength(2);

		const mergeEvent = d.reviewEvents.find((e) => e.action === 'merge')!;
		d = ok(d, undo(d, mergeEvent.id));
		expect(counts(d).items).toBe(2);
		expect(d.objects).toEqual(before.objects);
		expect(d.observations).toEqual(before.observations);
		expect(undo(d, mergeEvent.id).kind).toBe('invalid');
	});

	it('undo of a create removes the object and returns the observation to unresolved', () => {
		const h = homeWithRooms();
		let { d, scan } = addScan(h.d, h.doorway);
		const a = addObservation(d, scan.id, 'lamp', box(0.1, 0.1));
		d = ok(a.d, createObjectFrom(a.d, a.o.id, 'Lamp', null));
		d = ok(d, undo(d, d.reviewEvents[0].id));
		expect(d.objects).toHaveLength(0);
		expect(d.observations[0]).toMatchObject({ objectId: null, resolution: 'unresolved' });
		expect(checkIntegrity(d)).toEqual([]);
	});

	it('refuses an undo that would discard a later decision on the same records', () => {
		const h = homeWithRooms();
		let { d, scan } = addScan(h.d, h.doorway);
		const a = addObservation(d, scan.id, 'lamp', box(0.1, 0.1));
		d = ok(a.d, createObjectFrom(a.d, a.o.id, 'Lamp', null));
		const create = d.reviewEvents[0];
		d = ok(d, unlink(d, a.o.id));
		expect(undo(d, create.id).kind).toBe('invalid');
	});

	it('confirmed links cannot be overwritten by a second Yes; correction needs unlink', () => {
		const h = homeWithRooms();
		let { d, scan } = addScan(h.d, h.doorway);
		const a = addObservation(d, scan.id, 'lamp', box(0.1, 0.1));
		const b = addObservation(a.d, scan.id, 'vase', box(0.5, 0.1));
		d = ok(b.d, createObjectFrom(b.d, a.o.id, 'Lamp', null));
		d = ok(d, createObjectFrom(d, b.o.id, 'Vase', null));
		expect(answerYes(d, a.o.id, d.objects[1].id).kind).toBe('invalid');
	});

	it('T11: a dismissed false detection never becomes an item', () => {
		const h = homeWithRooms();
		const { d, scan } = addScan(h.d, h.doorway);
		const a = addObservation(d, scan.id, 'ghost', box(0.8, 0.8), { source: 'jev', presence: 'uncertain' });
		const after = ok(a.d, dismiss(a.d, a.o.id));
		expect(counts(after)).toMatchObject({ items: 0, unresolved: 0 });
		expect(createObjectFrom(after, a.o.id, 'Ghost', null).kind).toBe('invalid');
	});
});
