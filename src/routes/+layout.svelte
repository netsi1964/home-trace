<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { i18n, initLocale, isLocale, LOCALES, setLocale, t } from '#lib/i18n/index.svelte.ts';
	import { app, initApp } from '#lib/storage/store.svelte.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	onMount(() => {
		initLocale();
		void initApp();
	});

	const nav = [
		{ href: '/', key: 'nav.home' },
		{ href: '/inventory', key: 'nav.inventory' },
		{ href: '/data', key: 'nav.data' }
	] as const;
</script>

<svelte:head>
	<link rel="icon" href={favicon} type="image/svg+xml" />
	<title>{t('app.name')}</title>
</svelte:head>

<a class="skip visually-hidden" href="#main">{t('app.skip')}</a>

<header>
	<a class="brand" href="/">
		<img src={favicon} alt="" width="32" height="32" />
		<span>{t('app.name')}</span>
	</a>
	<nav aria-label={t('nav.label')}>
		{#each nav as n (n.href)}
			<a href={n.href} aria-current={page.url.pathname === n.href ? 'page' : undefined}>{t(n.key)}</a>
		{/each}
	</nav>
	<div class="row end">
		<a class="badge {app.mode}" href="/data#analysis" title={t('mode.explain')}>
			{app.mode === 'demo' ? `◆ ${t('mode.demo')}` : `● ${t('mode.live')}`}
		</a>
		<label>
			<span class="visually-hidden">{t('app.language')}</span>
			<select
				value={i18n.locale}
				onchange={(e) => {
					const v = e.currentTarget.value;
					if (isLocale(v)) setLocale(v);
				}}
			>
				{#each Object.entries(LOCALES) as [code, name] (code)}
					<option value={code}>{name}</option>
				{/each}
			</select>
		</label>
	</div>
</header>

<main id="main">
	{#if app.storageFull}
		<p class="notice error" role="alert">{t('storage.full')} <a href="/data">{t('storage.fullAction')}</a></p>
	{/if}
	{#if app.loadError}
		<p class="notice error" role="alert">{t('app.loadError')} <code>{app.loadError}</code></p>
	{/if}
	{#if app.ready || page.url.pathname.startsWith('/phase0')}
		{@render children()}
	{:else}
		<p class="muted" aria-live="polite">{t('app.loading')}</p>
	{/if}
</main>

<style>
	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px 16px;
		padding: 8px var(--gutter);
		border-bottom: 1px solid var(--line);
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		min-height: var(--tap);
		text-decoration: none;
		font-size: 1.15rem;
	}

	nav {
		display: flex;
		gap: 4px;
		order: 3;
		width: 100%;
	}

	@media (min-width: 720px) {
		nav {
			order: 0;
			width: auto;
		}
	}

	nav a {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap);
		padding: 0 12px;
		border-radius: var(--radius);
		text-decoration: none;
	}

	nav a[aria-current='page'] {
		background: var(--surface);
		border: 1px solid var(--line);
		text-decoration: underline;
		text-underline-offset: 4px;
	}

	.end select {
		width: auto;
	}

	.badge {
		min-height: 32px;
		text-decoration: none;
	}

	.skip:focus {
		position: static;
		width: auto;
		height: auto;
		clip-path: none;
		padding: 8px var(--gutter);
	}

	main {
		padding: var(--gutter);
		max-width: 1200px;
		margin: 0 auto 80px;
	}
</style>
