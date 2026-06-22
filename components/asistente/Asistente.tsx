'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface Msg { role: 'user' | 'assistant'; content: string }

export function Asistente() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, loading]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    const next = [...msgs, { role: 'user' as const, content: text }];
    setMsgs(next);
    setInput('');
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/asistente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Error del asistente.');
      setMsgs([...next, { role: 'assistant', content: data.reply ?? '' }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [input, loading, msgs]);

  return (
    <>
      {/* Botón flotante */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Asistente"
        className="fixed bottom-5 right-5 z-[1100] w-13 h-13 flex items-center justify-center rounded-full shadow-[0_4px_16px_rgba(12,92,171,0.4)] text-white transition-transform hover:scale-105"
        style={{ width: 52, height: 52, background: '#0c5cab' }}
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="white" strokeWidth="2" strokeLinecap="round" /></svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M12 3C6.5 3 2 6.8 2 11.5c0 2.3 1.1 4.4 2.9 5.9L4 21l4.2-1.7c1.2.3 2.5.5 3.8.5 5.5 0 10-3.8 10-8.5S17.5 3 12 3z" /></svg>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-20 right-5 z-[1100] w-[360px] max-w-[calc(100vw-2.5rem)] h-[520px] max-h-[calc(100dvh-7rem)] flex flex-col rounded-[16px] border border-[#e4e4e7] bg-white shadow-[0_12px_40px_rgba(0,0,0,0.18)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#e4e4e7] bg-[#fafafa]">
            <p className="text-[14px] font-bold text-[#09090b] leading-tight">Asistente de ventas</p>
            <p className="text-[11px] text-[#71717a]">Preguntá sobre tus PDVs y ventas</p>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
            {msgs.length === 0 && (
              <div className="text-[12px] text-[#71717a] space-y-2">
                <p>Ejemplos:</p>
                {['¿Qué clientes no compran hace más de 3 meses?', 'Datos del PDV 11580'].map((ex) => (
                  <button
                    key={ex}
                    onClick={() => setInput(ex)}
                    className="block w-full text-left px-2.5 py-1.5 rounded-[8px] border border-[#e4e4e7] hover:border-[#0c5cab] hover:bg-[rgba(12,92,171,0.04)] transition-colors text-[#27272a]"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-[12px] text-[12.5px] leading-relaxed whitespace-pre-wrap ${
                    m.role === 'user'
                      ? 'bg-[#0c5cab] text-white rounded-br-[4px]'
                      : 'bg-[#f4f4f5] text-[#09090b] rounded-bl-[4px]'
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="px-3 py-2 rounded-[12px] bg-[#f4f4f5] text-[#71717a] text-[12.5px]">Pensando…</div>
              </div>
            )}
            {error && <p className="text-[12px] text-[#dc2626] px-1">{error}</p>}
          </div>

          <div className="p-2.5 border-t border-[#e4e4e7] flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Escribí tu pregunta…"
              className="flex-1 px-3 py-2 text-[12.5px] rounded-[10px] border border-[#e4e4e7] bg-[rgba(0,0,0,0.02)] text-[#09090b] placeholder:text-[#a1a1aa] focus:outline-none focus:border-[#0c5cab]"
            />
            <button
              onClick={send}
              disabled={loading || !input.trim()}
              className="px-3.5 py-2 rounded-[10px] bg-[#0c5cab] text-white text-[12.5px] font-semibold disabled:opacity-50 hover:bg-[#0a4f95] transition-colors"
            >
              Enviar
            </button>
          </div>
        </div>
      )}
    </>
  );
}
