/**
 * «X B B» → «X B». FECAPA publica a veces la letra del equipo duplicada en
 * las categorías de base; con ella el nombre no casa con ningún equipo y
 * acaba en la cola de resolución. Solo colapsa una letra A-H repetida al final.
 */
export function collapseRepeatedTeamLetter(name: string): string {
  const trimmed = name.replace(/\s+/g, ' ').trim();
  const m = /^(.*\S) ([A-H]) \2$/.exec(trimmed);
  return m ? `${m[1]} ${m[2]}` : name;
}
