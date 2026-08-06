import Link from 'next/link';

/**
 * Pantalla terminal para un supervisor sin equipo asignado.
 *
 * Sin esto las páginas de equipo redirigían a `/dashboard/<algo>/` (segmento
 * vacío), que vuelve al índice, que vuelve a redirigir: bucle infinito de
 * redirects en el navegador. Mejor decir qué pasa y quién lo arregla.
 */
export function SinEquipo() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <div className="w-14 h-14 rounded-2xl bg-[#f4f4f5] border border-[#e4e4e7] flex items-center justify-center">
        <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="#0c5cab" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72M18 18.72V14.25M6 18.72a9.094 9.094 0 01-3.741-.479 3 3 0 014.682-2.72M6 18.72V14.25m6 4.47v-3.75m0 0a3 3 0 100-6 3 3 0 000 6z" />
        </svg>
      </div>
      <div className="text-center max-w-md">
        <p className="text-[15px] font-semibold text-[#09090b]">Tu usuario no tiene equipo asignado</p>
        <p className="text-[13px] text-[#71717a] mt-1">
          Sin equipo no hay consolidado que mostrar. Pedile a un administrador que
          te asigne uno desde Configuración → Usuarios.
        </p>
        <Link
          href="/perfil"
          className="inline-block mt-4 px-3 py-1.5 text-[13px] font-medium rounded-[8px] border border-[#e4e4e7] bg-white text-[#0c5cab] hover:border-[rgba(12,92,171,0.4)] transition-colors"
        >
          Ir a mi perfil
        </Link>
      </div>
    </div>
  );
}
