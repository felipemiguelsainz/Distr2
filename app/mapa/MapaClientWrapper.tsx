'use client';

import dynamic from 'next/dynamic';
import { Loader } from '@/components/ui/Loader';

const MapaClient = dynamic(() => import('./MapaClient'), {
  ssr: false,
  loading: () => <Loader fullScreen label="Cargando mapa…" />,
});

export function MapaClientWrapper() {
  return <MapaClient />;
}
