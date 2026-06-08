'use client';

export function EmptyMonth({ mes, anio }: { mes: number; anio: number }) {
  const meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  const label = `${meses[mes - 1]} ${anio}`;

  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <div className="w-14 h-14 rounded-2xl bg-[#f4f4f5] border border-[#e4e4e7] flex items-center justify-center">
        <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="#0c5cab" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
        </svg>
      </div>
      <div className="text-center">
        <p className="text-[15px] font-semibold text-[#09090b]">Sin datos para {label}</p>
        <p className="text-[13px] text-[#71717a] mt-1">
          No se encontraron ventas para este período.
        </p>
        <p className="text-[12px] text-[#d4d4d8] mt-0.5">
          Cargá el archivo de ventas desde Panel Admin → Cargar Archivos.
        </p>
      </div>
    </div>
  );
}
