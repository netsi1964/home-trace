import type { HomeData, InventoryObject } from '../inventory/model.ts';
import { activeObjects, lastSeen, roomOfScan, scanById } from '../inventory/queries.ts';
import { rejectedFor } from './decisions.ts';

/**
 * Candidate selection for "Same object?" (PRD-FEAT-004.1). A small, ordered set: same room
 * first, similar names next. The ordering score is internal and is never shown as confidence.
 */

export type Candidate = { object: InventoryObject; sameRoom: boolean; nameMatch: boolean };

const words = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1));

function similar(a: string, b: string): boolean {
	const A = words(a);
	const B = words(b);
	for (const w of A) if (B.has(w) || [...B].some((x) => x.startsWith(w) || w.startsWith(x))) return true;
	return false;
}

export function candidatesFor(d: HomeData, observationId: string, opts: { limit?: number; otherRooms?: boolean } = {}): Candidate[] {
	const o = d.observations.find((x) => x.id === observationId);
	if (!o) return [];
	const scan = scanById(d, o.scanId);
	const room = scan ? roomOfScan(d, scan) : undefined;
	const rejected = rejectedFor(d, observationId);
	const limit = opts.limit ?? 5;

	const scored = activeObjects(d)
		.filter((obj) => !rejected.has(obj.id))
		.map((obj) => {
			const seen = lastSeen(d, obj.id);
			const sameRoom = !!room && seen?.room?.id === room.id;
			const nameMatch = similar(o.label, obj.name) || (!!obj.category && similar(o.label, obj.category));
			return { object: obj, sameRoom, nameMatch, score: (sameRoom ? 2 : 0) + (nameMatch ? 3 : 0) };
		})
		// By default only similar names are proposed (same room first); `otherRooms` lists every item.
		.filter((c) => opts.otherRooms || c.nameMatch)
		.sort((a, b) => b.score - a.score || a.object.name.localeCompare(b.object.name));

	return scored.slice(0, limit).map(({ object, sameRoom, nameMatch }) => ({ object, sameRoom, nameMatch }));
}
