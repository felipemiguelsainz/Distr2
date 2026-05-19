'use client';

import dynamic from 'next/dynamic';
import type { PdvGeo } from './page';

const MapaClient = dynamic(() => import('./MapaClient'), { ssr: false });

export function MapaClientWrapper({ puntos }: { puntos: PdvGeo[] }) {
  return <MapaClient puntos={puntos} />;
}
