'use client';

import { SelectHTMLAttributes } from 'react';

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  children: React.ReactNode;
};

export function Select({ className = '', children, ...props }: SelectProps) {
  return (
    <div className="relative inline-flex items-center">
      <select
        {...props}
        className={[
          'appearance-none cursor-pointer pl-3 pr-8 py-[7px]',
          'text-[13px] font-medium text-[#f0f4ff]',
          'bg-[#0d1a2d] border border-[#1a2d4a] rounded-[8px]',
          'hover:border-[#213654] hover:bg-[#0f1e38]',
          'focus:outline-none focus:border-[rgba(99,102,241,0.5)] focus:bg-[#0f1e38]',
          'transition-all',
          className,
        ].join(' ')}
      >
        {children}
      </select>
      {/* Custom chevron */}
      <svg
        className="pointer-events-none absolute right-2.5 text-[#6b85a8]"
        width="12" height="12" viewBox="0 0 12 12" fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
}
