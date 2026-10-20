import { newId, now, type HomeData, type InventoryObject, type MatchDecision, type Observation, type ReviewEvent } from '../inventory/model.ts';
import { applyMutation, mergeMutations, reverseOf, snapshotFor, type Mutation, type UndoSnapshot } from '../inventory/mutation.ts';
import { canonicalId } from '../inventory/queries.ts';

/**
 * Identity decisions (PRD-FEAT-004). Pure functions: each returns one Mutation that includes
 * its ReviewEvent with an undo snapshot. Nothing here is called by provider code: AI output
 * can only propose, and only these user answers change identity (invariant 7).
 */

export type DecisionResult =
	| { kind: 'ok'; mutation: Mutation }
	| { kind: 'needsDuplicateReview'; otherObservationId: string }
	| { kind: 'invalid'; reason: string };

function obs(d: HomeData, id: string): Observation | undefined {
	return d.observations.find((o) => o.id === id);
}

function activeObject(d: HomeData, id: string): InventoryObject | undefined {
	const o = d.objects.find((x) => x.id === id);
	return o && o.mergedIntoId === null ? o : undefined;
}

function decision(observationId: string, candidateObjectId: string | null, answer: MatchDecision['answer']): MatchDecision {
	return { id: newId(), observationId, candidateObjectId, answer, decidedAt: now() };
}

/** Wraps a change with a ReviewEvent holding everything needed to undo it. */
function withEvent(d: HomeData, change: Mutation, entityType: ReviewEvent['entityType'], entityId: string, action: ReviewEvent['action']): Mutation {
	const event: ReviewEvent = {
		id: newId(),
		entityType,
		entityId,
		action,
		previousValue: snapshotFor(d, change) satisfies UndoSnapshot,
		createdAt: now(),
		undoneAt: null
	};
	return mergeMutations(change, { put: { reviewEvents: [event] } });
}

/**
 * **Yes**: link the observation to the candidate's stable id. Linking a second detection from
 * the same scan to the same object needs explicit duplicate review first (T23).
 */
export function answerYes(d: HomeData, observationId: string, objectId: string, opts: { confirmDuplicate?: boolean } = {}): DecisionResult {
	const o = obs(d, observationId);
	const target = activeObject(d, objectId);
	if (!o) return { kind: 'invalid', reason: 'observation not found' };
	if (!target) return { kind: 'invalid', reason: 'object not found or merged' };
	if (o.resolution === 'linked' || o.resolution === 'created') return { kind: 'invalid', reason: 'already confirmed; unlink first to correct it' };
	if (o.resolution === 'ignored') return { kind: 'invalid', reason: 'observation was dismissed' };

	if (!opts.confirmDuplicate) {
		const twin = d.observations.find(
			(x) => x.id !== o.id && x.scanId === o.scanId && x.objectId !== null && canonicalId(d, x.objectId) === objectId
		);
		if (twin) return { kind: 'needsDuplicateReview', otherObservationId: twin.id };
	}

	const change: Mutation = {
		put: { observations: [{ ...o, objectId, resolution: 'linked' }], matchDecisions: [decision(o.id, objectId, 'yes')] }
	};
	return { kind: 'ok', mutation: withEvent(d, change, 'observation', o.id, 'link') };
}

/** **No**: rejects this one pair and is remembered. It never creates an object (T04). */
export function answerNo(d: HomeData, observationId: string, objectId: string): DecisionResult {
	const o = obs(d, observationId);
	if (!o) return { kind: 'invalid', reason: 'observation not found' };
	return { kind: 'ok', mutation: { put: { matchDecisions: [decision(o.id, objectId, 'no')] } } };
}

/** **Skip**: keeps the observation unresolved; it does not count as an item (T05). */
export function answerSkip(d: HomeData, observationId: string, objectId: string | null): DecisionResult {
	const o = obs(d, observationId);
	if (!o) return { kind: 'invalid', reason: 'observation not found' };
	return { kind: 'ok', mutation: { put: { matchDecisions: [decision(o.id, objectId, 'skip')] } } };
}

/** Explicit user choice to register a new item from an observation. */
export function createObjectFrom(d: HomeData, observationId: string, name: string, category: string | null): DecisionResult {
	const o = obs(d, observationId);
	if (!o) return { kind: 'invalid', reason: 'observation not found' };
	if (o.resolution !== 'unresolved') return { kind: 'invalid', reason: 'observation is not unresolved' };
	const trimmed = name.trim();
	if (!trimmed) return { kind: 'invalid', reason: 'name is required' };
	const object: InventoryObject = {
		id: newId(),
		homeId: d.home.id,
		name: trimmed.slice(0, 80),
		category: category?.trim() || null,
		notes: '',
		createdAt: now(),
		mergedIntoId: null
	};
	const change: Mutation = {
		put: {
			objects: [object],
			observations: [{ ...o, objectId: object.id, resolution: 'created' }],
			matchDecisions: [decision(o.id, object.id, 'new')]
		}
	};
	return { kind: 'ok', mutation: withEvent(d, change, 'object', object.id, 'create') };
}

