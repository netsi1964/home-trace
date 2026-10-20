<script lang="ts">
	import { page } from '$app/state';
	import { apply, app } from '#lib/storage/store.svelte.ts';
	import { link, readSession } from '#lib/storage/session.ts';
	import { createViewpoint, renameRoom, renameViewpoint, setReference } from '#lib/inventory/rooms.ts';
	import { observationsOfScan, scansOfViewpoint } from '#lib/inventory/queries.ts';
	import { t } from '#lib/i18n/index.svelte.ts';
	import AssetImg from '#lib/components/AssetImg.svelte';
	import NotOnDevice from '#lib/components/NotOnDevice.svelte';

	const params = $derived(readSession(page.url));
	const data = $derived(app.data);
	const room = $derived(data?.rooms.find((r) => r.id === params.room));
	const viewpoints = $derived(data && room ? data.viewpoints.filter((v) => v.roomId === room.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : []);

	let newViewpoint = $state('');
	let editingRoom = $state(false);
	let roomName = $state('');
	let editingVp = $state<string | null>(null);
	let vpName = $state('');

	async function addViewpoint(e: SubmitEvent) {
		e.preventDefault();
		if (!data || !room) return;
		const r = createViewpoint(data, room.id, newViewpoint);
		if (r && (await apply(r.mutation))) newViewpoint = '';
	}

	const statusIcon: Record<string, string> = { draft: '…', analyzing: '…', review: '✎', complete: '✓', failed: '⚠', cancelled: '✕' };
</script>

{#if !data || !room}
	<NotOnDevice />
{:else}
	<p><a href="/">← {t('nav.home')}</a></p>
	{#if editingRoom}
		<form
			class="row"
			onsubmit={async (e) => {
				e.preventDefault();
				if (await apply(renameRoom(data, room.id, roomName))) editingRoom = false;
			}}
		>
			<label class="grow"><span class="visually-hidden">{t('room.name')}</span><input type="text" bind:value={roomName} maxlength="80" /></label>
			<button class="primary" type="submit">{t('common.save')}</button>
			<button type="button" onclick={() => (editingRoom = false)}>{t('common.cancel')}</button>
		</form>
	{:else}
		<div class="row">
			<h1>{room.name}</h1>
			<button type="button" onclick={() => ((roomName = room.name), (editingRoom = true))}>✎ {t('common.rename')}</button>
		</div>
	{/if}

	<h2>{t('room.viewpoints')}</h2>
	{#if viewpoints.length === 0}<p class="muted">{t('room.noViewpoints')}</p>{/if}

	<ul class="list">
		{#each viewpoints as vp (vp.id)}
			{@const scans = scansOfViewpoint(data, vp.id)}
			{@const ref = scans.find((s) => s.id === vp.referenceScanId)}
			<li class="stack">
				<div class="row">
					<span class="thumb"><AssetImg assetId={(ref ?? scans[0])?.imageAssetId} alt="" /></span>
					<div class="grow">
						{#if editingVp === vp.id}
							<form
								class="row"
								onsubmit={async (e) => {
									e.preventDefault();
									if (await apply(renameViewpoint(data, vp.id, vpName))) editingVp = null;
								}}
							>
								<label class="grow"><span class="visually-hidden">{t('room.viewpointName')}</span><input type="text" bind:value={vpName} maxlength="80" /></label>
								<button class="primary" type="submit">{t('common.save')}</button>
								<button type="button" onclick={() => (editingVp = null)}>{t('common.cancel')}</button>
							</form>
						{:else}
							<strong>{vp.name}</strong>
							<button type="button" class="link" onclick={() => ((vpName = vp.name), (editingVp = vp.id))}
								>✎<span class="visually-hidden">{t('common.rename')}</span></button
							><br />
						{/if}
						<span class="small muted">
							{t('room.scanCount', { n: scans.length })} ·
							{ref ? t('room.referenceFrom', { date: new Date(ref.capturedAt).toLocaleDateString() }) : t('room.noReference')}
						</span>
					</div>
				</div>
				<div class="row">
					<a class="button primary" href={link('/scan', { room: room.id, viewpoint: vp.id, mode: 'register' })}>📷 {t('mode.register')}</a>
					{#if ref}
						<a class="button" href={link('/scan', { room: room.id, viewpoint: vp.id, mode: 'compare', reference: ref.id })}>⧉ {t('mode.compare')}</a>
					{:else}
						<span class="small muted">{t('room.compareNeedsReference')}</span>
					{/if}
				</div>
				{#if scans.length}
					<details>
						<summary>{t('room.history')}</summary>
						<ol class="list history">
							{#each scans as s (s.id)}
								{@const n = observationsOfScan(data, s.id).filter((o) => o.resolution !== 'ignored').length}
								<li class="row">
									<span class="thumb"><AssetImg assetId={s.imageAssetId} alt="" /></span>
									<span class="grow small">
										<span aria-hidden="true">{statusIcon[s.status]}</span>
										{new Date(s.capturedAt).toLocaleString()} · {t(`scan.status.${s.status}`)} · {t(`mode.${s.mode}`)} · {t('room.objectsN', { n })}
										{#if s.demo}<span class="badge demo">◆ {t('mode.demo')}</span>{/if}
										{#if s.id === vp.referenceScanId}<strong>· ★ {t('room.reference')}</strong>{/if}
									</span>
									<a class="button" href={link(s.mode === 'compare' && s.status !== 'review' ? '/compare' : '/review', { session: s.id })}>{t('common.open')}</a>
									{#if (s.status === 'review' || s.status === 'complete') && s.id !== vp.referenceScanId}
										<button type="button" onclick={() => apply(setReference(data, vp.id, s.id))}>★ {t('room.useAsReference')}</button>
									{/if}
								</li>
							{/each}
						</ol>
					</details>
				{/if}
			</li>
		{/each}
	</ul>

	<form class="row add" onsubmit={addViewpoint}>
		<label class="grow"><span class="visually-hidden">{t('room.viewpointName')}</span>
			<input type="text" bind:value={newViewpoint} placeholder={t('room.newViewpointPlaceholder')} maxlength="80" />
		</label>
		<button type="submit" disabled={!newViewpoint.trim()}>＋ {t('room.newViewpoint')}</button>
	</form>
{/if}

<style>
	.grow {
		flex: 1;
		min-width: 0;
	}
	.history .thumb {
		width: 48px;
		height: 36px;
	}
	.link {
		min-height: 32px;
		min-width: 32px;
		padding: 0 6px;
		border: none;
		background: transparent;
	}
	.add {
		margin-top: 16px;
	}
	h1 {
		margin: 8px 0;
	}
</style>
