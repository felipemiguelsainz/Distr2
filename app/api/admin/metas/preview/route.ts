import { NextRequest, NextResponse } from 'next/server';
import { calcularMetasPreview } from '@/lib/calculations/metas';

export async function POST(request: NextRequest) {
  try {
    const { anio, mes, objetivosMondelez } = await request.json();
    if (!anio || !mes) {
      return NextResponse.json({ error: 'Faltan parámetros anio/mes.' }, { status: 400 });
    }
    const preview = await calcularMetasPreview(
      Number(anio),
      Number(mes),
      objetivosMondelez ?? {},
    );
    return NextResponse.json({ preview });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
