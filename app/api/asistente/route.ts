import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getLLMProvider, llmAvailable, LLMError, type ChatMessage } from '@/lib/ai/provider';
import { toolDefs, runTool, type UserContext } from '@/lib/ai/tools';

// Asistente de ventas: responde en lenguaje natural usando SOLO las tools
// read-only (que ya aplican el scoping por rol). El LLM nunca toca la DB ni
// calcula números: pide tools, lee resultados y redacta.

// El loop de tool-calling puede encadenar varias llamadas; subir el límite.
export const maxDuration = 60;

const MAX_TURNS = 5; // tope de iteraciones de tool-calling

function systemPrompt(ctx: UserContext): string {
  const hoy = new Date().toISOString().slice(0, 10);
  const alcance =
    ctx.rol === 'vendedor' ? `Solo ves tu cartera (${ctx.vendedor_nombre}).`
    : ctx.rol === 'supervisor' ? `Ves tu equipo (${ctx.vendedor_nombre}).`
    : 'Ves toda la distribuidora.';
  return [
    'Sos el asistente de ventas de Candysur, una distribuidora de Mondelez en el GBA.',
    'Respondé en español rioplatense, claro y breve.',
    `Hoy es ${hoy}. ${alcance}`,
    'Reglas:',
    '- Usá SIEMPRE las tools para obtener datos; nunca inventes números, nombres ni fechas.',
    '- Citá los números exactos que devuelven las tools.',
    '- Si ninguna tool puede responder algo, decilo con honestidad en vez de adivinar.',
    '- No reveles datos fuera del alcance del usuario.',
    'Podés responder preguntas como:',
    '- "¿Cuánto vendió [vendedor] en [mes]?" → usá get_ventas',
    '- "¿Cuántos clientes compraron [categoría] en [mes]?" → usá get_ccc_por_categoria',
    '- "¿Cuánto vendió [vendedor] en [categoría] en [mes]?" → usá get_ventas con rubro y mes_numero',
    '- "¿Hasta qué fecha hay datos?" → usá get_ultima_carga',
    '- "¿De qué días hay info?" / "¿cuántos días trabajados van?" → usá get_dias_con_datos',
    '- Nunca deduzcas cuántos días tienen datos contando el calendario o a partir',
    '  de la última fecha: hay feriados y días sin carga. Pedí get_dias_con_datos.',
    '- "¿Qué clientes no compraron hace más de X meses?" → usá get_pdvs_inactivos',
  ].join('\n');
}

export async function POST(req: Request) {
  if (!llmAvailable()) {
    return NextResponse.json({ error: 'El asistente no está configurado (falta API key).' }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles').select('rol, vendedor_nombre, equipo').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'Sin perfil' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const incoming = (body.messages ?? []) as { role: 'user' | 'assistant'; content: string }[];
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return NextResponse.json({ error: 'Falta el mensaje' }, { status: 400 });
  }
  // Acotar el historial para controlar tokens/costo. OJO: Anthropic exige que el
  // primer mensaje sea 'user'. El historial es user/assistant alternado y siempre
  // tiene largo impar (termina en el user recién enviado), así que un slice(-12)
  // pelado arranca en 'assistant' apenas hay 13+ mensajes y devuelve 400. Por eso
  // descartamos los mensajes iniciales hasta que el primero sea 'user'.
  const ventana = incoming.slice(-12);
  while (ventana.length > 0 && ventana[0].role !== 'user') ventana.shift();
  const trimmed = ventana.length > 0 ? ventana : incoming.slice(-1);

  const ctx: UserContext = { rol: profile.rol, vendedor_nombre: profile.vendedor_nombre, equipo: profile.equipo };
  const svc = createServiceClient();
  const provider = getLLMProvider();

  const convo: ChatMessage[] = trimmed.map((m) => ({ role: m.role, content: m.content }));

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await provider.chat({
        system: systemPrompt(ctx),
        messages: convo,
        tools: toolDefs(),
        maxTokens: 700,
      });

      if (res.toolCalls.length === 0) {
        return NextResponse.json({ reply: res.text ?? '' });
      }

      // El modelo pidió tools: ejecutarlas (con scope) y devolver resultados.
      convo.push({ role: 'assistant', content: res.text, tool_calls: res.toolCalls });
      for (const tc of res.toolCalls) {
        const out = await runTool(tc.name, tc.arguments, ctx, svc);
        convo.push({ role: 'tool', tool_call_id: tc.id, content: out });
      }
    }
    return NextResponse.json({ reply: 'No pude completar la consulta (demasiados pasos).' });
  } catch (e) {
    console.error('[asistente]', e);
    // Los errores del proveedor (sin crédito, API key inválida, rate limit) son
    // accionables: mostrarlos en vez de esconderlos tras un genérico.
    if (e instanceof LLMError) {
      return NextResponse.json({ error: e.mensajeUsuario }, { status: e.status === 429 ? 429 : 503 });
    }
    return NextResponse.json({ error: 'Error del asistente.' }, { status: 500 });
  }
}
