'use client';

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import type { PdvPlan } from './types';

export interface EstiloPunto {
  color: string;
  radio: number;
  opacidad: number;
}

/**
 * Capa de PDVs dibujada imperativamente con Leaflet, no con componentes React.
 *
 * Son ~7.000 puntos y acá, a diferencia del mapa de PDVs, no se puede usar
 * clustering: el clustering esconde los puntos individuales y sin verlos no se
 * puede dibujar un cuadrante alrededor de ellos. Montar 7.000 <CircleMarker/>
 * de react-leaflet reconcilia 7.000 nodos en cada render y traba el arrastre;
 * un LayerGroup imperativo se construye una sola vez y después solo se le
 * cambia el estilo a los círculos ya creados.
 */
export function PuntosLayer({
  puntos,
  estilo,
  estiloSig,
  onPuntoClick,
}: {
  puntos: PdvPlan[];
  estilo: (p: PdvPlan) => EstiloPunto;
  /** Cambia cuando `estilo` devolvería otra cosa: dispara el restyle. */
  estiloSig: string;
  onPuntoClick: (p: PdvPlan) => void;
}) {
  const map = useMap();
  const grupoRef = useRef<L.LayerGroup | null>(null);
  const marcadoresRef = useRef<Map<number, L.CircleMarker>>(new Map());

  // Los callbacks van por ref para que cambiar de handler no obligue a
  // reconstruir los 7.000 círculos. La sincronización se declara ANTES de los
  // efectos que los usan: los efectos corren en orden de declaración, así que
  // para cuando se construye o se re-estila, la ref ya tiene el valor nuevo.
  const estiloRef = useRef(estilo);
  const clickRef = useRef(onPuntoClick);
  useEffect(() => {
    estiloRef.current = estilo;
    clickRef.current = onPuntoClick;
  }, [estilo, onPuntoClick]);

  // Construcción (solo cuando cambia el set de puntos).
  useEffect(() => {
    const grupo = L.layerGroup().addTo(map);
    grupoRef.current = grupo;
    const marcadores = new Map<number, L.CircleMarker>();

    for (const p of puntos) {
      const e = estiloRef.current(p);
      const m = L.circleMarker([p.lat, p.lon], {
        radius: e.radio,
        color: '#ffffff',
        weight: 1,
        fillColor: e.color,
        fillOpacity: e.opacidad,
        // El clic tiene que seguir hasta el mapa: si el círculo lo frena, al
        // dibujar un cuadrante justo encima de un PDV no se agrega el vértice.
        bubblingMouseEvents: true,
      });
      m.on('click', () => clickRef.current(p));
      m.addTo(grupo);
      marcadores.set(p.pdv_id, m);
    }
    marcadoresRef.current = marcadores;

    return () => {
      grupo.remove();
      grupoRef.current = null;
      marcadoresRef.current = new Map();
    };
  }, [map, puntos]);

  // Restyle en caliente: recorre los círculos existentes sin recrearlos.
  useEffect(() => {
    for (const p of puntos) {
      const m = marcadoresRef.current.get(p.pdv_id);
      if (!m) continue;
      const e = estiloRef.current(p);
      m.setStyle({ fillColor: e.color, fillOpacity: e.opacidad });
      m.setRadius(e.radio);
    }
  }, [puntos, estiloSig]);

  return null;
}
