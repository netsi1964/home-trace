import { openDB, type IDBPDatabase } from 'idb';
import { COLLECTIONS, HomeDataSchema, SCHEMA_VERSION, type Collection, type HomeData } from '../inventory/model.ts';
import type { Mutation } from '../inventory/mutation.ts';

/**
 * IndexedDB persistence (PRD-FEAT-008). One store per entity collection, `meta` for the home
 * record, and `blobs` for image bytes keyed by asset id. Every mutation is written in a single
 * transaction across all stores it touches, so a decision is either fully saved or not at all.
 * Nothing in this module ever deletes data to free space.
 */

const DB_NAME = 'hometrace';
const DB_VERSION = 1;
const STORES = ['meta', 'blobs', ...COLLECTIONS] as const;

export class StorageFullError extends Error {
	constructor() {
		super('Device storage is full');
		this.name = 'StorageFullError';
	}
}

let dbPromise: Promise<IDBPDatabase> | null = null;

export function db(): Promise<IDBPDatabase> {
	dbPromise ??= openDB(DB_NAME, DB_VERSION, {
		upgrade(database) {
			database.createObjectStore('meta');
			database.createObjectStore('blobs');
			for (const c of COLLECTIONS) database.createObjectStore(c, { keyPath: 'id' });
		}
	});
	return dbPromise;
}

/** For tests: forget the open connection so the next call reopens the database. */
export async function closeDb(): Promise<void> {
	if (dbPromise) (await dbPromise).close();
	dbPromise = null;
}

/**
 * Records may come from reactive UI state (proxies), which IndexedDB cannot clone. All records
 * are plain JSON by schema, so a JSON round trip gives an exact, cloneable copy.
 */
function plain<T>(x: T): T {
	return JSON.parse(JSON.stringify(x));
}

function isQuotaError(e: unknown): boolean {
	return e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (e) {
		if (isQuotaError(e) || (e instanceof Error && isQuotaError((e as { cause?: unknown }).cause))) throw new StorageFullError();
		throw e;
	}
}

export async function loadHome(): Promise<HomeData | null> {
	const d = await db();
	const home = await d.get('meta', 'home');
	if (!home) return null;
	const data: Record<string, unknown> = { schemaVersion: SCHEMA_VERSION, home };
	for (const c of COLLECTIONS) data[c] = await d.getAll(c);
	(data.reviewEvents as { createdAt: string }[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	const parsed = HomeDataSchema.safeParse(data);
	if (!parsed.success) throw new Error(`Stored data does not match schema ${SCHEMA_VERSION}: ${parsed.error.issues[0]?.message}`);
	return parsed.data;
}

/** Writes a mutation, plus any new image bytes, in one transaction. */
export async function commit(m: Mutation, blobs: { id: string; blob: Blob }[] = []): Promise<void> {
	const touched = new Set<string>();
	if (m.home) touched.add('meta');
	if (blobs.length) touched.add('blobs');
	for (const c of COLLECTIONS) if (m.put?.[c]?.length || m.remove?.[c]?.length) touched.add(c);
	if (touched.size === 0) return;
	await guard(async () => {
		const d = await db();
		const tx = d.transaction([...touched], 'readwrite');
		if (m.home) tx.objectStore('meta').put(plain(m.home), 'home');
		for (const b of blobs) tx.objectStore('blobs').put(b.blob, b.id);
		for (const c of COLLECTIONS) {
			if (!touched.has(c)) continue;
			const store = tx.objectStore(c);
			for (const id of m.remove?.[c] ?? []) store.delete(id);
			for (const x of (m.put?.[c] ?? []) as object[]) store.put(plain(x));
		}
		await tx.done;
	});
}

export async function getBlob(assetId: string): Promise<Blob | undefined> {
	return (await db()).get('blobs', assetId);
}

/**
 * Replaces the whole home in one transaction (import). If anything fails, the transaction
 * aborts and the previous home is untouched (PRD-FEAT-009, T15).
 */
export async function replaceHome(data: HomeData, blobs: Map<string, Blob>): Promise<void> {
	await guard(async () => {
		const d = await db();
		const tx = d.transaction([...STORES], 'readwrite');
		for (const s of STORES) tx.objectStore(s).clear();
		tx.objectStore('meta').put(plain(data.home), 'home');
		for (const [id, blob] of blobs) tx.objectStore('blobs').put(blob, id);
		for (const c of COLLECTIONS) for (const x of data[c] as object[]) tx.objectStore(c as Collection).put(plain(x));
		await tx.done;
	});
}

/** Deletes every record and image of the home (PRD-SEC-007.9). Only called after explicit confirmation. */
export async function deleteHome(): Promise<void> {
	const d = await db();
	const tx = d.transaction([...STORES], 'readwrite');
	for (const s of STORES) tx.objectStore(s).clear();
	await tx.done;
}

export type StorageInfo = { usage: number | null; quota: number | null; persisted: boolean | null };

export async function storageInfo(): Promise<StorageInfo> {
	const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
	const est = await s?.estimate?.().catch(() => undefined);
	const persisted = await s?.persisted?.().catch(() => null);
	return { usage: est?.usage ?? null, quota: est?.quota ?? null, persisted: persisted ?? null };
}

/** Asks for persistent storage. Refusal is fine and never blocks the app (PRD-FEAT-008.4). */
export async function requestPersistence(): Promise<boolean | null> {
	try {
		return (await navigator.storage?.persist?.()) ?? null;
	} catch {
		return null;
	}
}
