<script lang="ts">
	import { goto } from '$app/navigation';
	import { demoHome } from '#lib/inventory/demoHome.ts';
	import { counts, lastSeen, scansOfViewpoint } from '#lib/inventory/queries.ts';
	import { createRoom } from '#lib/inventory/rooms.ts';
	import { t } from '#lib/i18n/index.svelte.ts';
	import { app, apply, createHome, replaceHome, setMode } from '#lib/storage/store.svelte.ts';
	import { link } from '#lib/storage/session.ts';
	import AssetImg from '#lib/components/AssetImg.svelte';

	let homeName = $state('');
	let roomName = $state('');

	const data = $derived(app.data);
	const c = $derived(data ? counts(data) : null);
	const daysSinceExport = $derived(
		data?.home.lastExportedAt ? Math.floor((Date.now() - Date.parse(data.home.lastExportedAt)) / 86_400_000) : null
	);

	async function loadDemo() {
		await replaceHome(demoHome(), new Map());
		setMode('demo');
	}

	async function addRoom(e: SubmitEvent) {
		e.preventDefault();
		if (!data) return;
		const r = createRoom(data, roomName);
		if (r && (await apply(r.mutation))) {
			roomName = '';
			await goto(link('/room', { room: r.room.id }));
		}
	}

	function latestScanAsset(roomId: string): string | null {
		if (!data) return null;
		const vps = data.viewpoints.filter((v) => v.roomId === roomId);
		const scans = vps.flatMap((v) => scansOfViewpoint(data, v.id));
		scans.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
		return scans[0]?.imageAssetId ?? null;
	}
</script>

{#if !data}
	<section class="stack welcome">
		<h1>{t('app.tagline')}</h1>
		<p class="muted">{t('home.intro')}</p>
		<form
			class="card stack"
			onsubmit={(e) => {
				e.preventDefault();
				void createHome(homeName || t('home.defaultName'));
			}}
		>
			<label>
				{t('home.name')}
				<input type="text" bind:value={homeName} placeholder={t('home.defaultName')} maxlength="80" />
			</label>
			<button class="primary" type="submit">{t('home.create')}</button>
		</form>
		<div class="card stack">
			<p>{t('home.demoIntro')}</p>
			<button type="button" onclick={loadDemo}>◆ {t('home.loadDemo')}</button>
		</div>
		<p class="small muted">{t('home.privacy')}</p>
	</section>
{:else}
	<section class="stack">
		<h1>{data.home.name}</h1>
		<dl class="stats">
			<div class="card"><dt>{t('home.items')}</dt><dd class="num">{c?.items}</dd></div>
			<div class="card"><dt>{t('home.unresolved')}</dt><dd class="num">{c?.unresolved}</dd></div>
			<div class="card"><dt>{t('home.rooms')}</dt><dd class="num">{c?.rooms}</dd></div>
			<div class="card">
				<dt>{t('home.lastExport')}</dt>
				<dd>{data.home.lastExportedAt ? new Date(data.home.lastExportedAt).toLocaleDateString() : t('home.never')}</dd>
			</div>
		</dl>

		{#if (c?.scans ?? 0) > 0 && (daysSinceExport === null || daysSinceExport > 14)}
			<p class="notice warn"><span aria-hidden="true">⚠</span> {t('home.exportReminder')} <a href="/data">{t('home.exportNow')}</a></p>
		{/if}

		<h2>{t('home.roomsTitle')}</h2>
		{#if data.rooms.length === 0}
			<p class="muted">{t('home.noRooms')}</p>
		{/if}
		<ul class="list">
			{#each [...data.rooms].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) as room (room.id)}
				{@const vps = data.viewpoints.filter((v) => v.roomId === room.id)}
				{@const items = data.objects.filter((o) => o.mergedIntoId === null && lastSeen(data, o.id)?.room?.id === room.id).length}
				<li>
					<a class="room" href={link('/room', { room: room.id })}>
						<span class="thumb"><AssetImg assetId={latestScanAsset(room.id)} alt="" /></span>
						<span class="grow">
							<strong>{room.name}</strong><br />
							<span class="small muted">{t('home.roomSummary', { viewpoints: vps.length, items })}</span>
						</span>
						<span aria-hidden="true">→</span>
					</a>
				</li>
			{/each}
		</ul>

		<form class="row" onsubmit={addRoom}>
			<label class="grow">
				<span class="visually-hidden">{t('room.name')}</span>
				<input type="text" bind:value={roomName} placeholder={t('home.newRoomPlaceholder')} maxlength="80" />
			</label>
			<button type="submit" disabled={!roomName.trim()}>＋ {t('home.addRoom')}</button>
		</form>
	</section>
{/if}

<style>
	.welcome {
		max-width: 560px;
	}

	h1 {
		font-size: clamp(1.6rem, 6vw, 2.2rem);
		margin: 8px 0;
	}

	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 8px;
		margin: 0;
	}

	.stats dt {
		font-size: 0.85rem;
		color: var(--ink-muted);
	}

	.stats dd {
		margin: 0;
		font-size: 1.5rem;
	}

	.room {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: var(--tap);
		text-decoration: none;
	}

	.grow {
		flex: 1;
		min-width: 0;
	}
</style>
