'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/admin/panel',     label: 'Días laborables' },
  { href: '/admin/metas',     label: 'Metas' },
  { href: '/admin/metas-ccc', label: 'Metas CCC' },
  { href: '/admin/cargar',    label: 'Cargar archivos' },
  { href: '/admin/usuarios',  label: 'Usuarios' },
];

export function AdminTabs() {
  const pathname = usePathname();
  return (
    <div className="flex gap-1 border-b border-[#e4e4e7] overflow-x-auto">
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + '/');
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`px-3.5 py-2.5 text-[13px] font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              active
                ? 'border-[#0c5cab] text-[#0c5cab]'
                : 'border-transparent text-[#71717a] hover:text-[#09090b]'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
