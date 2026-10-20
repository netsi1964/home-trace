import { COLLECTIONS, type Collection, type EntityOf, type Home, type HomeData } from './model.ts';

/**
 * A set of record changes that is applied as one unit: one IndexedDB transaction on disk and
 * one state update in memory (PRD-FEAT-008.2: every decision persists atomically).
 */
export type Mutation = {
	put?: { [C in Collection]?: EntityOf<C>[] };
	remove?: { [C in Collection]?: string[] };
	home?: Home;
};

export function applyMutation(data: HomeData, m: Mutation): HomeData {
	const next: HomeData = { ...data, home: m.home ?? data.home };
	for (const c of COLLECTIONS) {
		const puts = (m.put?.[c] ?? []) as { id: string }[];
		const removes = new Set(m.remove?.[c] ?? []);
		if (puts.length === 0 && removes.size === 0) continue;
		const byId = new Map((data[c] as { id: string }[]).map((x) => [x.id, x]));
		for (const id of removes) byId.delete(id);
		for (const x of puts) byId.set(x.id, x);
		(next as Record<Collection, unknown[]>)[c] = [...byId.values()];
	}
	return next;
}

export function mergeMutations(...ms: Mutation[]): Mutation {
	const out: Mutation = { put: {}, remove: {} };
	for (const m of ms) {
		if (m.home) out.home = m.home;
		for (const c of COLLECTIONS) {
			if (m.put?.[c]?.length) (out.put as Record<string, unknown[]>)[c] = [...((out.put as Record<string, unknown[]>)[c] ?? []), ...m.put[c]!];
			if (m.remove?.[c]?.length) out.remove![c] = [...(out.remove![c] ?? []), ...m.remove[c]!];
		}
	}
	return out;
}

/** Undo information stored in a ReviewEvent: the records as they were, and the ids that were created. */
export type UndoSnapshot = {
	before: { [C in Collection]?: EntityOf<C>[] };
	created: { [C in Collection]?: string[] };
};

/** Builds the snapshot needed to reverse `m` against the current `data`. */
export function snapshotFor(data: HomeData, m: Mutation): UndoSnapshot {
	const before: UndoSnapshot['before'] = {};
	const created: UndoSnapshot['created'] = {};
	for (const c of COLLECTIONS) {
		const current = new Map((data[c] as { id: string }[]).map((x) => [x.id, x]));
		const touched = [...((m.put?.[c] ?? []) as { id: string }[]).map((x) => x.id), ...(m.remove?.[c] ?? [])];
		for (const id of touched) {
			const old = current.get(id);
			if (old) ((before as Record<string, unknown[]>)[c] ??= []).push(JSON.parse(JSON.stringify(old))); // records are plain JSON; UI state may be a proxy
			else (created[c] ??= []).push(id);
		}
	}
	return { before, created };
}

export function reverseOf(s: UndoSnapshot): Mutation {
	return { put: s.before, remove: s.created };
}
