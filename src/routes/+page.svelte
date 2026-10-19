<script lang="ts">
	import { t } from '#lib/i18n/index.svelte.ts';
</script>

<section class="intro">
	<h1>{t('app.tagline')}</h1>
	<p class="status">{t('app.status')}</p>
</section>

<section class="card">
	<h2>{t('home.annotate.link')}</h2>
	<p>{t('home.annotate.description')}</p>
	<a class="button primary" href="/phase0/annotate">{t('home.annotate.link')}</a>
</section>

<style>
	.intro h1 {
		font-size: clamp(1.6rem, 6vw, 2.4rem);
		margin: 16px 0 8px;
	}

	.status {
		color: var(--ink-muted);
		margin-top: 0;
	}

	.card {
		margin-top: 24px;
		padding: var(--gutter);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
		max-width: 560px;
	}

	.card h2 {
		margin-top: 0;
		font-size: 1.25rem;
	}
</style>
