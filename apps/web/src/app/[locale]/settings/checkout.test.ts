import { describe, it, expect } from 'vitest';
import { buildCheckoutPayload } from './checkout';

/**
 * El paywall de dos opciones (anual / para siempre) manda el `product` que
 * espera el API de Stripe. Este mapeo es el contrato cliente↔servidor: si un
 * botón enviara el producto equivocado se cobraría (o concedería) lo que no es.
 * Por eso se fija aquí, aislado de la UI y del fetch.
 */
describe('buildCheckoutPayload', () => {
  it('la opción anual manda product "annual"', () => {
    expect(buildCheckoutPayload('dev-1', 'annual')).toEqual({
      deviceId: 'dev-1',
      product: 'annual',
    });
  });

  it('la opción "para siempre" manda product "lifetime"', () => {
    expect(buildCheckoutPayload('dev-2', 'lifetime')).toEqual({
      deviceId: 'dev-2',
      product: 'lifetime',
    });
  });
});
