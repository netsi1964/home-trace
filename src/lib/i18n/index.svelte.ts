import { da } from './da.ts';
import { en, type MessageKey, type Messages } from './en.ts';
import { es } from './es.ts';
import { zh } from './zh.ts';

/**
 * Typed UI strings (PRD-SEC-004). English is the source; a missing key in another locale is a
 * type error. Strings are plain text: interpolated values are never parsed as HTML.
 */

export const LOCALES = { en: 'English', da: 'Dansk', es: 'Español', zh: '中文' } as const;
export type Locale = keyof typeof LOCALES;

const catalogs: Record<Locale, Messages> = { en, da, es, zh };
const STORAGE_KEY = 'hometrace.locale';

export const i18n = $state({ locale: 'en' as Locale });

export function isLocale(v: unknown): v is Locale {
	return typeof v === 'string' && v in LOCALES;
}

export function setLocale(locale: Locale): void {
	i18n.locale = locale;
	try {
		localStorage.setItem(STORAGE_KEY, locale);
	} catch {
		// Storage can be unavailable (private mode); the choice then lasts for this visit only.
	}
	if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

/** Picks the saved locale, then the browser's, then English. Call once in the browser. */
export function initLocale(): void {
	let saved: string | null = null;
	try {
		saved = localStorage.getItem(STORAGE_KEY);
	} catch {
		saved = null;
	}
	const browser = navigator.languages.map((l) => l.slice(0, 2).toLowerCase()).find(isLocale);
	setLocale(isLocale(saved) ? saved : (browser ?? 'en'));
}

export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
	const template = catalogs[i18n.locale][key] ?? en[key];
	return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

export type { MessageKey };
