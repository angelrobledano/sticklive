import { z } from 'zod';
import type { ScrapedCompetition } from '@sports/shared-types';
import type { UpsertCompetitionInput } from '@sports/db';
import { slugify } from './slugify.js';

/**
 * Esquema de validación para datos scrapeados de competición.
 * Zod nos da validación + tipado en tiempo de ejecución, clave cuando
 * los datos vienen de HTML/API externa que puede cambiar sin aviso.
 */
const ScrapedCompetitionSchema = z.object({
  rawName: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().optional(),
  gender: z.enum(['male', 'female', 'mixed', 'unknown']).optional(),
  category: z.string().optional(),
  country: z.string().default('ES'),
  sourceId: z.string(),
  sourceRef: z.string().optional(),
  sourceUrl: z.url().optional(),
  scrapedAt: z.date(),
});

export interface CompetitionTransformResult {
  input: UpsertCompetitionInput;
  warnings: string[];
}

/**
 * Transforma un dato crudo de scraper en un input válido para upsertCompetition.
 *
 * Responsabilidades:
 * - Validar que el dato tiene los campos mínimos
 * - Generar slug si no viene de la fuente
 * - Detectar género/categoría desde el nombre cuando no es explícito
 * - Registrar warnings sin lanzar errores (el ETL debe ser resiliente)
 */
export function transformCompetition(
  raw: ScrapedCompetition,
  sportId: string
): CompetitionTransformResult {
  const warnings: string[] = [];

  const parsed = ScrapedCompetitionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Dato de competición inválido: ${parsed.error.message} — raw: ${JSON.stringify(raw)}`
    );
  }

  const data = parsed.data;

  // Generar slug desde el nombre si la fuente no lo proporciona
  const slug = data.slug || slugify(data.rawName);
  if (!slug) {
    throw new Error(`No se pudo generar slug para competición: "${data.rawName}"`);
  }

  // Inferir género desde el nombre si no viene explícito
  let gender = data.gender;
  if (!gender) {
    const nameLower = data.rawName.toLowerCase();
    if (nameLower.includes('femenin') || nameLower.includes('damas') || nameLower.includes('fem.')) {
      gender = 'female';
    } else if (nameLower.includes('masculin') || nameLower.includes('masc.')) {
      gender = 'male';
    } else {
      // Para hockey patines la mayoría son masculinas, pero no asumimos — dejamos null
      warnings.push(`Género no detectado para "${data.rawName}" — quedará como null`);
    }
  }

  // Inferir categoría desde el nombre
  let category = data.category;
  if (!category) {
    const nameLower = data.rawName.toLowerCase();
    if (nameLower.includes('senior') || nameLower.includes('sénior')) category = 'senior';
    else if (nameLower.includes('juvenil')) category = 'juvenil';
    else if (nameLower.includes('cadete')) category = 'cadete';
    else if (nameLower.includes('infantil')) category = 'infantil';
    else if (nameLower.includes('benjamín') || nameLower.includes('benjamin')) category = 'benjamin';
    else if (nameLower.includes('alevín') || nameLower.includes('alevin')) category = 'alevin';
    else {
      warnings.push(`Categoría no detectada para "${data.rawName}" — quedará como null`);
    }
  }

  return {
    input: {
      sportId,
      name: data.name,
      slug,
      gender,
      category: category ?? undefined,
      country: data.country,
      sourceId: data.sourceId,
      sourceRef: data.sourceRef,
      sourceUrl: data.sourceUrl,
      scrapedAt: data.scrapedAt,
    },
    warnings,
  };
}
