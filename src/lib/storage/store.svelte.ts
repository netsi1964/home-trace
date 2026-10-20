import { emptyHome, now, type HomeData } from '../inventory/model.ts';
import { applyMutation, type Mutation } from '../inventory/mutation.ts';
import { recoverInterrupted } from '../inventory/scanJob.ts';
import * as db from './db.ts';

/**
 * In-memory app state mirrored to IndexedDB. Every change goes through `apply`: the mutation
 * is written in one transaction first and only then shown, so the UI never shows a decision
 * that is not saved.
 */

export type AnalysisMode = 'demo' | 'live';

export const app = $state({
	data: null as HomeData | null,
	ready: false,
	loadError: null as string | null,
	storageFull: false,
	mode: 'demo' as AnalysisMode
});

const MODE_KEY = 'hometrace.analysisMode';

export async function initApp(): Promise<void> {
	if (app.ready) return;
	try {
		try {
			const m = localStorage.getItem(MODE_KEY);
			if (m === 'live' || m === 'demo') app.mode = m;
		} catch {
			/* per-device preference only */
		}
		let data = await db.loadHome();
		if (data) {
			const recovery = recoverInterrupted(data);
			if (recovery) {
				await db.commit(recovery);
				data = applyMutation(data, recovery);
			}
		}
		app.data = data;
		void db.requestPersistence();
	} catch (e) {
		app.loadError = e instanceof Error ? e.message : String(e);
	} finally {
		app.ready = true;
	}
}

export function setMode(mode: AnalysisMode): void {
	app.mode = mode;
	try {
		localStorage.setItem(MODE_KEY, mode);
	} catch {
		/* ignore */
	}
}

export async function createHome(name: string): Promise<void> {
	const d = emptyHome(name.trim() || 'My home');
	await db.commit({ home: d.home });
	app.data = d;
}

/** Saves a mutation (and new image bytes) atomically, then updates the screen. */
export async function apply(m: Mutation | null, blobs: { id: string; blob: Blob }[] = []): Promise<boolean> {
	if (!m || !app.data) return false;
	try {
		await db.commit(m, blobs);
	} catch (e) {
		if (e instanceof db.StorageFullError) {
			app.storageFull = true;
			return false;
		}
		throw e;
	}
	app.data = applyMutation(app.data, m);
	return true;
}

export async function markExported(): Promise<void> {
	if (!app.data) return;
	await apply({ home: { ...app.data.home, lastExportedAt: now() } });
}

const urlCache = new Map<string, string>();

export async function assetUrl(id: string | null | undefined): Promise<string | null> {
	if (!id) return null;
	const cached = urlCache.get(id);
	if (cached) return cached;
	const blob = await db.getBlob(id);
	if (!blob) return null;
	const url = URL.createObjectURL(blob);
	urlCache.set(id, url);
	return url;
}

export const assetBlob = (id: string) => db.getBlob(id);

export async function replaceHome(data: HomeData, images: Map<string, Uint8Array>): Promise<void> {
	const blobs = new Map<string, Blob>();
	for (const a of data.assets) {
		const bytes = images.get(a.id);
		if (bytes) blobs.set(a.id, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: a.mimeType }));
	}
	await db.replaceHome(data, blobs);
	for (const u of urlCache.values()) URL.revokeObjectURL(u);
	urlCache.clear();
	app.data = data;
}

export async function deleteHome(): Promise<void> {
	await db.deleteHome();
	for (const u of urlCache.values()) URL.revokeObjectURL(u);
	urlCache.clear();
	app.data = null;
}
