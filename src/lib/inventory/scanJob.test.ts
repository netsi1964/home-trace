import { describe, expect, it } from 'vitest';
import { applyResult, createObjectFrom } from '../matching/decisions.ts';
import { applyMutation } from './mutation.ts';
import { counts } from './queries.ts';
import { asset, box, homeWithRooms } from './testkit.ts';
import { addManualObservation, completeJob, failJob, finishScan, markRunning, recoverInterrupted, startScan } from './scanJob.ts';
import type { Detection } from '../providers/types.ts';

const det = (label: string, b = box(0.1, 0.1), extra: Partial<Detection> = {}): Detection => ({
	id: crypto.randomUUID(),
	label,
	category: null,
	box: b,
	source: 'jev',
	providerConfidence: null,
	presence: 'supported',
	...extra
});
const usage = { requests: 2, inputTokens: 100, outputTokens: 0, reportedCost: 0.0001 };

function started() {
	const h = homeWithRooms();
	const s = startScan(h.d, { viewpointId: h.doorway, mode: 'register', image: asset(), provider: 'jev', model: 'typesafe/jev-1.14', demo: false });
	if ('error' in s) throw new Error(s.error);
	return { h, d: applyMutation(h.d, s.mutation), scan: s.scan, job: s.job };
}

describe('PRD-FEAT-002 / PRD-FEAT-010 scan jobs', () => {
	it('stores the draft scan, its snapshot and the job before any request', () => {
		const { d, scan, job } = started();
		expect(d.scans.find((s) => s.id === scan.id)?.status).toBe('draft');
		expect(d.assets.some((a) => a.id === scan.imageAssetId)).toBe(true);
		expect(d.analysisJobs.find((j) => j.id === job.id)?.status).toBe('pending');
	});

	it('T12: a second start of the same job is refused (double tap = one job)', () => {
		const { d, job } = started();
		const running = applyMutation(d, markRunning(d, job.id)!);
		expect(markRunning(running, job.id)).toBeNull();
	});

	it('T13: a network failure keeps the draft and snapshot; nothing retries by itself', () => {
		const { d, scan, job } = started();
		let x = applyMutation(d, markRunning(d, job.id)!);
		x = applyMutation(x, failJob(x, job.id, 'Network lost', 1)!);
		expect(x.scans.find((s) => s.id === scan.id)?.status).toBe('failed');
		expect(x.assets.some((a) => a.id === scan.imageAssetId)).toBe(true);
		expect(x.analysisJobs[0]).toMatchObject({ status: 'failed', callCount: 1 });
		// An explicit retry reuses the same snapshot.
		const retry = markRunning(x, job.id)!;
		expect(retry.put?.scans?.[0].imageAssetId).toBe(scan.imageAssetId);
	});

	it('interrupted jobs are marked failed on reopen and never restarted', () => {
		const { d, job } = started();
		const x = applyMutation(d, markRunning(d, job.id)!);
		const recovered = applyMutation(x, recoverInterrupted(x)!);
		expect(recovered.analysisJobs[0]).toMatchObject({ status: 'failed', error: 'Interrupted. Not restarted automatically.' });
		expect(recovered.scans[0].status).toBe('failed');
	});

	it('detections become unresolved observations; invalid boxes are dropped; usage recorded', () => {
		const { d, job, scan } = started();
		let x = applyMutation(d, markRunning(d, job.id)!);
		x = applyMutation(x, completeJob(x, job.id, { detections: [det('lamp'), det('bad', { x: 0.9, y: 0.9, width: 0.5, height: 0.5 })], usage })!);
		expect(x.observations).toHaveLength(1);
		expect(x.observations[0]).toMatchObject({ resolution: 'unresolved', objectId: null, source: 'jev', providerConfidence: null });
		expect(x.analysisJobs[0]).toMatchObject({ status: 'done', callCount: 2 });
		expect(x.scans.find((s) => s.id === scan.id)?.status).toBe('review');
		expect(counts(x).items).toBe(0);
	});

	it('later AI output never changes a confirmed identity', () => {
		const { d, job, scan } = started();
		let x = applyMutation(d, addManualObservation(d, scan.id, box(0.2, 0.2), 'lamp')!);
		x = applyResult(x, createObjectFrom(x, x.observations[0].id, 'Lamp', null));
		const confirmed = structuredClone(x.observations[0]);
		x = applyMutation(x, markRunning(x, job.id)!);
		x = applyMutation(x, completeJob(x, job.id, { detections: [det('vase', box(0.2, 0.2))], usage })!);
		expect(x.observations.find((o) => o.id === confirmed.id)).toEqual(confirmed);
		expect(x.observations).toHaveLength(2);
	});

	it('a compare scan copies the viewpoint reference and needs one', () => {
		const h = homeWithRooms();
		const r = startScan(h.d, { viewpointId: h.doorway, mode: 'compare', image: asset(), provider: 'demo', model: null, demo: true });
		expect(r).toEqual({ error: 'choose a reference scan first' });
	});

	it('finishing the first scan suggests it as reference without setting it', () => {
		const { d, job } = started();
		let x = applyMutation(d, markRunning(d, job.id)!);
		x = applyMutation(x, completeJob(x, job.id, { detections: [], usage })!);
		const f = finishScan(x, x.scans[0].id)!;
		expect(f.suggestReference).toBe(true);
		x = applyMutation(x, f.mutation);
		expect(x.viewpoints.every((v) => v.referenceScanId === null)).toBe(true);
	});
});
