/**
 * Control SEO programado (F6, §15): sitemap, canonical y OG.
 *
 * Toma una muestra determinista del sitemap, pide cada URL con el UA de
 * Googlebot y falla (exit 1) si una ficha del sitemap redirige, no es 200, no
 * tiene title/canonical en el `<head>`, declara un canonical ajeno o lleva
 * `noindex`. Después comprueba una muestra de OG: 200, PNG y < 2 s.
 *
 * No escribe nada. Se ejecuta en el workflow `seo-check.yml` (diario) y a mano:
 *   npx tsx apps/web/scripts/seo-check.ts --base=https://sticklive.eu
 */
import {
  GOOGLEBOT_SMARTPHONE_UA,
  analyzeHtml,
  parseSitemapLocs,
  sampleByType,
} from '../src/lib/seo-crawl';
import { ogCheckIssues, pageCheckIssues } from '../src/lib/seo-check';

interface Options {
  base: string;
  perType: number;
  ogSamples: number;
  timeoutMs: number;
}

function parseArgs(argv: string[]): Options {
  const value = (name: string): string | null => {
    const prefix = `--${name}=`;
    const arg = argv.find((item) => item.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : null;
  };
  const number = (name: string, fallback: number): number => {
    const raw = value(name);
    if (raw === null) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--${name} inválido: ${raw}`);
    return Math.floor(parsed);
  };
  return {
    base: (value('base') ?? 'https://sticklive.eu').replace(/\/+$/, ''),
    perType: number('per-type', 3),
    ogSamples: number('og-samples', 5),
    timeoutMs: number('timeout', 15_000),
  };
}

async function fetchWithTimeout(url: string, timeoutMs: number, redirect: RequestRedirect): Promise<Response> {
  return fetch(url, {
    headers: { 'user-agent': GOOGLEBOT_SMARTPHONE_UA, accept: 'text/html,application/xml,*/*' },
    redirect,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function sitemapUrls(base: string, timeoutMs: number): Promise<string[]> {
  const index = await fetchWithTimeout(`${base}/sitemap-index.xml`, timeoutMs, 'follow');
  if (!index.ok) throw new Error(`sitemap-index.xml → HTTP ${index.status}`);
  const sections = parseSitemapLocs(await index.text()).map((item) => new URL(item.url, base).toString());
  if (sections.length === 0) throw new Error('el índice del sitemap no declara secciones');

  const urls: string[] = [];
  for (const section of sections) {
    const res = await fetchWithTimeout(section, timeoutMs, 'follow');
    if (!res.ok) throw new Error(`${section} → HTTP ${res.status}`);
    urls.push(...parseSitemapLocs(await res.text()).map((item) => new URL(item.url, base).toString()));
  }
  return urls;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const all = await sitemapUrls(options.base, options.timeoutMs);
  const sample = sampleByType(all, options.perType);
  console.log(`Sitemap: ${all.length} URLs · muestra: ${sample.length}`);

  const issues: Array<{ where: string; issue: string }> = [];
  const ogTargets: string[] = [];

  for (const url of sample) {
    try {
      const res = await fetchWithTimeout(url, options.timeoutMs, 'manual');
      if (res.status >= 300 && res.status < 400) {
        issues.push({ where: url, issue: `redirige (${res.status} → ${res.headers.get('location') ?? '?'})` });
        continue;
      }
      if (res.status !== 200) {
        issues.push({ where: url, issue: `HTTP ${res.status}` });
        continue;
      }
      const html = await res.text();
      const facts = analyzeHtml(html);
      for (const issue of pageCheckIssues(facts, url)) issues.push({ where: url, issue });
      if (facts.ogImage) ogTargets.push(facts.ogImage);
    } catch (error) {
      issues.push({ where: url, issue: error instanceof Error ? error.message : String(error) });
    }
  }

  for (const og of ogTargets.slice(0, options.ogSamples)) {
    const started = performance.now();
    try {
      const res = await fetchWithTimeout(og, options.timeoutMs, 'follow');
      await res.arrayBuffer();
      for (const issue of ogCheckIssues({
        status: res.status,
        contentType: res.headers.get('content-type'),
        ms: Math.round(performance.now() - started),
      })) {
        issues.push({ where: og, issue });
      }
    } catch (error) {
      issues.push({ where: og, issue: error instanceof Error ? error.message : String(error) });
    }
  }

  if (issues.length === 0) {
    console.log(`✅ ${sample.length} fichas y ${Math.min(ogTargets.length, options.ogSamples)} OG sin incidencias`);
    return;
  }

  for (const { where, issue } of issues) console.error(`❌ ${where}: ${issue}`);
  console.error(`\n${issues.length} incidencia(s) en ${sample.length} fichas`);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`seo-check: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
