'use client';

import dynamic from 'next/dynamic';
import { Loader } from '@/components/ui/Loader';

// Leaflet toca `window` al importarse: sin ssr:false rompe el render del server.
const PlanificacionClient = dynamic(() => import('./PlanificacionClient'), {
  ssr: false,
  loading: () => <Loader fullScreen label="Cargando planificación…" />,
});

export function PlanificacionClientWrapper() {
  return <PlanificacionClient />;
}
