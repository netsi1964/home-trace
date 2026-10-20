import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { applyMutation } from '../inventory/mutation.ts';
import { addObservation, addScan, box, homeWithRooms } from '../inventory/testkit.ts';
import { applyResult, createObjectFrom } from '../matching/decisions.ts';
import type { HomeData } from '../inventory/model.ts';
import { exportJsonOnly, exportZip, importZip, LIMITS, sha256Hex } from './archive.ts';

const JPEG = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: n }, (_, i) => i % 251)]);

/** A home with one scan, one created object and real image bytes with correct hashes. */
async function home(): Promise<{ d: HomeData; images: Map<string, Uint8Array> }> {
	const h = homeWithRooms();
	const s = addScan(h.d, h.doorway);
	const a = addObservation(s.d, s.scan.id, 'lamp', box(0.1, 0.1));
	let d = applyResult(a.d, createObjectFrom(a.d, a.o.id, 'Floor lamp', 'lamp'));
	const images = new Map<string, Uint8Array>();
	const assets = await Promise.all(
		d.assets.map(async (asset, i) => {
			const bytes = JPEG(500 + i);
			images.set(asset.id, bytes);
			return { ...asset, byteLength: bytes.byteLength, sha256: await sha256Hex(bytes) };
		})
	);
	d = applyMutation(d, { put: { assets } });
	return { d, images };
}

const read = (images: Map<string, Uint8Array>) => async (id: string) => images.get(id);

function rezip(zipBytes: Uint8Array, edit: (files: Record<string, Uint8Array>) => void): Uint8Array {
	const files = unzipSync(zipBytes);
	edit(files);
	return zipSync(files);
}

describe('PRD-FEAT-009 archive', () => {
	it('T14: export then import preserves ids, decisions and verified image hashes', async () => {
		const { d, images } = await home();
		const zipped = await exportZip(d, read(images));
		const r = await importZip(zipped);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.data).toEqual(d);
		expect(r.preview).toMatchObject({ rooms: 2, objects: 1, images: 1, scans: 1 });
		for (const [id, bytes] of images) expect(r.images.get(id)).toEqual(bytes);
	});

	it('the manifest lists every asset with byte length and hash, and no secrets', async () => {
		const { d, images } = await home();
		const files = unzipSync(await exportZip(d, read(images)));
		const manifest = JSON.parse(strFromU8(files['manifest.json']));
		expect(manifest).toMatchObject({ schemaVersion: '1.0.0', homeId: d.home.id, inventoryPath: 'inventory.json' });
		expect(manifest.assets).toHaveLength(1);
		const all = Object.values(files).map((f) => strFromU8(f, true)).join('');
		expect(all).not.toMatch(/OPEN_ROUTER|Bearer |sk-or-|base64,/); // T22
	});

	it('T15: a missing image is rejected', async () => {
		const { d, images } = await home();
		const bad = rezip(await exportZip(d, read(images)), (f) => {
			for (const k of Object.keys(f)) if (k.startsWith('assets/')) delete f[k];
		});
		const r = await importZip(bad);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors.join()).toMatch(/Missing image file/);
	});

	it('T15: a ../ path is rejected before anything is parsed', async () => {
		const { d, images } = await home();
		const bad = rezip(await exportZip(d, read(images)), (f) => {
			f['../evil.json'] = strToU8('{}');
		});
		const r = await importZip(bad);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors.join()).toMatch(/Unsafe path/);
	});

	it('rejects an unknown future schema version', async () => {
		const { d, images } = await home();
		const bad = rezip(await exportZip(d, read(images)), (f) => {
			const m = JSON.parse(strFromU8(f['manifest.json']));
			f['manifest.json'] = strToU8(JSON.stringify({ ...m, schemaVersion: '2.0.0' }));
		});
		const r = await importZip(bad);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors[0]).toMatch(/Unsupported schema version 2.0.0/);
	});

	it('rejects a tampered image (hash mismatch) and a non-image file', async () => {
		const { d, images } = await home();
		const path = d.assets[0].path;
		const tampered = rezip(await exportZip(d, read(images)), (f) => {
			const b = new Uint8Array(f[path]);
			b[b.length - 1] ^= 1;
			f[path] = b;
		});
		expect((await importZip(tampered)).ok).toBe(false);
		const notImage = rezip(await exportZip(d, read(images)), (f) => {
			const b = new Uint8Array(f[path]);
			b[0] = 0x3c;
			f[path] = b;
		});
		const r = await importZip(notImage);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors.join()).toMatch(/not a image\/jpeg image/);
	});

	it('rejects broken references and unexpected files', async () => {
		const { d, images } = await home();
		const bad = rezip(await exportZip(d, read(images)), (f) => {
			const inv = JSON.parse(strFromU8(f['inventory.json']));
			inv.observations[0].scanId = crypto.randomUUID();
			f['inventory.json'] = strToU8(JSON.stringify(inv));
			f['script.js'] = strToU8('alert(1)');
		});
		const r = await importZip(bad);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors.join()).toMatch(/Unexpected file in archive: script.js/);
	});

	it('enforces the per-image size limit while reading', async () => {
		const { d, images } = await home();
		const big = rezip(await exportZip(d, read(images)), (f) => {
			f[d.assets[0].path] = new Uint8Array(LIMITS.imageBytes + 10);
		});
		const r = await importZip(big);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors.join()).toMatch(/larger than 20 MiB/);
	});

	it('refuses to export when an image is missing on the device', async () => {
		const { d } = await home();
		await expect(exportZip(d, async () => undefined)).rejects.toThrow(/missing from this device/);
	});

	it('the JSON-only export is labelled and cannot be imported as a full restore', async () => {
		const { d } = await home();
		const json = JSON.parse(exportJsonOnly(d));
		expect(json.manifest.withoutImages).toBe(true);
		const zipped = zipSync({ 'manifest.json': strToU8(JSON.stringify(json.manifest)), 'inventory.json': strToU8(JSON.stringify(json.inventory)) });
		const r = await importZip(zipped);
		expect(r.ok).toBe(false);
	});

	it('rejects input that is not a ZIP', async () => {
		const r = await importZip(new Uint8Array([1, 2, 3, 4, 5]));
		expect(r.ok).toBe(false);
	});
});
