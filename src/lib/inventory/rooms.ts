import { newId, now, type HomeData, type ReviewEvent, type Room, type Viewpoint } from './model.ts';
import { mergeMutations, snapshotFor, type Mutation } from './mutation.ts';

/** Rooms and named viewpoints (PRD-FEAT-001). */

const clean = (s: string) => s.trim().slice(0, 80);

export function createRoom(d: HomeData, name: string): { mutation: Mutation; room: Room } | null {
	if (!clean(name)) return null;
	const room: Room = { id: newId(), homeId: d.home.id, name: clean(name), createdAt: now() };
	return { mutation: { put: { rooms: [room] } }, room };
}

export function renameRoom(d: HomeData, roomId: string, name: string): Mutation | null {
	const r = d.rooms.find((x) => x.id === roomId);
	return r && clean(name) ? { put: { rooms: [{ ...r, name: clean(name) }] } } : null;
}

export function createViewpoint(d: HomeData, roomId: string, name: string): { mutation: Mutation; viewpoint: Viewpoint } | null {
	if (!clean(name) || !d.rooms.some((r) => r.id === roomId)) return null;
	const viewpoint: Viewpoint = { id: newId(), roomId, name: clean(name), referenceScanId: null, createdAt: now() };
	return { mutation: { put: { viewpoints: [viewpoint] } }, viewpoint };
}

export function renameViewpoint(d: HomeData, viewpointId: string, name: string): Mutation | null {
	const v = d.viewpoints.find((x) => x.id === viewpointId);
	return v && clean(name) ? { put: { viewpoints: [{ ...v, name: clean(name) }] } } : null;
}

/**
 * Explicit reference selection. Affects future scans only: scans keep the reference they were
 * made with, so historical comparisons are unchanged (invariant 6, T19).
 */
export function setReference(d: HomeData, viewpointId: string, scanId: string | null): Mutation | null {
	const v = d.viewpoints.find((x) => x.id === viewpointId);
	if (!v) return null;
	if (scanId) {
		const s = d.scans.find((x) => x.id === scanId);
		if (!s || s.viewpointId !== viewpointId || (s.status !== 'review' && s.status !== 'complete')) return null;
	}
	const change: Mutation = { put: { viewpoints: [{ ...v, referenceScanId: scanId }] } };
	const event: ReviewEvent = {
		id: newId(),
		entityType: 'viewpoint',
		entityId: v.id,
		action: 'reference',
		previousValue: snapshotFor(d, change),
		createdAt: now(),
		undoneAt: null
	};
	return mergeMutations(change, { put: { reviewEvents: [event] } });
}
