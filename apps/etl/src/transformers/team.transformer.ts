import { z } from 'zod';
import type { ScrapedTeam } from '@sports/shared-types';
import type { UpsertTeamInput } from '@sports/db';
import { slugify } from './slugify.js';

const ScrapedTeamSchema = z.object({
  rawName: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().optional(),
  shortName: z.string().optional(),
  city: z.string().optional(),
  country: z.string().default('ES'),
  logoUrl: z.string().url().optional(),
  sourceId: z.string(),
  sourceRef: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  scrapedAt: z.date(),
});

export interface TeamTransformResult {
  input: UpsertTeamInput;
  warnings: string[];
}

export function transformTeam(
  raw: ScrapedTeam,
  sportId: string
): TeamTransformResult {
  const warnings: string[] = [];

  const parsed = ScrapedTeamSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Dato de equipo inválido: ${parsed.error.message}`);
  }

  const data = parsed.data;
  const slug = data.slug || slugify(data.rawName);

  if (!slug) {
    throw new Error(`No se pudo generar slug para equipo: "${data.rawName}"`);
  }

  // Intentar extraer ciudad del nombre si no viene explícita.
  // Convención habitual: "Club Hockey Vic" → la última palabra suele ser la ciudad.
  // Es heurística — marcar como warning si se infiere.
  let city = data.city;
  if (!city) {
    warnings.push(
      `Ciudad no disponible para equipo "${data.rawName}" — quedará como null. ` +
      `Considerar enriquecer desde fuente secundaria (web del club).`
    );
  }

  return {
    input: {
      sportId,
      name: data.name,
      shortName: data.shortName,
      slug,
      city: city ?? undefined,
      country: data.country,
      logoUrl: data.logoUrl,
      sourceId: data.sourceId,
      sourceRef: data.sourceRef,
      sourceUrl: data.sourceUrl,
      scrapedAt: data.scrapedAt,
    },
    warnings,
  };
}
