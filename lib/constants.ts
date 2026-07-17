export const MONDELEZ_RUBROS = [
  'Beverages',
  'Biscuits',
  'Candies',
  'Chocolates',
  'Dry Mixes',
  'Gums',
] as const;

export function esMondelez(rubro: string): boolean {
  return (MONDELEZ_RUBROS as readonly string[]).includes(rubro);
}

/** Valor que usa el maestro para los vendedores que no dependen de un supervisor. */
export const SIN_SUPERVISOR = 'SIN SUPERVISOR';

/** El maestro trae 'SIN SUPERVISOR'; vacío/null se tratan igual por las dudas. */
export function tieneSupervisor(supervisor: string | null | undefined): boolean {
  const s = (supervisor ?? '').trim().toUpperCase();
  return s !== '' && s !== SIN_SUPERVISOR;
}
