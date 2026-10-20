<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { cameraErrorCode, startCamera, stopCamera, type CameraError } from '#lib/camera/camera.ts';
	import { frameFromFile, frameFromVideo, type Frame } from '#lib/camera/image.ts';
	import { createScan, cancelRunning, runJob } from '#lib/inventory/runner.ts';
	import { demoPhotos } from '#lib/providers/demo.ts';
	import type { LiveFailure } from '#lib/providers/live.ts';
	import { app } from '#lib/storage/store.svelte.ts';
	import { link, readSession } from '#lib/storage/session.ts';
	import { t } from '#lib/i18n/index.svelte.ts';
	import AssetImg from '#lib/components/AssetImg.svelte';
	import NotOnDevice from '#lib/components/NotOnDevice.svelte';

	const params = $derived(readSession(page.url));
	const data = $derived(app.data);
	const viewpoint = $derived(data?.viewpoints.find((v) => v.id === params.viewpoint));
	const room = $derived(data?.rooms.find((r) => r.id === viewpoint?.roomId));
	const mode = $derived(params.mode ?? 'register');
	const reference = $derived(mode === 'compare' && viewpoint?.referenceScanId ? data?.scans.find((s) => s.id === viewpoint.referenceScanId) : undefined);
	const referenceAsset = $derived(reference ? data?.assets.find((a) => a.id === reference.imageAssetId) : undefined);

	let video = $state<HTMLVideoElement>();
	let stream: MediaStream | null = null;
	let cameraError = $state<CameraError | null>(null);
	let cameraReady = $state(false);
	let opacity = $state(40);
	let busy = $state(false);
	let frozen = $state<string | null>(null);
	let jobId = $state<string | null>(null);
	let failure = $state<{ message: string; kind: LiveFailure | 'error' } | null>(null);
	let consentNeeded = $state(false);

	const CONSENT_KEY = 'hometrace.liveConsent';
	const hasConsent = () => {
		try {
			return localStorage.getItem(CONSENT_KEY) === 'yes';
		} catch {
			return false;
		}
	};

	onMount(async () => {
		if (!video) return;
		try {
			stream = await startCamera(video);
			cameraReady = true;
		} catch (e) {
			cameraError = cameraErrorCode(e);
		}
	});
	onDestroy(() => {
		stopCamera(stream);
		if (frozen) URL.revokeObjectURL(frozen);
	});

	async function scan(getFrame: () => Promise<Frame>, demoFixtureId: string | null = null) {
		if (busy || !viewpoint) return; // double tap = one job (T12)
		if (app.mode === 'live' && !hasConsent()) {
			consentNeeded = true;
			return;
		}
		busy = true;
		failure = null;
		try {
			const frame = await getFrame();
			frozen = URL.createObjectURL(frame.blob);
			stopCamera(stream);
			stream = null;
			const started = await createScan({ viewpointId: viewpoint.id, mode, frame, analysis: app.mode, demo: app.mode === 'demo' });
			jobId = started.job.id;
			await analyse(started.scan.id, demoFixtureId);
		} catch (e) {
			failure = { message: e instanceof Error && e.message === 'storage-full' ? t('storage.full') : e instanceof Error ? e.message : String(e), kind: 'error' };
			busy = false;
		}
	}

	let lastScanId = $state<string | null>(null);
	let lastFixture: string | null = null;

	async function analyse(scanId: string, demoFixtureId: string | null) {
		if (!jobId) return;
		lastScanId = scanId;
		lastFixture = demoFixtureId;
		busy = true;
		const r = await runJob(jobId, { analysis: app.mode, demoFixtureId });
		busy = false;
		if (r.ok) await goto(link('/review', { session: scanId }));
		else failure = { message: r.error.message, kind: r.error.kind };
	}
</script>

