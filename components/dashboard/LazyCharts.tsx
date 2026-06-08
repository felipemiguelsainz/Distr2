'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/Skeleton';

// Recharts is a heavy dependency and the charts live below the fold, so we
// defer loading them until after hydration. ssr:false is fine here — the
// charts rely on ResponsiveContainer (client width) and render nothing useful
// on the server anyway.
const CARD = 'bg-[#ffffff] rounded-2xl border border-[#e4e4e7] shadow-xl shadow-black/5 p-5';

function ChartCardSkeleton({ height = 280 }: { height?: number }) {
  return (
    <div className={CARD}>
      <Skeleton className="h-3 w-40 mb-4" />
      <Skeleton className="w-full" style={{ height }} />
    </div>
  );
}

export const TrendChart = dynamic(
  () => import('./TrendChart').then((m) => m.TrendChart),
  { ssr: false, loading: () => <ChartCardSkeleton height={280} /> },
);

export const AvanceBarChart = dynamic(
  () => import('./TrendChart').then((m) => m.AvanceBarChart),
  { ssr: false, loading: () => <ChartCardSkeleton height={300} /> },
);

export const RadarMetaChart = dynamic(
  () => import('./TrendChart').then((m) => m.RadarMetaChart),
  { ssr: false, loading: () => <ChartCardSkeleton height={200} /> },
);
