<script lang="ts">
	import { onMount } from 'svelte';
	import { exportJsonOnly, exportZip, importZip, type ImportResult } from '#lib/archive/archive.ts';
	import { accessStatus, unlock } from '#lib/providers/live.ts';
	import { app, assetBlob, deleteHome, markExported, replaceHome, setMode } from '#lib/storage/store.svelte.ts';
	import { requestPersistence, storageInfo, type StorageInfo } from '#lib/storage/db.ts';
	import { t } from '#lib/i18n/index.svelte.ts';

	const data = $derived(app.data);
	let info = $state<StorageInfo | null>(null);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let pending = $state<Extract<ImportResult, { ok: true }> | null>(null);
	let importErrors = $state<string[]>([]);
	let exportedBeforeImport = $state(false);
	let confirmDelete = $state(0);
	let access = $state<{ configured: boolean; unlocked: boolean; provider: string | null } | null>(null);
	let code = $state('');
	let codeError = $state(false);

	const usage = $derived.by(() => {
		const jobs = data?.analysisJobs ?? [];
		const cost = jobs.reduce((s, j) => s + (j.usage.reportedCost ?? 0), 0);
		return { jobs: jobs.filter((j) => j.provider !== 'demo').length, requests: jobs.reduce((s, j) => s + j.callCount, 0), cost, anyCost: jobs.some((j) => j.usage.reportedCost !== null) };
	});

	onMount(async () => {
		info = await storageInfo();
		access = await accessStatus();
	});

	function download(bytes: Uint8Array | string, name: string, type: string) {
		const blob = new Blob([bytes as BlobPart], { type });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = name;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
	}

	const stamp = () => new Date().toISOString().slice(0, 10);

	async function doExport() {
		if (!data) return;
		busy = true;
		error = null;
		try {
			const zip = await exportZip(data, async (id) => {
				const b = await assetBlob(id);
				return b ? new Uint8Array(await b.arrayBuffer()) : undefined;
			});
			download(zip, `home-${stamp()}.hometrace.zip`, 'application/zip');
			await markExported();
			exportedBeforeImport = true;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function chooseImport(file: File | undefined) {
		if (!file) return;
		busy = true;
		pending = null;
		importErrors = [];
		const r = await importZip(file);
		busy = false;
		if (r.ok) pending = r;
		else importErrors = r.errors;
	}

	async function confirmImport() {
		if (!pending) return;
		busy = true;
		try {
			await replaceHome(pending.data, pending.images);
			pending = null;
		} catch (e) {
			// The replace runs in one transaction: on failure the previous home is still intact.
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	const mib = (n: number | null) => (n === null ? '—' : `${(n / 1024 / 1024).toFixed(1)} MiB`);
</script>

<h1>{t('data.title')}</h1>

<section class="card stack" aria-labelledby="export-h">
	<h2 id="export-h">{t('data.exportTitle')}</h2>
	<p class="small">{t('data.exportExplain')}</p>
	<p class="notice warn small"><span aria-hidden="true">⚠</span> {t('data.unencrypted')}</p>
	<div class="row">
		<button class="primary" type="button" disabled={!data || busy} onclick={doExport}>⬇ {t('data.exportZip')}</button>
		<button type="button" disabled={!data || busy} onclick={() => data && download(exportJsonOnly(data), `home-${stamp()}.json`, 'application/json')}>
			{t('data.exportJson')}
		</button>
	</div>
	<p class="small muted">{t('home.lastExport')}: {data?.home.lastExportedAt ? new Date(data.home.lastExportedAt).toLocaleString() : t('home.never')}</p>
	<p class="small muted">{t('data.notBackup')}</p>
</section>

<section class="card stack" id="import" aria-labelledby="import-h">
	<h2 id="import-h">{t('data.import')}</h2>
	<p class="small">{t('data.importExplain')}</p>
	<label class="button">
		{t('data.chooseArchive')}
		<input class="visually-hidden" type="file" accept=".zip,application/zip" disabled={busy} onchange={(e) => chooseImport(e.currentTarget.files?.[0])} />
	</label>
	{#if importErrors.length}
		<div class="notice error" role="alert">
			<p>{t('data.importRejected')}</p>
			<ul class="small">{#each importErrors as err, i (i)}<li>{err}</li>{/each}</ul>
		</div>
	{/if}
	{#if pending}
		<div class="notice" role="alertdialog" aria-labelledby="preview-h">
			<p id="preview-h"><strong>{t('data.preview', { name: pending.preview.homeName })}</strong></p>
			<p class="num small">{t('data.previewCounts', pending.preview)}</p>
			{#if data}
				<p class="small">{t('data.replaceWarning')}</p>
				{#if !exportedBeforeImport}<button type="button" onclick={doExport} disabled={busy}>⬇ {t('data.exportFirst')}</button>{/if}
			{/if}
			<div class="row">
				<button class="primary" type="button" disabled={busy} onclick={confirmImport}>{data ? t('data.replace') : t('data.importNow')}</button>
				<button type="button" onclick={() => (pending = null)}>{t('common.cancel')}</button>
			</div>
		</div>
	{/if}
</section>

<section class="card stack" id="analysis" aria-labelledby="analysis-h">
	<h2 id="analysis-h">{t('data.analysisTitle')}</h2>
	<fieldset class="row">
		<legend class="visually-hidden">{t('data.analysisTitle')}</legend>
		<label class="check"><input type="radio" name="mode" checked={app.mode === 'demo'} onchange={() => setMode('demo')} /> ◆ {t('mode.demo')} — {t('data.demoExplain')}</label>
		<label class="check"><input type="radio" name="mode" checked={app.mode === 'live'} onchange={() => setMode('live')} disabled={!access?.unlocked} /> ● {t('mode.live')} — {t('data.liveExplain')}</label>
	</fieldset>
	{#if access && !access.configured}
		<p class="small muted">{t('data.aiNotConfigured')}</p>
	{:else if access && !access.unlocked}
		<form
			class="row"
			onsubmit={async (e) => {
				e.preventDefault();
				codeError = !(await unlock(code));
				if (!codeError) {
					access = await accessStatus();
					code = '';
				}
			}}
		>
			<label class="grow">{t('data.accessCode')}<input type="password" autocomplete="off" bind:value={code} /></label>
			<button type="submit" disabled={!code}>{t('data.unlock')}</button>
		</form>
		{#if codeError}<p class="notice error small" role="alert">{t('data.wrongCode')}</p>{/if}
	{:else if access?.unlocked}
		<p class="small">✓ {t('data.unlocked', { provider: access.provider ?? '' })}</p>
	{/if}
	<p class="small muted num">{t('data.usage', { jobs: usage.jobs, requests: usage.requests, cost: usage.anyCost ? `$${usage.cost.toFixed(4)}` : t('review.costUnknown') })}</p>
</section>

<section class="card stack" aria-labelledby="storage-h">
	<h2 id="storage-h">{t('data.storageTitle')}</h2>
	<p class="small num">{t('data.storageUsage', { used: mib(info?.usage ?? null), quota: mib(info?.quota ?? null) })}</p>
	<p class="small">{info?.persisted ? `✓ ${t('data.persisted')}` : `◌ ${t('data.notPersisted')}`}</p>
	{#if !info?.persisted}<button type="button" onclick={async () => (await requestPersistence(), (info = await storageInfo()))}>{t('data.requestPersistence')}</button>{/if}
</section>

<section class="card stack" aria-labelledby="tools-h">
	<h2 id="tools-h">{t('data.toolsTitle')}</h2>
	<a href="/phase0/annotate">{t('home.annotate.link')}</a>
</section>

{#if data}
	<section class="card stack danger-zone" aria-labelledby="delete-h">
		<h2 id="delete-h">{t('data.deleteTitle')}</h2>
		<p class="small">{t('data.deleteExplain')}</p>
		<div class="row">
			<button type="button" onclick={doExport} disabled={busy}>⬇ {t('data.exportFirst')}</button>
			<button
				class="danger"
				type="button"
				onclick={async () => {
					if (confirmDelete < 1) confirmDelete++;
					else {
						await deleteHome();
						confirmDelete = 0;
					}
				}}
				onblur={() => (confirmDelete = 0)}
			>
				{confirmDelete ? t('data.deleteConfirm', { name: data.home.name }) : t('data.delete')}
			</button>
		</div>
	</section>
{/if}

{#if error}<p class="notice error" role="alert">{error}</p>{/if}

<style>
	section {
		margin-bottom: 16px;
		max-width: 720px;
	}
	h2 {
		margin: 0;
		font-size: 1.2rem;
	}
	fieldset {
		border: none;
		padding: 0;
		margin: 0;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: var(--tap);
		width: 100%;
	}
	label {
		display: grid;
		gap: 4px;
	}
	.grow {
		flex: 1;
	}
	.danger-zone {
		border-color: var(--danger);
	}
</style>
