'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Rol } from '@/lib/types';

export interface SupervisorLink {
  equipo: string;
}

interface SidebarProps {
  rol: Rol;
  nombre: string | null;
  vendedorNombre: string | null;
  supervisores?: SupervisorLink[];
  diasLaborables?: number;
  diasTrabajados?: number;
}

const ChartIcon = () => (
  <svg width="15" height="15" fill="currentColor" viewBox="0 0 20 20">
    <path d="M15.5 2A1.5 1.5 0 0014 3.5v13a1.5 1.5 0 003 0v-13A1.5 1.5 0 0015.5 2zM9.5 6A1.5 1.5 0 008 7.5v9a1.5 1.5 0 003 0v-9A1.5 1.5 0 009.5 6zM3.5 10A1.5 1.5 0 002 11.5v5a1.5 1.5 0 003 0v-5A1.5 1.5 0 003.5 10z"/>
  </svg>
);
const PersonIcon = () => (
  <svg width="15" height="15" fill="currentColor" viewBox="0 0 20 20">
    <path d="M10 8a3 3 0 100-6 3 3 0 000 6zM3.465 14.493a1.23 1.23 0 00.41 1.412A9.957 9.957 0 0010 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 00-13.074.003z"/>
  </svg>
);
const SignOutIcon = () => (
  <svg width="13" height="13" fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M3 4.25A2.25 2.25 0 015.25 2h5.5A2.25 2.25 0 0113 4.25v2a.75.75 0 01-1.5 0v-2a.75.75 0 00-.75-.75h-5.5a.75.75 0 00-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 00.75-.75v-2a.75.75 0 011.5 0v2A2.25 2.25 0 0110.75 18h-5.5A2.25 2.25 0 013 15.75V4.25zM6.75 10a.75.75 0 000 1.5h7.086l-1.293 1.293a.75.75 0 101.06 1.06l2.5-2.5a.75.75 0 000-1.06l-2.5-2.5a.75.75 0 10-1.06 1.06l1.293 1.293H6.75z" clipRule="evenodd"/>
  </svg>
);
const GearIcon = () => (
  <svg width="15" height="15" fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.331 1.652a6.993 6.993 0 011.929 1.115l1.598-.54a1 1 0 011.186.447l1.18 2.044a1 1 0 01-.205 1.251l-1.267 1.113a7.047 7.047 0 010 2.228l1.267 1.113a1 1 0 01.205 1.251l-1.18 2.044a1 1 0 01-1.186.447l-1.598-.54a6.993 6.993 0 01-1.929 1.115l-.33 1.652a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.331-1.652a6.993 6.993 0 01-1.929-1.115l-1.598.54a1 1 0 01-1.186-.447l-1.18-2.044a1 1 0 01.205-1.251l1.267-1.113a7.047 7.047 0 010-2.228L1.821 7.773a1 1 0 01-.205-1.251l1.18-2.044a1 1 0 011.186-.447l1.598.54A6.993 6.993 0 017.51 3.456l.33-1.652zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd"/>
  </svg>
);
const TargetIcon = () => (
  <svg width="15" height="15" fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm0-2a6 6 0 100-12 6 6 0 000 12zm0-2a4 4 0 100-8 4 4 0 000 8zm0-2a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd"/>
  </svg>
);
const MapPinIcon = () => (
  <svg width="15" height="15" fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M9.69 18.933l.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 00.281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 103 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 002.273 1.765 11.842 11.842 0 00.976.544l.062.029.018.008.006.003zM10 11.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" clipRule="evenodd"/>
  </svg>
);

const ConsolidadoIcon = () => (
  <svg width="15" height="15" fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 6a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zm0 6a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2z" clipRule="evenodd"/>
  </svg>
);

const ProductoIcon = () => (
  <svg width="15" height="15" fill="currentColor" viewBox="0 0 20 20">
    <path d="M10 2a1 1 0 00-.5.13l-6 3.5A1 1 0 003 6.5v7a1 1 0 00.5.87l6 3.5a1 1 0 001 0l6-3.5a1 1 0 00.5-.87v-7a1 1 0 00-.5-.87l-6-3.5A1 1 0 0010 2zm0 2.15L14.5 6.8 10 9.42 5.5 6.8 10 4.15zM5 8.5l4 2.33v4.67l-4-2.33V8.5zm6 7v-4.67l4-2.33v4.67l-4 2.33z"/>
  </svg>
);

// Cuadrícula con un sector marcado — los cuadrantes de Planificación.
const CuadranteIcon = () => (
  <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M3 3h6v6H3V3zm0 8h6v6H3v-6zm8 0h6v6h-6v-6z" clipRule="evenodd" opacity="0.45"/>
    <path fillRule="evenodd" d="M11 3h6v6h-6V3z" clipRule="evenodd"/>
  </svg>
);

const SparkIcon = () => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
    <path d="M10 1.5l1.6 4.1 4.4 1.4-4.4 1.4L10 12.5 8.4 8.4 4 7l4.4-1.4L10 1.5zM4.5 12l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z"/>
  </svg>
);

