'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

const TABS = [
  { href: '/admin/panel',     label: 'Días laborables' },
  { href: '/admin/metas',     label: 'Metas' },
  { href: '/admin/metas-ccc', label: 'Metas CCC' },
  { href: '/admin/cargar',    label: 'Cargar archivos' },
  { href: '/admin/usuarios',  label: 'Usuarios' },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + '/');
}

export function AdminTabs() {
  const pathname = usePathname();
  const router   = useRouter();
  const current  = TABS.find((t) => isActive(pathname, t.href))?.href ?? TABS[0].href;

  return (
    <div className="border-b border-[#e4e4e7]">
      {/* Mobile: selector nativo — evita el wrap en dos renglones */}
      <div className="lg:hidden pb-3">
        <select
          value={current}
          onChange={(e) => router.push(e.target.value)}
          className="w-full rounded-lg border border-[#e4e4e7] bg-white px-3 py-2.5 text-[14px] font-medium text-[#09090b] focus:outline-none focus:ring-2 focus:ring-[#0c5cab]/30"
        >
          {TABS.map((t) => (
            <option key={t.href} value={t.href}>{t.label}</option>
          ))}
        </select>
      </div>

      {/* Desktop: tabs */}
      <div className="hidden lg:flex gap-1">
        {TABS.map((t) => {
          const active = isActive(pathname, t.href);
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
    </div>
  );
}
