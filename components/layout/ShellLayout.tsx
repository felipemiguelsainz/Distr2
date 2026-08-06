'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';

interface ShellLayoutProps {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  /** Contenido flotante (ej: chat) — se monta en la raíz, fuera del scroll y
   *  de cualquier transform, para que `position: fixed` se ancle a la pantalla. */
  floating?: React.ReactNode;
}

export function ShellLayout({ sidebar, children, floating }: ShellLayoutProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Cerrar el sidebar al navegar (mobile). Se ajusta en render y no en un
  // efecto: así no queda un frame con el menú abierto sobre la página nueva.
  const [pathPrev, setPathPrev] = useState(pathname);
  if (pathPrev !== pathname) {
    setPathPrev(pathname);
    setOpen(false);
  }

  return (
    <div className="flex h-dvh bg-[#fafafa]">
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/60 z-20 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar — slides in on mobile, always visible on lg+ */}
      <div
        className={`fixed lg:static inset-y-0 left-0 z-30 transition-transform duration-300 ease-in-out lg:transform-none ${
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {sidebar}
      </div>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto min-w-0">
        {/* Mobile top bar */}
        <div className="lg:hidden flex items-center gap-3 h-14 px-4 border-b border-[#e4e4e7] bg-[#ffffff] sticky top-0 z-10">
          <button
            onClick={() => setOpen(true)}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#71717a] hover:text-[#09090b] hover:bg-[rgba(0,0,0,0.04)] transition-colors"
            aria-label="Abrir menú"
          >
            <svg width="18" height="18" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zm0 5A.75.75 0 012.75 9h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 9.75zm0 5a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75z" clipRule="evenodd"/>
            </svg>
          </button>
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/logo-candysur.png" alt="Candysur" className="w-6 h-6 object-contain shrink-0" />
            <span className="text-[14px] font-bold text-[#09090b]">Candysur</span>
          </div>
        </div>

        <div className="max-w-[1280px] mx-auto px-4 lg:px-6 py-6 lg:py-8 animate-rise">
          {children}
        </div>
      </main>

      {/* Flotante (chat): fuera del <main> scrolleable y del transform */}
      {floating}
    </div>
  );
}
