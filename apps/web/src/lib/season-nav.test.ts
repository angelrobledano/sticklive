import { describe, it, expect } from 'vitest';
import { previousSeason } from './season-nav';

const seasons = [
  { id: 's26', name: '2026/27' },
  { id: 's25', name: '2025/26' },
  { id: 's24', name: '2024/25' },
];

describe('previousSeason', () => {
  it('devuelve la temporada inmediatamente anterior', () => {
    expect(previousSeason(seasons, 's26')?.id).toBe('s25');
    expect(previousSeason(seasons, 's25')?.id).toBe('s24');
  });

  it('devuelve null en la más antigua o si la seleccionada no está', () => {
    expect(previousSeason(seasons, 's24')).toBeNull();
    expect(previousSeason(seasons, 'desconocida')).toBeNull();
  });
});
