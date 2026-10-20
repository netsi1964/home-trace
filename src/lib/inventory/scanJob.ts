import { parseBox, type Box } from '../geometry/box.ts';
import type { Detection, Usage } from '../providers/types.ts';
import { newId, now, type AnalysisJob, type Asset, type HomeData, type Observation, type Scan } from './model.ts';
import type { Mutation } from './mutation.ts';

/**
 * Scan lifecycle (PRD-FEAT-002, PRD-FEAT-010). One press creates one bounded job. The
 * snapshot and its draft are stored before any network request; a job is never restarted
 * automatically, and a retry reuses the same snapshot.
 */

export type ProviderId = AnalysisJob['provider'];

export function assetFor(id: string, frame: { width: number; height: number; byteLength: number; sha256: string }): Asset {
	return { id, path: `assets/${id}.jpg`, mimeType: 'image/jpeg', width: frame.width, height: frame.height, byteLength: frame.byteLength, sha256: frame.sha256 };
}

export function startScan(
	d: HomeData,
	args: { viewpointId: string; mode: Scan['mode']; image: Asset; provider: ProviderId; model: string | null; demo: boolean }
): { mutation: Mutation; scan: Scan; job: AnalysisJob } | { error: string } {
	const vp = d.viewpoints.find((v) => v.id === args.viewpointId);
	if (!vp) return { error: 'viewpoint not found' };
	if (args.mode === 'compare' && !vp.referenceScanId) return { error: 'choose a reference scan first' };
	const scan: Scan = {
		id: newId(),
		viewpointId: vp.id,
		capturedAt: now(),
		mode: args.mode,
		imageAssetId: args.image.id,
		// The reference is copied into the scan so later reference changes leave history intact.
		referenceScanId: args.mode === 'compare' ? vp.referenceScanId : null,
		status: 'draft',
		uncertainViewpoint: false,
		demo: args.demo
	};
	const job: AnalysisJob = {
		id: newId(),
		scanId: scan.id,
		provider: args.provider,
		model: args.model,
		status: 'pending',
		callCount: 0,
		usage: { inputTokens: null, outputTokens: null, reportedCost: null },
		startedAt: now(),
		finishedAt: null,
		error: null
	};
	return { mutation: { put: { assets: [args.image], scans: [scan], analysisJobs: [job] } }, scan, job };
}

function scanAndJob(d: HomeData, jobId: string) {
	const job = d.analysisJobs.find((j) => j.id === jobId);
	const scan = job ? d.scans.find((s) => s.id === job.scanId) : undefined;
	return { job, scan };
}

export function markRunning(d: HomeData, jobId: string): Mutation | null {
	const { job, scan } = scanAndJob(d, jobId);
	if (!job || !scan || (job.status !== 'pending' && job.status !== 'failed')) return null;
	return {
		put: {
			analysisJobs: [{ ...job, status: 'running', error: null, startedAt: now(), finishedAt: null }],
			scans: [{ ...scan, status: 'analyzing' }]
		}
	};
}

/**
 * Stores provider detections as new, unresolved observations. Existing observations are
 * never touched: AI output can only add proposals (invariant 7). Invalid boxes are dropped.
 */
export function completeJob(
	d: HomeData,
	jobId: string,
	result: { detections: Detection[]; usage: Usage },
	crops: Map<string, Asset> = new Map()
): Mutation | null {
	const { job, scan } = scanAndJob(d, jobId);
	if (!job || !scan || job.status !== 'running') return null;
	const observations: Observation[] = [];
	for (const det of result.detections) {
		const box = parseBox(det.box);
		if (!box) continue;
		observations.push({
			id: newId(),
			scanId: scan.id,
			objectId: null,
			box,
			cropAssetId: crops.get(det.id)?.id ?? null,
			label: det.label.slice(0, 80) || 'object',
			source: det.source,
			resolution: 'unresolved',
			providerConfidence: det.providerConfidence,
			presence: det.presence
		});
	}
	return {
		put: {
			observations,
			assets: [...crops.values()],
			analysisJobs: [
				{
					...job,
					status: 'done',
					callCount: job.callCount + result.usage.requests,
					usage: {
						inputTokens: result.usage.inputTokens,
						outputTokens: result.usage.outputTokens,
						reportedCost: result.usage.reportedCost
					},
					finishedAt: now()
				}
			],
			scans: [{ ...scan, status: 'review' }]
		}
	};
}

