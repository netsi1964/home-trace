import { strFromU8, strToU8, Unzip, UnzipInflate, zip, type Zippable } from 'fflate';
import { z } from 'zod';
import { APP_VERSION, checkIntegrity, HomeDataSchema, SCHEMA_VERSION, type HomeData } from '../inventory/model.ts';

/**
 * Portable ZIP export and validated import (PRD-FEAT-009, PRD-SEC-005 ZIP layout).
 * Import validates everything (sizes while reading, paths, formats, schema, references,
 * hashes) before anything touches the database; the caller replaces the home in one
 * transaction only after a successful, previewed result.
 */

export const LIMITS = {
	compressedBytes: 100 * 1024 * 1024,
	expandedBytes: 300 * 1024 * 1024,
	files: 2000,
	imageBytes: 20 * 1024 * 1024,
	jsonBytes: 20 * 1024 * 1024
} as const;

const ASSET_PATH = /^assets\/[0-9a-f-]{36}\.(jpg|png)$/;

export const ManifestSchema = z
	.object({
		schemaVersion: z.string(),
		appVersion: z.string(),
		exportedAt: z.string().datetime({ offset: true }),
		homeId: z.string().uuid(),
		inventoryPath: z.literal('inventory.json'),
		/** true for the JSON-only export ("Without image files"). */
		withoutImages: z.boolean().optional(),
		assets: z.array(
			z.object({ id: z.string().uuid(), path: z.string().regex(ASSET_PATH), byteLength: z.number().int().positive(), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict()
		)
	})
	.strict();

export type Manifest = z.infer<typeof ManifestSchema>;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function manifestFor(data: HomeData, withoutImages: boolean): Manifest {
	return {
		schemaVersion: SCHEMA_VERSION,
		appVersion: APP_VERSION,
		exportedAt: new Date().toISOString(),
		homeId: data.home.id,
		inventoryPath: 'inventory.json',
		...(withoutImages ? { withoutImages: true } : {}),
		assets: data.assets.map((a) => ({ id: a.id, path: a.path, byteLength: a.byteLength, sha256: a.sha256 }))
	};
}

/** Never contains credentials or provider requests: only the HomeData records and images. */
export async function exportZip(data: HomeData, readAsset: (id: string) => Promise<Uint8Array | undefined>): Promise<Uint8Array> {
	const files: Zippable = {
		'manifest.json': strToU8(JSON.stringify(manifestFor(data, false), null, 2)),
		'inventory.json': strToU8(JSON.stringify(data, null, 2))
	};
	for (const a of data.assets) {
		const bytes = await readAsset(a.id);
		if (!bytes) throw new Error(`Image ${a.id} is missing from this device; export stopped so the archive is not incomplete.`);
		if ((await sha256Hex(bytes)) !== a.sha256) throw new Error(`Image ${a.id} does not match its recorded hash.`);
		files[a.path] = [bytes, { level: 0 }]; // JPEG/PNG are already compressed
	}
	return new Promise((resolve, reject) => zip(files, { level: 6 }, (err, out) => (err ? reject(err) : resolve(out))));
}

export function exportJsonOnly(data: HomeData): string {
	return JSON.stringify({ manifest: manifestFor(data, true), inventory: data }, null, 2);
}

export type ImportPreview = { homeName: string; rooms: number; objects: number; images: number; scans: number };

export type ImportResult =
	| { ok: true; data: HomeData; images: Map<string, Uint8Array>; preview: ImportPreview }
	| { ok: false; errors: string[] };

const fail = (...errors: string[]): ImportResult => ({ ok: false, errors });

function safePath(name: string): boolean {
	if (name.startsWith('/') || name.includes('\\') || /^[a-z]:/i.test(name)) return false;
	return !name.split('/').some((part) => part === '..' || part === '.');
}

function isJpeg(b: Uint8Array) {
	return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}
function isPng(b: Uint8Array) {
	return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}

/** Reads a ZIP while enforcing size, count and path limits on the fly. */
async function readZip(input: Blob | Uint8Array): Promise<{ files: Map<string, Uint8Array> } | { errors: string[] }> {
	const size = input instanceof Uint8Array ? input.byteLength : input.size;
	if (size > LIMITS.compressedBytes) return { errors: [`Archive is larger than ${LIMITS.compressedBytes / 1024 / 1024} MiB`] };

	const files = new Map<string, Uint8Array>();
	const errors: string[] = [];
	let expanded = 0;
	let count = 0;

	await new Promise<void>((resolve) => {
		let pending = 0;
		let inputDone = false;
		const maybeDone = () => inputDone && pending === 0 && resolve();
		const unzip = new Unzip((file) => {
			const name = file.name;
			if (name.endsWith('/')) return; // directory entry
			count++;
			if (count > LIMITS.files) {
				if (count === LIMITS.files + 1) errors.push(`Archive has more than ${LIMITS.files} files`);
				return;
			}
			if (!safePath(name)) {
				errors.push(`Unsafe path in archive: ${name}`);
				return;
			}
			const known = name === 'manifest.json' || name === 'inventory.json' || ASSET_PATH.test(name);
			if (!known) {
				errors.push(`Unexpected file in archive: ${name}`);
				return;
			}
			const max = name.endsWith('.json') ? LIMITS.jsonBytes : LIMITS.imageBytes;
			const chunks: Uint8Array[] = [];
			let own = 0;
			pending++;
			file.ondata = (err, chunk, final) => {
				if (err) {
					errors.push(`Could not read ${name}: ${err.message}`);
					pending--;
					return maybeDone();
				}
				own += chunk.byteLength;
				expanded += chunk.byteLength;
				if (own > max) {
					errors.push(`${name} is larger than ${max / 1024 / 1024} MiB`);
					file.terminate();
					pending--;
					return maybeDone();
				}
				if (expanded > LIMITS.expandedBytes) {
					if (!errors.some((e) => e.startsWith('Expanded'))) errors.push(`Expanded contents exceed ${LIMITS.expandedBytes / 1024 / 1024} MiB`);
					file.terminate();
					pending--;
					return maybeDone();
				}
				chunks.push(chunk);
				if (final) {
					const out = new Uint8Array(own);
					let at = 0;
					for (const c of chunks) {
						out.set(c, at);
						at += c.byteLength;
					}
					files.set(name, out);
					pending--;
					maybeDone();
				}
			};
			file.start();
		});
		unzip.register(UnzipInflate);

		(async () => {
			try {
				if (input instanceof Uint8Array) {
					const step = 1 << 20;
					for (let i = 0; i < input.byteLength; i += step) unzip.push(input.subarray(i, i + step), i + step >= input.byteLength);
					if (input.byteLength === 0) unzip.push(new Uint8Array(0), true);
				} else {
					const reader = input.stream().getReader();
					for (;;) {
						const { value, done } = await reader.read();
						if (done) {
							unzip.push(new Uint8Array(0), true);
							break;
						}
						unzip.push(value);
						if (errors.length) {
							await reader.cancel();
							break;
						}
					}
				}
			} catch (e) {
				errors.push(`Not a readable ZIP archive: ${e instanceof Error ? e.message : String(e)}`);
			}
			inputDone = true;
			maybeDone();
		})();
	});

	return errors.length ? { errors } : { files };
}

export async function importZip(input: Blob | Uint8Array): Promise<ImportResult> {
	const read = await readZip(input);
	if ('errors' in read) return fail(...read.errors);
	const { files } = read;

	const manifestRaw = files.get('manifest.json');
	const inventoryRaw = files.get('inventory.json');
	if (!manifestRaw) return fail('manifest.json is missing');
	if (!inventoryRaw) return fail('inventory.json is missing');

	let manifestJson: unknown;
	let inventoryJson: unknown;
	try {
		manifestJson = JSON.parse(strFromU8(manifestRaw));
		inventoryJson = JSON.parse(strFromU8(inventoryRaw));
	} catch {
		return fail('manifest.json or inventory.json is not valid JSON');
	}

	const version = (manifestJson as { schemaVersion?: unknown })?.schemaVersion;
	if (version !== SCHEMA_VERSION) {
		return fail(`Unsupported schema version ${String(version)}; this app reads ${SCHEMA_VERSION}. Update HomeTrace to import newer archives.`);
	}
	const manifest = ManifestSchema.safeParse(manifestJson);
	if (!manifest.success) return fail(`manifest.json: ${manifest.error.issues[0]?.path.join('.')} ${manifest.error.issues[0]?.message}`);
	if (manifest.data.withoutImages) return fail('This is a JSON-only export without image files; it cannot restore a home.');

	const inventory = HomeDataSchema.safeParse(inventoryJson);
	if (!inventory.success) {
		return fail(...inventory.error.issues.slice(0, 5).map((i) => `inventory.json: ${i.path.join('.')} ${i.message}`));
	}
	const data = inventory.data;
	if (data.home.id !== manifest.data.homeId) return fail('manifest.json and inventory.json describe different homes');

	const integrity = checkIntegrity(data);
	if (integrity.length) return fail(...integrity.slice(0, 10));

	const listed = new Map(manifest.data.assets.map((a) => [a.id, a]));
	const images = new Map<string, Uint8Array>();
	const errors: string[] = [];
	for (const a of data.assets) {
		const m = listed.get(a.id);
		if (!m || m.path !== a.path || m.sha256 !== a.sha256 || m.byteLength !== a.byteLength) {
			errors.push(`Image ${a.id} is not listed consistently in manifest.json`);
			continue;
		}
		const bytes = files.get(a.path);
		if (!bytes) {
			errors.push(`Missing image file ${a.path}`);
			continue;
		}
		if (bytes.byteLength !== a.byteLength) errors.push(`${a.path} has the wrong size`);
		else if (!(a.mimeType === 'image/jpeg' ? isJpeg(bytes) : isPng(bytes))) errors.push(`${a.path} is not a ${a.mimeType} image`);
		else if ((await sha256Hex(bytes)) !== a.sha256) errors.push(`${a.path} does not match its SHA-256 hash`);
		else images.set(a.id, bytes);
	}
	if (listed.size !== data.assets.length) errors.push('manifest.json lists images that inventory.json does not use');
	const extra = [...files.keys()].filter((p) => ASSET_PATH.test(p) && !data.assets.some((a) => a.path === p));
	if (extra.length) errors.push(`Unexpected image files: ${extra.slice(0, 3).join(', ')}`);
	if (errors.length) return fail(...errors.slice(0, 10));

	return {
		ok: true,
		data,
		images,
		preview: {
			homeName: data.home.name,
			rooms: data.rooms.length,
			objects: data.objects.filter((o) => o.mergedIntoId === null).length,
			images: data.assets.length,
			scans: data.scans.length
		}
	};
}
