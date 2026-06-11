/**
 * Función de slugificación canónica del proyecto.
 * Usada en transformers para generar slugs consistentes.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // quitar diacríticos
    .replace(/[ñ]/g, 'n')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100); // límite de longitud
}

/**
 * Genera un slug único añadiendo un sufijo si hay colisión.
 * Uso: slugify + counter para entidades con el mismo nombre.
 */
export function uniqueSlug(base: string, existing: Set<string>): string {
  let slug = slugify(base);
  let counter = 2;
  while (existing.has(slug)) {
    slug = `${slugify(base)}-${counter}`;
    counter++;
  }
  return slug;
}
