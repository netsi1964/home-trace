import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { emptyHome } from '../inventory/model.ts';
import { addObservation, addScan, box, homeWithRooms } from '../inventory/testkit.ts';
import { answerSkip, applyResult, createObjectFrom } from '../matching/decisions.ts';
import { counts } from '../inventory/queries.ts';
import { closeDb, commit, deleteHome, getBlob, loadHome, replaceHome, StorageFullError } from './db.ts';
import { COLLECTIONS } from '../inventory/model.ts';

/** IndexedDB returns records ordered by key; compare collections as sets. */
function normalised(d: ReturnType<typeof emptyHome> | null) {
	if (!d) return d;
	const out: Record<string, unknown> = { ...d };
	for (const c of COLLECTIONS) out[c] = [...(d[c] as { id: string }[])].sort((a, b) => a.id.localeCompare(b.id));
	return out;
}

async function saveAll(d: ReturnType<typeof emptyHome>) {
	await commit({ home: d.home, put: Object.fromEntries(COLLECTIONS.map((c) => [c, d[c]])) });
}

afterEach(async () => {
	await deleteHome();
	await closeDb();
});

describe('PRD-FEAT-008 IndexedDB persistence', () => {
	it('round-trips a home exactly', async () => {
		const h = homeWithRooms();
		await saveAll(h.d);
		await closeDb();
		expect(normalised(await loadHome())).toEqual(normalised(h.d));
	});

	it('T05: a Skip survives closing and reopening; the item count stays 0', async () => {
		const h = homeWithRooms();
		const s = addScan(h.d, h.doorway);
		const a = addObservation(s.d, s.scan.id, 'vase', box(0.1, 0.1));
		await saveAll(a.d);
		const r = answerSkip(a.d, a.o.id, null);
		if (r.kind !== 'ok') throw new Error('skip failed');
		await commit(r.mutation);
		await closeDb();
		const reopened = (await loadHome())!;
		expect(counts(reopened)).toMatchObject({ items: 0, unresolved: 1 });
		expect(reopened.matchDecisions.map((m) => m.answer)).toEqual(['skip']);
	});

	it('closing after a confirmed decision preserves it', async () => {
		const h = homeWithRooms();
		const s = addScan(h.d, h.doorway);
		const a = addObservation(s.d, s.scan.id, 'lamp', box(0.1, 0.1));
		await saveAll(a.d);
		const r = createObjectFrom(a.d, a.o.id, 'Lamp', null);
		if (r.kind !== 'ok') throw new Error();
		await commit(r.mutation);
		await closeDb();
		const reopened = (await loadHome())!;
		expect(normalised(reopened)).toEqual(normalised(applyResult(a.d, r)));
	});

	it('stores image bytes next to metadata', async () => {
		const d = emptyHome();
		await commit({ home: d.home }, [{ id: 'x', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }) }]);
		expect((await getBlob('x'))?.size).toBe(3);
	});

	it('replaceHome swaps the whole home', async () => {
		const first = homeWithRooms().d;
		await saveAll(first);
		const second = emptyHome('Summer house');
		await replaceHome(second, new Map());
		expect((await loadHome())?.home.name).toBe('Summer house');
		expect((await loadHome())?.rooms).toEqual([]);
	});

	it('maps a quota error to StorageFullError (T17)', async () => {
		const original = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function () {
			throw new DOMException('full', 'QuotaExceededError');
		};
		try {
			await expect(commit({ home: emptyHome().home })).rejects.toBeInstanceOf(StorageFullError);
		} finally {
			IDBObjectStore.prototype.put = original;
		}
	});
});