/** Correction: removes a confirmed link and returns the observation to unresolved. */
export function unlink(d: HomeData, observationId: string): DecisionResult {
	const o = obs(d, observationId);
	if (!o || o.objectId === null) return { kind: 'invalid', reason: 'observation is not linked' };
	const change: Mutation = { put: { observations: [{ ...o, objectId: null, resolution: 'unresolved' }] } };
	return { kind: 'ok', mutation: withEvent(d, change, 'observation', o.id, 'unlink') };
}

/** Marks a detection as false (it stays in history as ignored). */
export function dismiss(d: HomeData, observationId: string): DecisionResult {
	const o = obs(d, observationId);
	if (!o) return { kind: 'invalid', reason: 'observation not found' };
	if (o.objectId !== null) return { kind: 'invalid', reason: 'unlink before dismissing' };
	const change: Mutation = { put: { observations: [{ ...o, resolution: 'ignored' }] } };
	return { kind: 'ok', mutation: withEvent(d, change, 'observation', o.id, 'dismiss') };
}

/** Merges a duplicate into the canonical object. Observations keep their original link (history). */
export function mergeObjects(d: HomeData, duplicateId: string, canonical: string): DecisionResult {
	const dup = activeObject(d, duplicateId);
	const keep = activeObject(d, canonical);
	if (!dup || !keep) return { kind: 'invalid', reason: 'both objects must be active' };
	if (dup.id === keep.id) return { kind: 'invalid', reason: 'cannot merge an object into itself' };
	const change: Mutation = { put: { objects: [{ ...dup, mergedIntoId: keep.id }] } };
	return { kind: 'ok', mutation: withEvent(d, change, 'object', dup.id, 'merge') };
}

export function renameObject(d: HomeData, objectId: string, name: string): DecisionResult {
	const o = d.objects.find((x) => x.id === objectId);
	const trimmed = name.trim();
	if (!o || !trimmed) return { kind: 'invalid', reason: 'object and name are required' };
	return { kind: 'ok', mutation: withEvent(d, { put: { objects: [{ ...o, name: trimmed.slice(0, 80) }] } }, 'object', o.id, 'rename') };
}

export function setNote(d: HomeData, objectId: string, notes: string): DecisionResult {
	const o = d.objects.find((x) => x.id === objectId);
	if (!o) return { kind: 'invalid', reason: 'object not found' };
	return { kind: 'ok', mutation: withEvent(d, { put: { objects: [{ ...o, notes: notes.slice(0, 2000) }] } }, 'object', o.id, 'note') };
}

/** Reverses a ReviewEvent exactly, and marks it undone. Undo of an already undone event is refused. */
export function undo(d: HomeData, eventId: string): DecisionResult {
	const e = d.reviewEvents.find((x) => x.id === eventId);
	if (!e) return { kind: 'invalid', reason: 'event not found' };
	if (e.undoneAt) return { kind: 'invalid', reason: 'already undone' };
	const snap = e.previousValue as UndoSnapshot;
	// Refuse when a later, still-active event touched the same records: undo must not lose newer decisions.
	const touched = new Set(
		[...Object.values(snap.before ?? {}).flat().map((x) => (x as { id: string }).id), ...Object.values(snap.created ?? {}).flat()]
	);
	// `now()` is strictly increasing, so createdAt orders events even after a database round trip.
	const later = d.reviewEvents.some((x) => {
		if (x.id === e.id || x.undoneAt || x.createdAt <= e.createdAt) return false;
		const s = x.previousValue as UndoSnapshot;
		const ids = [...Object.values(s.before ?? {}).flat().map((y) => (y as { id: string }).id), ...Object.values(s.created ?? {}).flat()];
		return ids.some((id) => touched.has(id));
	});
	if (later) return { kind: 'invalid', reason: 'a later change touched the same records; undo that first' };
	return { kind: 'ok', mutation: mergeMutations(reverseOf(snap), { put: { reviewEvents: [{ ...e, undoneAt: now() }] } }) };
}

/** Objects already rejected for this observation; they are never proposed again for it. */
export function rejectedFor(d: HomeData, observationId: string): Set<string> {
	return new Set(d.matchDecisions.filter((m) => m.observationId === observationId && m.answer === 'no' && m.candidateObjectId).map((m) => m.candidateObjectId!));
}

export function applyResult(d: HomeData, r: DecisionResult): HomeData {
	return r.kind === 'ok' ? applyMutation(d, r.mutation) : d;
}
