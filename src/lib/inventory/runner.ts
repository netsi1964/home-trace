import { sha256Hex } from '../archive/archive.ts';
import { cropFrame, type Frame } from '../camera/image.ts';
import { demoDetections } from '../providers/demo.ts';
import { discoverLive, type LiveError } from '../providers/live.ts';
import type { Detection, Usage } from '../providers/types.ts';
import { app, apply, assetBlob, type AnalysisMode } from '../storage/store.svelte.ts';
import { newId, type Asset } from './model.ts';
import { assetFor, cancelJob, completeJob, failJob, markRunning, startScan } from './scanJob.ts';

/**
 * Runs one bounded analysis job for one Scan press. A job id can only run once at a time
 * (double tap = one job), cancel aborts what has not been sent, and nothing is retried
 * automatically.
 */

const running = new Map<string, AbortController>();

export async function frameAsset(frame: Frame): Promise<{ asset: Asset; blob: Blob }> {
	const id = newId();
	return { asset: assetFor(id, { width: frame.width, height: frame.height, byteLength: frame.bytes.byteLength, sha256: await sha256Hex(frame.bytes) }), blob: frame.blob };
}

/** Persists the snapshot and its draft before any network request (PRD-FEAT-002.5). */
export async function createScan(args: { viewpointId: string; mode: 'register' | 'compare'; frame: Frame; analysis: AnalysisMode; demo: boolean }) {
	if (!app.data) throw new Error('No home');
	const { asset, blob } = await frameAsset(args.frame);
	const started = startScan(app.data, {
		viewpointId: args.viewpointId,
		mode: args.mode,
		image: asset,
		provider: args.analysis === 'live' ? 'vision-jev' : 'demo',
		model: null,
		demo: args.demo
	});
	if ('error' in started) throw new Error(started.error);
	const saved = await apply(started.mutation, [{ id: asset.id, blob }]);
	if (!saved) throw new Error('storage-full');
	return started;
}

export type RunOutcome = { ok: true; count: number; usage: Usage; durationMs: number } | { ok: false; error: LiveError };

export async function runJob(jobId: string, opts: { analysis: AnalysisMode; demoFixtureId: string | null }): Promise<RunOutcome> {
	if (running.has(jobId) || !app.data) return { ok: false, error: { kind: 'provider', message: 'Already running', requests: 0 } };
	const job = app.data.analysisJobs.find((j) => j.id === jobId);
	const scan = job && app.data.scans.find((s) => s.id === job.scanId);
	if (!job || !scan) return { ok: false, error: { kind: 'provider', message: 'Job not found', requests: 0 } };
	if (!(await apply(markRunning(app.data, jobId)))) return { ok: false, error: { kind: 'provider', message: 'Job cannot start', requests: 0 } };

	const controller = new AbortController();
	running.set(jobId, controller);
	try {
		const frame = await assetBlob(scan.imageAssetId);
		if (!frame) throw new Error('The snapshot is missing');

		let detections: Detection[];
		let usage: Usage;
		let durationMs = 0;
		if (opts.analysis === 'demo') {
			detections = demoDetections(opts.demoFixtureId);
			usage = { requests: 0, inputTokens: null, outputTokens: null, reportedCost: null };
		} else {
			const r = await discoverLive(frame, controller.signal);
			if (!r.ok) {
				if (r.error.kind === 'cancelled') await apply(cancelJob(app.data!, jobId));
				else await apply(failJob(app.data!, jobId, r.error.message, r.error.requests));
				return { ok: false, error: r.error };
			}
			detections = r.value.detections;
			usage = r.value.usage;
			durationMs = r.value.durationMs;
		}

		// Crops for "Same object?" previews are made on the device, from the stored snapshot.
		const crops = new Map<string, Asset>();
		const blobs: { id: string; blob: Blob }[] = [];
		for (const d of detections) {
			try {
				const c = await cropFrame(frame, d.box);
				const { asset, blob } = await frameAsset(c);
				crops.set(d.id, asset);
				blobs.push({ id: asset.id, blob });
			} catch {
				/* a missing preview crop is not fatal */
			}
		}
		await apply(completeJob(app.data!, jobId, { detections, usage }, crops), blobs);
		return { ok: true, count: detections.length, usage, durationMs };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		await apply(failJob(app.data!, jobId, message));
		return { ok: false, error: { kind: 'provider', message, requests: 0 } };
	} finally {
		running.delete(jobId);
	}
}

export function cancelRunning(jobId: string): void {
	running.get(jobId)?.abort();
}

export function isRunning(jobId: string): boolean {
	return running.has(jobId);
}

/** Crop of a stored observation for previews and identity requests. */
export async function observationCrop(observationId: string): Promise<Blob | null> {
	const o = app.data?.observations.find((x) => x.id === observationId);
	if (!o) return null;
	if (o.cropAssetId) {
		const b = await assetBlob(o.cropAssetId);
		if (b) return b;
	}
	const scan = app.data?.scans.find((s) => s.id === o.scanId);
	const frame = scan && (await assetBlob(scan.imageAssetId));
	return frame ? (await cropFrame(frame, o.box)).blob : null;
}
