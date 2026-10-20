import type { HomeData, InventoryObject, Observation, Room, Scan } from './model.ts';

/** Read-only derivations over one home (PRD-FEAT-007). Pure; safe to call on every render. */

export function scanById(d: HomeData, id: string): Scan | undefined {
	return d.scans.find((s) => s.id === id);
}

export function roomOfScan(d: HomeData, scan: Scan): Room | undefined {
	const vp = d.viewpoints.find((v) => v.id === scan.viewpointId);
	return vp ? d.rooms.find((r) => r.id === vp.roomId) : undefined;
}

/** Follows merges to the active canonical object (invariant 2). */
export function canonicalId(d: HomeData, objectId: string): string {
	const seen = new Set<string>();
	let id = objectId;
	for (;;) {
		const o = d.objects.find((x) => x.id === id);
		if (!o?.mergedIntoId || seen.has(id)) return id;
		seen.add(id);
		id = o.mergedIntoId;
	}
}

export function activeObjects(d: HomeData): InventoryObject[] {
	return d.objects.filter((o) => o.mergedIntoId === null);
}

/** Observations of an object, including those of objects merged into it. */
export function observationsOf(d: HomeData, objectId: string): Observation[] {
	return d.observations.filter((o) => o.objectId !== null && canonicalId(d, o.objectId) === objectId);
}

export type LastSeen = { room: Room | undefined; scan: Scan; observation: Observation };

/** Latest confirmed observation; historical rooms are never rewritten (invariant 3). */
export function lastSeen(d: HomeData, objectId: string): LastSeen | null {
	let best: LastSeen | null = null;
	for (const o of observationsOf(d, objectId)) {
		const scan = scanById(d, o.scanId);
		if (!scan) continue;
		if (!best || scan.capturedAt > best.scan.capturedAt) best = { room: roomOfScan(d, scan), scan, observation: o };
	}
	return best;
}

export function unresolvedObservations(d: HomeData): Observation[] {
	return d.observations.filter((o) => o.resolution === 'unresolved');
}

export type InventoryCounts = { items: number; unresolved: number; rooms: number; scans: number };

/** Totals count active object ids, never observations (invariant 2). */
export function counts(d: HomeData): InventoryCounts {
	return {
		items: activeObjects(d).length,
		unresolved: unresolvedObservations(d).length,
		rooms: d.rooms.length,
		scans: d.scans.filter((s) => s.status === 'review' || s.status === 'complete').length
	};
}

export type InventoryFilter = { text?: string; roomId?: string | null; category?: string | null };

export function searchInventory(d: HomeData, f: InventoryFilter): InventoryObject[] {
	const q = f.text?.trim().toLowerCase() ?? '';
	return activeObjects(d)
		.filter((o) => !q || o.name.toLowerCase().includes(q) || (o.notes ?? '').toLowerCase().includes(q))
		.filter((o) => !f.category || o.category === f.category)
		.filter((o) => !f.roomId || lastSeen(d, o.id)?.room?.id === f.roomId)
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function categories(d: HomeData): string[] {
	return [...new Set(activeObjects(d).map((o) => o.category).filter((c): c is string => !!c))].sort();
}

export function scansOfViewpoint(d: HomeData, viewpointId: string): Scan[] {
	return d.scans.filter((s) => s.viewpointId === viewpointId).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}

export function observationsOfScan(d: HomeData, scanId: string): Observation[] {
	return d.observations.filter((o) => o.scanId === scanId);
}
