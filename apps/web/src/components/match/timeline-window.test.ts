import { describe, it, expect } from 'vitest';
import { timelineWindow, keyEvents, TIMELINE_PREVIEW } from './TimelineTab';

/**
 * #366: el tope de render del timeline se extrajo como función pura para fijar
 * que recorta sin alterar el orden y que "ver todos" recupera el timeline entero.
 */

const ev = (i: number) => ({ id: `e${i}` });

describe('timelineWindow', () => {
  it('timeline vacío', () => {
    expect(timelineWindow([], false)).toEqual({ visible: [], hiddenCount: 0 });
  });

  it('por debajo del tope muestra todo y no oculta nada', () => {
    const events = Array.from({ length: 3 }, (_, i) => ev(i));
    const r = timelineWindow(events, false);
    expect(r.visible).toHaveLength(3);
    expect(r.hiddenCount).toBe(0);
  });

  it('justo en el tope no oculta nada', () => {
    const events = Array.from({ length: TIMELINE_PREVIEW }, (_, i) => ev(i));
    expect(timelineWindow(events, false).hiddenCount).toBe(0);
    expect(timelineWindow(events, false).visible).toHaveLength(TIMELINE_PREVIEW);
  });

  it('por encima del tope recorta y cuenta los ocultos, conservando el orden', () => {
    const events = Array.from({ length: TIMELINE_PREVIEW + 7 }, (_, i) => ev(i));
    const r = timelineWindow(events, false);
    expect(r.visible).toHaveLength(TIMELINE_PREVIEW);
    expect(r.hiddenCount).toBe(7);
    expect(r.visible[0]).toEqual(ev(0));
    expect(r.visible[r.visible.length - 1]).toEqual(ev(TIMELINE_PREVIEW - 1));
  });

  it('con "ver todos" muestra el timeline completo', () => {
    const events = Array.from({ length: TIMELINE_PREVIEW + 7 }, (_, i) => ev(i));
    const r = timelineWindow(events, true);
    expect(r.visible).toHaveLength(events.length);
    expect(r.hiddenCount).toBe(0);
  });

  it('admite un límite explícito', () => {
    const events = Array.from({ length: 5 }, (_, i) => ev(i));
    expect(timelineWindow(events, false, 2)).toEqual({
      visible: [ev(0), ev(1)],
      hiddenCount: 3,
    });
  });
});

/** Auditoría UX 03/11/2026 (estructural 3): «Lo importante» sin faltas ni tiempos muertos. */
describe('keyEvents', () => {
  const e = (id: string, eventType: string) => ({ id, eventType });
  it('quita faltas y tiempos muertos y deja lo que cambia el partido', () => {
    const all = [
      e('d', 'period_divider'), e('f', 'foul'), e('g', 'goal'), e('t', 'timeout'),
      e('a', 'accumulated_foul'), e('p', 'penalty'), e('fd', 'direct_foul'), e('r', 'red_card'),
    ];
    expect(keyEvents(all).map((x) => x.id)).toEqual(['d', 'g', 'a', 'p', 'fd', 'r']);
  });
});
