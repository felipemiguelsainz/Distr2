// ---------------------------------------------------------------------------
// Capa LLM agnóstica de proveedor. Solo server-side (usa las API keys).
//
// Hoy se usa OpenAI; mañana Claude. El resto de la app habla SOLO con esta
// interfaz, así cambiar de proveedor es una env var (AI_PROVIDER) y no tocar
// las features. Implementado con fetch para no agregar dependencias.
//
// Principio (ver docs/CONTEXTO-IA.md): el LLM redacta/decide qué tool llamar,
// NUNCA calcula números ni coordenadas. Eso lo hacen las tools (SQL/algoritmo).
// ---------------------------------------------------------------------------

export type ChatMessage =
  | { role: 'user' | 'assistant'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema de los parámetros. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatResult {
  /** Texto de la respuesta (null si el modelo solo pidió tools). */
  text: string | null;
  /** Tools que el modelo quiere ejecutar (vacío si respondió directo). */
  toolCalls: ToolCall[];
}

export interface ChatOptions {
  system: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  temperature?: number;
  maxTokens?: number;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  chat(opts: ChatOptions): Promise<ChatResult>;
}

// ---------------------------------------------------------------------------
// OpenAI (Chat Completions API con function-calling)
// ---------------------------------------------------------------------------
class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  readonly model: string;
  constructor(private apiKey: string, model?: string) {
    this.model = model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  }

  async chat(opts: ChatOptions): Promise<ChatResult> {
    const messages: unknown[] = [{ role: 'system', content: opts.system }];
    for (const m of opts.messages) {
      if (m.role === 'assistant' && 'tool_calls' in m) {
        messages.push({
          role: 'assistant',
          content: m.content ?? '',
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        });
      } else {
        messages.push(m);
      }
    }

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 800,
    };
    if (opts.tools?.length) {
      body.tools = opts.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const msg = data.choices?.[0]?.message ?? {};
    const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((tc: { id: string; function: { name: string; arguments: string } }) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: safeParse(tc.function.arguments),
    }));
    return { text: msg.content ?? null, toolCalls };
  }
}

// ---------------------------------------------------------------------------
// Anthropic (Messages API con tool-use). Modelos: ver docs/CONTEXTO-IA.md.
// ---------------------------------------------------------------------------
class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  readonly model: string;
  constructor(private apiKey: string, model?: string) {
    this.model = model ?? process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001';
  }

  async chat(opts: ChatOptions): Promise<ChatResult> {
    // Anthropic representa tool calls/results como bloques de contenido.
    const messages = opts.messages.map((m) => {
      if (m.role === 'assistant' && 'tool_calls' in m) {
        const blocks: unknown[] = [];
        if (m.content) blocks.push({ type: 'text', text: m.content });
        for (const tc of m.tool_calls) blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
        return { role: 'assistant', content: blocks };
      }
      if (m.role === 'tool') {
        return { role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }] };
      }
      return { role: m.role, content: m.content };
    });

    const body: Record<string, unknown> = {
      model: this.model,
      system: opts.system,
      messages,
      max_tokens: opts.maxTokens ?? 800,
      temperature: opts.temperature ?? 0.2,
    };
    if (opts.tools?.length) {
      body.tools = opts.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const data = await res.json();
    let text: string | null = null;
    const toolCalls: ToolCall[] = [];
    for (const block of data.content ?? []) {
      if (block.type === 'text') text = (text ?? '') + block.text;
      else if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, arguments: block.input ?? {} });
    }
    return { text, toolCalls };
  }
}

function safeParse(s: string): Record<string, unknown> {
  try { return JSON.parse(s || '{}'); } catch { return {}; }
}

/**
 * Devuelve el proveedor activo según AI_PROVIDER (default openai).
 * Lanza si falta la API key — las features de IA deben degradar con gracia.
 */
export function getLLMProvider(): LLMProvider {
  const which = (process.env.AI_PROVIDER ?? 'openai').toLowerCase();
  if (which === 'anthropic') {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('Falta ANTHROPIC_API_KEY');
    return new AnthropicProvider(key);
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('Falta OPENAI_API_KEY');
  return new OpenAIProvider(key);
}

/** True si hay credenciales para el proveedor activo (para degradar UI). */
export function llmAvailable(): boolean {
  const which = (process.env.AI_PROVIDER ?? 'openai').toLowerCase();
  return which === 'anthropic' ? !!process.env.ANTHROPIC_API_KEY : !!process.env.OPENAI_API_KEY;
}
