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
