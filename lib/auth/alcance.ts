import type { Rol } from '@/lib/types';

/** Lo mínimo que hace falta para decidir el alcance de lectura. */
export interface PerfilAlcance {
  rol: Rol;
  ve_empresa?: boolean | null;
}

/**
 * ¿Este usuario ve los datos de toda la empresa?
 *
 * Es SOLO para lectura: qué números puede mirar (Total Empresa, mapa completo,
 * consolidado de todos los equipos). No decide nada de escritura — subir
 * archivos, borrar meses, editar metas y gestionar usuarios siguen pidiendo
 * `rol === 'admin'` explícitamente en cada guard.
 *
 * Ojo al usarlo: si estás por permitir una acción que MODIFICA datos, esta no
 * es la función que buscás.
 */
export function veTodaLaEmpresa(perfil: PerfilAlcance | null | undefined): boolean {
  if (!perfil) return false;
  return perfil.rol === 'admin' || perfil.ve_empresa === true;
}

/** Campos de `profiles` que hay que traer para poder resolver el alcance. */
export const CAMPOS_ALCANCE = 'rol, ve_empresa' as const;