{#if !data || !viewpoint || !room}
	<NotOnDevice />
{:else}
	<p><a href={link('/room', { room: room.id })}>← {room.name}</a></p>

	<div class="grid-2">
		<div class="stack">
			<div class="stage" style:aspect-ratio={referenceAsset ? `${referenceAsset.width} / ${referenceAsset.height}` : '4 / 3'}>
				<!-- svelte-ignore a11y_media_has_caption -->
				<video bind:this={video} playsinline muted aria-label={t('scan.preview')} hidden={!!frozen}></video>
				{#if frozen}
					<img src={frozen} alt={t('scan.frozen')} />
				{:else if reference && cameraReady}
					<!-- The overlay is a separate layer; captures are drawn from the video only (PRD-FEAT-002.3). -->
					<div class="overlay" style:opacity={opacity / 100} aria-hidden="true">
						<AssetImg assetId={reference.imageAssetId} alt="" />
					</div>
				{/if}
				{#if !cameraReady && !frozen}
					<div class="camera-msg">
						{#if cameraError}
							<p role="alert">{t(`camera.error.${cameraError}`)}</p>
						{:else}
							<p aria-live="polite">{t('camera.starting')}</p>
						{/if}
					</div>
				{/if}
			</div>

			{#if reference && !frozen}
				<p class="small">{t('overlay.align')}</p>
				<label class="slider">
					<span>{t('overlay.opacity')}</span>
					<input type="range" min="0" max="80" step="5" bind:value={opacity} aria-valuetext="{opacity} %" />
					<span class="num" aria-hidden="true">{opacity} %</span>
				</label>
			{/if}
		</div>

		<aside class="stack">
			<div class="card stack">
				<div>
					<strong>{room.name}</strong> · {viewpoint.name}<br />
					<span class="small muted">{t(`mode.${mode}`)}{reference ? ` · ${t('scan.referenceFrom', { date: new Date(reference.capturedAt).toLocaleDateString() })}` : ''}</span>
					{#if app.mode === 'demo'}<span class="badge demo">◆ {t('mode.demo')}</span>{/if}
				</div>

				{#if consentNeeded}
					<div class="notice" role="alertdialog" aria-labelledby="consent-title">
						<p id="consent-title"><strong>{t('consent.title')}</strong></p>
						<p class="small">{t('consent.text')}</p>
						<div class="row">
							<button
								class="primary"
								type="button"
								onclick={() => {
									try {
										localStorage.setItem(CONSENT_KEY, 'yes');
									} catch {
										/* asked again next time */
									}
									consentNeeded = false;
								}}>{t('consent.accept')}</button
							>
							<a class="button" href="/data#analysis">{t('consent.useDemo')}</a>
						</div>
					</div>
				{/if}

				{#if !frozen}
					<button class="primary big" type="button" disabled={busy || !cameraReady} onclick={() => scan(() => frameFromVideo(video!))}>
						{mode === 'compare' ? t('scan.ready') : t('scan.scan')}
					</button>
					<label class="button">
						{t('scan.choosePhoto')}
						<input
							class="visually-hidden"
							type="file"
							accept="image/jpeg,image/png,image/webp,image/heic"
							disabled={busy}
							onchange={(e) => {
								const f = e.currentTarget.files?.[0];
								if (f) void scan(() => frameFromFile(f));
							}}
						/>
					</label>
				{/if}

				{#if busy}
					<p aria-live="polite">⏳ {app.mode === 'live' ? t('scan.analysing') : t('scan.saving')}</p>
					{#if jobId && app.mode === 'live'}
						<button type="button" onclick={() => cancelRunning(jobId!)}>{t('scan.cancel')}</button>
						<p class="small muted">{t('scan.cancelNote')}</p>
					{/if}
				{/if}

				{#if failure}
					<div class="notice error" role="alert">
						<p>{t(`scan.fail.${failure.kind}`)}</p>
						<p class="small muted"><code>{failure.message}</code></p>
						{#if lastScanId}
							<div class="row">
								<button
									type="button"
									onclick={() => {
										failure = null;
										void analyse(lastScanId!, lastFixture);
									}}>↻ {t('scan.retry')}</button
								>
								<a class="button" href={link('/review', { session: lastScanId })}>{t('scan.reviewManually')}</a>
							</div>
							{#if app.mode === 'live'}<p class="small muted">{t('scan.retryBilling')}</p>{/if}
						{/if}
					</div>
				{/if}
			</div>

			{#if app.mode === 'demo' && !frozen}
				<div class="card stack">
					<p class="small">◆ {t('scan.demoPhotos')}</p>
					<div class="demo-grid">
						{#each demoPhotos() as p (p.id)}
							<button
								type="button"
								class="demo-photo"
								disabled={busy}
								onclick={() =>
									scan(async () => {
										const blob = await (await fetch(p.url)).blob();
										return frameFromFile(blob);
									}, p.id)}
							>
								<img src={p.url} alt="" />
								<span class="small">{p.room} · {p.viewpoint}</span>
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</aside>
	</div>
{/if}

<style>
	.stage {
		position: relative;
		width: 100%;
		background: #000;
		border-radius: 8px;
		overflow: hidden;
	}
	video,
	.stage > img,
	.overlay {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.overlay :global(img) {
		object-fit: contain;
	}
	.camera-msg {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		padding: var(--gutter);
		color: #fff;
		text-align: center;
	}
	.slider {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 12px;
	}
	.slider input {
		min-height: var(--tap);
	}
	.big {
		min-height: 64px;
		font-size: 1.2rem;
	}
	.demo-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 8px;
	}
	.demo-photo {
		display: grid;
		gap: 4px;
		padding: 6px;
		height: auto;
		text-align: left;
	}
	.demo-photo img {
		width: 100%;
		border-radius: 4px;
	}
</style>
