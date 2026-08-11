/**
 * Trae todas las filas de una consulta paginada, disparando varias páginas a la vez.
 *
 * PostgREST corta en 1000 filas por request, así que las tablas grandes hay que
 * pedirlas de a pedazos. Hacerlo con un `for` secuencial cuesta un round trip
 * por página: los ~7.000 PDVs geolocalizados son 7 viajes encadenados y en la
 * práctica eso eran 4-8 segundos de espera antes de ver el mapa.
 *
 * Acá las páginas de cada tanda salen en paralelo. Si la última de la tanda
 * vuelve llena, quiere decir que puede haber más y se pide otra tanda, así que
 * no se trunca nunca aunque la tabla crezca.
 *
 * @param pagina  Devuelve la consulta ya acotada al rango pedido.
 * @param tam     Filas por página. 1000 es el tope de PostgREST.
 * @param tanda   Cuántas páginas se piden a la vez.
 */
export async function traerTodo<T>(
  pagina: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  { tam = 1000, tanda = 8 }: { tam?: number; tanda?: number } = {},
): Promise<T[]> {
  const filas: T[] = [];

  for (let base = 0; ; base += tanda) {
    const paginas = await Promise.all(
      Array.from({ length: tanda }, (_, i) => {
        const desde = (base + i) * tam;
        return pagina(desde, desde + tam - 1);
      }),
    );

    let ultimaLlena = false;
    for (const p of paginas) {
      if (p.error) throw new Error(p.error.message);
      const data = p.data ?? [];
      filas.push(...data);
      ultimaLlena = data.length === tam;
    }

    // La última de la tanda vino incompleta → no quedan más filas.
    if (!ultimaLlena) return filas;
  }
}