/** Failure keeps the draft and its snapshot; review continues manually or with an explicit retry. */
export function failJob(d: HomeData, jobId: string, message: string, requests = 0): Mutation | null {
	const { job, scan } = scanAndJob(d, jobId);
	if (!job || !scan) return null;
	return {
		put: {
			analysisJobs: [{ ...job, status: 'failed', callCount: job.callCount + requests, error: message.slice(0, 500), finishedAt: now() }],
			scans: [{ ...scan, status: 'failed' }]
		}
	};
}

export function cancelJob(d: HomeData, jobId: string): Mutation | null {
	const { job, scan } = scanAndJob(d, jobId);
	if (!job || !scan || job.status === 'done') return null;
	return {
		put: {
			analysisJobs: [{ ...job, status: 'cancelled', finishedAt: now(), error: 'Cancelled. Requests already sent may still be billed.' }],
			scans: [{ ...scan, status: 'cancelled' }]
		}
	};
}

/** Continue to review without AI results (manual marking). */
export function reviewManually(d: HomeData, scanId: string): Mutation | null {
	const scan = d.scans.find((s) => s.id === scanId);
	if (!scan || scan.status === 'review' || scan.status === 'complete') return null;
	return { put: { scans: [{ ...scan, status: 'review' }] } };
}

/** On app start: interrupted jobs are marked failed and are never restarted (PRD-FEAT-010). */
export function recoverInterrupted(d: HomeData): Mutation | null {
	const jobs = d.analysisJobs.filter((j) => j.status === 'running' || j.status === 'pending');
	const scans = d.scans.filter((s) => s.status === 'analyzing');
	if (!jobs.length && !scans.length) return null;
	return {
		put: {
			analysisJobs: jobs.map((j) => ({ ...j, status: 'failed' as const, error: 'Interrupted. Not restarted automatically.', finishedAt: now() })),
			scans: scans.map((s) => ({ ...s, status: 'failed' as const }))
		}
	};
}

export function addManualObservation(d: HomeData, scanId: string, box: Box, label: string, crop: Asset | null = null): Mutation | null {
	const scan = d.scans.find((s) => s.id === scanId);
	const b = parseBox(box);
	if (!scan || !b || !label.trim()) return null;
	const o: Observation = {
		id: newId(),
		scanId,
		objectId: null,
		box: b,
		cropAssetId: crop?.id ?? null,
		label: label.trim().slice(0, 80),
		source: 'manual',
		resolution: 'unresolved',
		providerConfidence: null,
		presence: 'supported'
	};
	return { put: { observations: [o], ...(crop ? { assets: [crop] } : {}) } };
}

export function editObservation(d: HomeData, observationId: string, patch: { label?: string; box?: Box }): Mutation | null {
	const o = d.observations.find((x) => x.id === observationId);
	if (!o) return null;
	const box = patch.box ? parseBox(patch.box) : o.box;
	const label = patch.label !== undefined ? patch.label.trim().slice(0, 80) : o.label;
	if (!box || !label) return null;
	return { put: { observations: [{ ...o, box, label }] } };
}

/**
 * Finishes review. Suggests (does not set) the first completed scan as the viewpoint's
 * reference when it has none (PRD-SEC-006, initial registration step 5).
 */
export function finishScan(d: HomeData, scanId: string): { mutation: Mutation; suggestReference: boolean } | null {
	const scan = d.scans.find((s) => s.id === scanId);
	if (!scan || scan.status !== 'review') return null;
	const vp = d.viewpoints.find((v) => v.id === scan.viewpointId);
	return { mutation: { put: { scans: [{ ...scan, status: 'complete' }] } }, suggestReference: !!vp && vp.referenceScanId === null };
}

export function setUncertainViewpoint(d: HomeData, scanId: string, uncertain: boolean): Mutation | null {
	const scan = d.scans.find((s) => s.id === scanId);
	return scan ? { put: { scans: [{ ...scan, uncertainViewpoint: uncertain }] } } : null;
}
