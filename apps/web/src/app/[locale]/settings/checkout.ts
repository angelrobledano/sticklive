/**
 * Contrato de Checkout Premium (web → API).
 *
 * El paywall ofrece dos productos y el API espera `{ deviceId, product }` con
 * `product` en el catálogo (`annual` | `lifetime`). Se aísla el mapeo en una
 * función pura para fijarlo con tests: un producto equivocado cobraría o
 * concedería un entitlement que no es el elegido.
 *
 * Los importes NO viven aquí: los define el catálogo del API (fuente única
 * server-side) y los muestra Stripe en el Checkout. La web no duplica precios.
 */
export type CheckoutProduct = 'annual' | 'lifetime';

export interface CheckoutPayload {
  deviceId: string;
  product: CheckoutProduct;
}

export function buildCheckoutPayload(deviceId: string, product: CheckoutProduct): CheckoutPayload {
  return { deviceId, product };
}
