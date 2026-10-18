/**
 * Reglas del control SEO programado (F6, §15).
 *
 * Son funciones puras para poder probarlas sin red; el CLI
 * (`apps/web/scripts/seo-check.ts`) las aplica a una muestra del sitemap.
 */
import { canonicalMatches, type PageFacts } from './seo-crawl';

/** Motivos por los que una URL del sitemap no es una ficha sana. */
export function pageCheckIssues(facts: PageFacts, url: string): string[] {
  const issues: string[] = [];
  if (!facts.title) issues.push('sin <title>');
  else if (!facts.titleInHead) issues.push('title fuera del <head>');
  if (!facts.canonical) issues.push('sin canonical');
  else if (!facts.canonicalInHead) issues.push('canonical fuera del <head>');
  else if (!canonicalMatches(facts.canonical, url)) {
    issues.push(`canonical no auto-referente (${facts.canonical})`);
  }
  if (facts.noindex) issues.push('noindex en una URL del sitemap');
  return issues;
}

export interface OgCheckResult {
  status: number;
  contentType: string | null;
  ms: number;
}

/** Motivos por los que una OG no sirve para compartir. */
export function ogCheckIssues(result: OgCheckResult, maxMs = 2000): string[] {
  const issues: string[] = [];
  if (result.status !== 200) issues.push(`OG HTTP ${result.status}`);
  if (!(result.contentType ?? '').toLowerCase().startsWith('image/png')) {
    issues.push(`OG no es PNG (${result.contentType ?? 'sin content-type'})`);
  }
  if (result.ms > maxMs) issues.push(`OG lenta (${result.ms} ms > ${maxMs} ms)`);
  return issues;
}
