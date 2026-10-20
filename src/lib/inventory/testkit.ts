import type { Box } from '../geometry/box.ts';
import { applyMutation } from './mutation.ts';
import { emptyHome, newId, type Asset, type HomeData, type Observation, type Scan } from './model.ts';

/** Builders for tests. Not used by the app. */

let clock = Date.parse('2026-10-20T10:00:00Z');
export const tick = () => new Date((clock += 60_000)).toISOString();

export function asset(): Asset {
	const id = newId();
	return { id, path: `assets/${id}.jpg`, mimeType: 'image/jpeg', width: 1200, height: 900, byteLength: 1000, sha256: 'a'.repeat(64) };
}

export function homeWithRooms(): { d: HomeData; living: string; kitchen: string; doorway: string; sofa: string; counter: string } {
	let d = emptyHome();
	const living = newId();
	const kitchen = newId();
	const doorway = newId();
	const sofa = newId();
	const counter = newId();
	d = applyMutation(d, {
		put: {
			rooms: [
				{ id: living, homeId: d.home.id, name: 'Living room', createdAt: tick() },
				{ id: kitchen, homeId: d.home.id, name: 'Kitchen', createdAt: tick() }
			],
			viewpoints: [
				{ id: doorway, roomId: living, name: 'From the doorway', referenceScanId: null, createdAt: tick() },
				{ id: sofa, roomId: living, name: 'Bookshelf from the sofa', referenceScanId: null, createdAt: tick() },
				{ id: counter, roomId: kitchen, name: 'Counter', referenceScanId: null, createdAt: tick() }
			]
		}
	});
	return { d, living, kitchen, doorway, sofa, counter };
}

export function addScan(d: HomeData, viewpointId: string, partial: Partial<Scan> = {}): { d: HomeData; scan: Scan } {
	const a = asset();
	const scan: Scan = {
		id: newId(),
		viewpointId,
		capturedAt: tick(),
		mode: 'register',
		imageAssetId: a.id,
		referenceScanId: null,
		status: 'review',
		uncertainViewpoint: false,
		demo: false,
		...partial
	};
	return { d: applyMutation(d, { put: { assets: [a], scans: [scan] } }), scan };
}

export function addObservation(d: HomeData, scanId: string, label: string, box: Box, partial: Partial<Observation> = {}): { d: HomeData; o: Observation } {
	const o: Observation = {
		id: newId(),
		scanId,
		objectId: null,
		box,
		cropAssetId: null,
		label,
		source: 'manual',
		resolution: 'unresolved',
		providerConfidence: null,
		presence: 'supported',
		...partial
	};
	return { d: applyMutation(d, { put: { observations: [o] } }), o };
}

export const box = (x: number, y: number, w = 0.1, h = 0.1): Box => ({ x, y, width: w, height: h });
