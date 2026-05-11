'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Rol } from '@/lib/types';

interface SidebarProps {
  rol: Rol;
  nombre: string | null;
  vendedorNombre: string | null;
}

const ChartIcon = () => (
  <svg width="15" height="15" fill="currentColor" viewBox="0 0 20 20">
    <path d="M15.5 2A1.5 1.5 0 0014 3.5v13a1.5 1.5 0 003 0v-13A1.5 1.5 0 0015.5 2zM9.5 6A1.5 1.5 0 008 7.5v9a1.5 1.5 0 003 0v-9A1.5 1.5 0 009.5 6zM3.5 10A1.5 1.5 0 002 11.5v5a1.5 1.5 0 003 0v-5A1.5 1.5 0 003.5 10z"/>
  </svg>
);
const UploadIcon = () => (
  <svg width="15" height="15" fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M10 1a.75.75 0 01.75.75v7.586l2.22-2.22a.75.75 0 111.06 1.06l-3.5 3.5a.75.75 0 01-1.06 0l-3.5-3.5a.75.75 0 111.06-1.06l2.22 2.22V1.75A.75.75 0 0110 1zM3.5 14A1.5 1.5 0 002 15.5v1A1.5 1.5 0 003.5 18h13a1.5 1.5 0 001.5-1.5v-1A1.5 1.5 0 0016.5 14H3.5z" clipRule="evenodd"/>
  </svg>
);
const UsersIcon = () => (
  <svg width="15" height="15" fill="currentColor" viewBox="0 0 20 20">
    <path d="M10 9a3 3 0 100-6 3 3 0 000 6zM6 8a2 2 0 11-4 0 2 2 0 014 0zM1.49 15.326a.78.78 0 01-.358-.442 3 3 0 014.308-3.516 6.484 6.484 0 00-1.905 3.959c-.023.222-.014.442.025.654a4.97 4.97 0 01-2.07-.655zM16.44 15.98a4.97 4.97 0 002.07-.654.78.78 0 00.357-.442 3 3 0 00-4.308-3.517 6.484 6.484 0 011.907 3.96 2.32 2.32 0 01-.026.654zM18 8a2 2 0 11-4 0 2 2 0 014 0zM5.304 16.19a.844.844 0 01-.277-.71 5 5 0 019.947 0 .843.843 0 01-.277.71A6.975 6.975 0 0110 18a6.974 6.974 0 01-4.696-1.81z"/>
  </svg>
);
const CalendarIcon = () => (
  <svg width="15" height="15" fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M5.75 2a.75.75 0 01.75.75V4h7V2.75a.75.75 0 011.5 0V4h.25A2.75 2.75 0 0118 6.75v8.5A2.75 2.75 0 0115.25 18H4.75A2.75 2.75 0 012 15.25v-8.5A2.75 2.75 0 014.75 4H5V2.75A.75.75 0 015.75 2zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75z" clipRule="evenodd"/>
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

function buildNav(rol: Rol, vendedorNombre: string | null) {
  const items: { href: string; label: string; icon: React.ReactNode }[] = [];
  if (rol === 'admin') {
    items.push({ href: '/dashboard/total',      label: 'Total Empresa',   icon: <ChartIcon /> });
    items.push({ href: '/admin/cargar',          label: 'Cargar Archivos', icon: <UploadIcon /> });
    items.push({ href: '/admin/metas',           label: 'Metas',           icon: <TargetIcon /> });
    items.push({ href: '/admin/panel',           label: 'Panel Admin',     icon: <GearIcon /> });
    items.push({ href: '/dashboard/supervisor',  label: 'Mi Equipo',       icon: <UsersIcon /> });
    items.push({ href: '/planificacion',         label: 'Planificación',   icon: <CalendarIcon /> });
  }
  if (rol === 'supervisor') {
    items.push({ href: '/dashboard/supervisor',  label: 'Mi Equipo',       icon: <UsersIcon /> });
    items.push({ href: '/planificacion',         label: 'Planificación',   icon: <CalendarIcon /> });
  }
  if (rol === 'vendedor' && vendedorNombre) {
    items.push({ href: `/dashboard/vendedor/${encodeURIComponent(vendedorNombre)}`, label: 'Mi Dashboard', icon: <PersonIcon /> });
    items.push({ href: '/planificacion',         label: 'Planificación',   icon: <CalendarIcon /> });
  }
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

export function Sidebar({ rol, nombre, vendedorNombre }: SidebarProps) {
  const pathname = usePathname();
  const router   = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const items = buildNav(rol, vendedorNombre);

  return (
    <aside className="flex flex-col w-[220px] h-screen shrink-0 bg-[#0b1528] border-r border-[#1a2d4a] select-none">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-5 py-6">
        <div className="w-[38px] h-[38px] rounded-[10px] flex items-center justify-center shrink-0 shadow-lg" style={{background: 'linear-gradient(135deg, #3b82f6, #6366f1)'}}>
          <ChartIcon />
        </div>
        <div>
          <span className="text-[15px] font-bold tracking-[-0.01em] text-[#f0f4ff] block leading-tight">Candysur</span>
          <span className="text-[11px] text-[#6b85a8] leading-tight block">Dashboard de Ventas</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto pb-2">
        {items.map(item => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 px-3 py-[7px] rounded-[10px] text-[13.5px] font-medium transition-all duration-150 ${
                active
                  ? 'text-white shadow-md shadow-blue-500/20'
                  : 'text-[#6b85a8] hover:bg-[rgba(59,130,246,0.08)] hover:text-[#f0f4ff]'
              }`}
              style={active ? {background: 'linear-gradient(135deg, #3b82f6, #6366f1)'} : {}}
            >
              <span className={`shrink-0 ${active ? 'text-white' : 'text-[#6b85a8]'}`}>
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User footer */}
      <div className="p-3 border-t border-[#1a2d4a]">
        <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-[10px] hover:bg-[rgba(59,130,246,0.06)] transition-colors group cursor-default">
          <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 bg-[rgba(99,102,241,0.15)] border border-[rgba(99,102,241,0.3)]">
            <span className="text-[10px] font-bold text-[#6366f1]">{getInitials(nombre)}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold text-[#f0f4ff] truncate leading-tight">{nombre ?? '—'}</p>
            <p className="text-[11px] text-[#6b85a8] leading-tight">{ROL_LABEL[rol]}</p>
          </div>
          <button
            onClick={handleSignOut}
            title="Cerrar sesión"
            className="opacity-0 group-hover:opacity-100 text-[#6b85a8] hover:text-[#f87171] transition-all shrink-0"
          >
            <SignOutIcon />
          </button>
        </div>
      </div>
    </aside>
  );
}
