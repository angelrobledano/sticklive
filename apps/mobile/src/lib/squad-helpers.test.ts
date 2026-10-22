import { describe, expect, it } from 'vitest';
import { formatSquadPlayerStats, goalsWord } from './squad-helpers';

describe('squad-helpers', () => {
  describe('goalsWord', () => {
    it('singulariza en castellano', () => {
      expect(goalsWord(1, 'es')).toBe('gol');
    });

    it('pluraliza en castellano', () => {
      expect(goalsWord(2, 'es')).toBe('goles');
      expect(goalsWord(12, 'es')).toBe('goles');
    });

    it('singulariza y pluraliza en catalán', () => {
      expect(goalsWord(1, 'ca')).toBe('gol');
      expect(goalsWord(2, 'ca')).toBe('gols');
    });

    it('singulariza y pluraliza en inglés', () => {
      expect(goalsWord(1, 'en')).toBe('goal');
      expect(goalsWord(3, 'en')).toBe('goals');
    });

    it('singulariza y pluraliza en portugués', () => {
      expect(goalsWord(1, 'pt')).toBe('golo');
      expect(goalsWord(4, 'pt')).toBe('golos');
    });

    it('singulariza y pluraliza en francés', () => {
      expect(goalsWord(1, 'fr')).toBe('but');
      expect(goalsWord(2, 'fr')).toBe('buts');
    });

    it('singulariza y pluraliza en italiano', () => {
      expect(goalsWord(1, 'it')).toBe('gol');
      expect(goalsWord(5, 'it')).toBe('gol');
    });
  });

  describe('formatSquadPlayerStats', () => {
    it('detecta cuando un jugador no tiene estadísticas', () => {
      const stats = formatSquadPlayerStats({ goals: 0, blueCards: 0, redCards: 0 }, 'es');
      expect(stats.hasStats).toBe(false);
      expect(stats.goalLabel).toBe('');
      expect(stats.blueCardsCount).toBe(0);
      expect(stats.redCardsCount).toBe(0);
    });

    it('detecta goles con formato adecuado', () => {
      const stats = formatSquadPlayerStats({ goals: 4, blueCards: 0, redCards: 0 }, 'es');
      expect(stats.hasStats).toBe(true);
      expect(stats.goalLabel).toBe('4 goles');
    });

    it('detecta tarjetas azules y rojas sin goles', () => {
      const stats = formatSquadPlayerStats({ goals: 0, blueCards: 2, redCards: 1 }, 'es');
      expect(stats.hasStats).toBe(true);
      expect(stats.goalLabel).toBe('');
      expect(stats.blueCardsCount).toBe(2);
      expect(stats.redCardsCount).toBe(1);
    });

    it('combina goles y tarjetas', () => {
      const stats = formatSquadPlayerStats({ goals: 1, blueCards: 3, redCards: null }, 'ca');
      expect(stats.hasStats).toBe(true);
      expect(stats.goalLabel).toBe('1 gol');
      expect(stats.blueCardsCount).toBe(3);
      expect(stats.redCardsCount).toBe(0);
    });
  });
});