function buildNav(rol: Rol, vendedorNombre: string | null, supervisores: SupervisorLink[]) {
  const items: { href: string; label: string; icon: React.ReactNode }[] = [];

  if (rol === 'admin') {
    items.push({ href: '/dashboard/total', label: 'Total Empresa', icon: <ChartIcon /> });
    items.push({ href: '/mapa',            label: 'Mapa de PDVs',  icon: <MapPinIcon /> });
    items.push({ href: '/planificacion',   label: 'Planificación', icon: <CuadranteIcon /> });

    if (supervisores.length > 0) {
      items.push({ href: '/dashboard/consolidado',           label: 'Consolidado',  icon: <ConsolidadoIcon /> });
      items.push({ href: '/dashboard/consolidado-productos', label: 'Por producto', icon: <ProductoIcon /> });
    }

    items.push({ href: '/admin/panel',    label: 'Configuración',   icon: <GearIcon /> });
  }

  if (rol === 'supervisor' && vendedorNombre) {
    items.push({ href: `/dashboard/supervisor/${encodeURIComponent(vendedorNombre)}`, label: 'Mi Equipo', icon: <ChartIcon /> });
    items.push({ href: `/dashboard/consolidado/${encodeURIComponent(vendedorNombre)}`, label: 'Consolidado',  icon: <ConsolidadoIcon /> });
    items.push({ href: `/dashboard/consolidado-productos/${encodeURIComponent(vendedorNombre)}`, label: 'Por producto', icon: <ProductoIcon /> });
    items.push({ href: '/admin/metas-ccc', label: 'Metas del equipo', icon: <TargetIcon /> });
    items.push({ href: '/mapa',            label: 'Mapa de PDVs',    icon: <MapPinIcon /> });
    items.push({ href: '/planificacion',   label: 'Planificación',   icon: <CuadranteIcon /> });
  }

  if (rol === 'vendedor' && vendedorNombre) {
    items.push({ href: `/dashboard/vendedor/${encodeURIComponent(vendedorNombre)}`, label: 'Mi Dashboard', icon: <PersonIcon /> });
    items.push({ href: '/mapa',            label: 'Mapa de PDVs',    icon: <MapPinIcon /> });
  }

  // Insights (IA) para admin y supervisor. Perfil, para todos los roles.
  if (rol === 'admin' || rol === 'supervisor') {
    items.push({ href: '/insights', label: 'Insights', icon: <SparkIcon /> });
  }
  items.push({ href: '/perfil', label: 'Mi perfil', icon: <PersonIcon /> });

  return items;
}

function getInitials(name: string | null) {
  if (!name) return '?';
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

const ROL_LABEL: Record<Rol, string> = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  vendedor: 'Vendedor',
};

export function Sidebar({
  rol,
  nombre,
  vendedorNombre,
  supervisores = [],
  diasLaborables = 0,
  diasTrabajados = 0,
}: SidebarProps) {
  const pathname = usePathname();
  const router   = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const items = buildNav(rol, vendedorNombre, supervisores);

  return (
    <aside className="flex flex-col w-[220px] h-dvh shrink-0 bg-[#ffffff] border-r border-[#e4e4e7] select-none">
      {/* Brand */}
      <div className="px-5 py-6">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logo-candysur.png" alt="Candysur" className="w-[38px] h-[38px] object-contain shrink-0" />

          <div>
            <span className="text-[15px] font-bold tracking-[-0.01em] text-[#09090b] block leading-tight">Candysur</span>
            <span className="text-[11px] text-[#71717a] leading-tight block">Dashboard de Ventas</span>
          </div>
        </div>
        {diasLaborables > 0 && (
          <div className="mt-3 flex items-center gap-1.5 text-[10.5px] text-[#71717a] leading-tight"
               style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            <span className="text-[#09090b] font-semibold tabular-nums">{diasTrabajados}</span>
            <span className="text-[#71717a]">/</span>
            <span className="tabular-nums">{diasLaborables}</span>
            <span className="text-[#71717a] uppercase tracking-[0.06em] ml-0.5">días</span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto pb-2">
        {items.map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 px-3 py-[7px] rounded-[10px] text-[13.5px] font-medium transition-all duration-150 ${
                active
                  ? 'text-white shadow-md shadow-blue-500/20'
                  : 'text-[#71717a] hover:bg-[rgba(12,92,171,0.08)] hover:text-[#09090b]'
              }`}
              style={active ? {background: 'linear-gradient(135deg, #0c5cab, #0c5cab)'} : {}}
            >
              <span className={`shrink-0 ${active ? 'text-white' : 'text-[#71717a]'}`}>
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User footer */}
      <div className="p-3 border-t border-[#e4e4e7]">
        <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-[10px] hover:bg-[rgba(12,92,171,0.06)] transition-colors group cursor-default">
          <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 bg-[rgba(12,92,171,0.15)] border border-[rgba(12,92,171,0.3)]">
            <span className="text-[10px] font-bold text-[#0c5cab]">{getInitials(nombre)}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold text-[#09090b] truncate leading-tight">{nombre ?? '—'}</p>
            <p className="text-[11px] text-[#71717a] leading-tight">{ROL_LABEL[rol]}</p>
          </div>
          <button
            onClick={handleSignOut}
            title="Cerrar sesión"
            className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 text-[#71717a] hover:text-[#dc2626] transition-all shrink-0"
          >
            <SignOutIcon />
          </button>
        </div>
      </div>
    </aside>
  );
}
