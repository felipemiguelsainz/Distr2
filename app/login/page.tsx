'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError('Email o contraseña incorrectos.');
      setLoading(false);
      return;
    }

    router.push('/');
    router.refresh();
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#060c1a] px-4 animate-rise">
      {/* Logo mark */}
      <div className="mb-8 flex flex-col items-center gap-3">
        <div className="w-[38px] h-[38px] rounded-[10px] flex items-center justify-center shadow-lg shadow-blue-500/30" style={{background: 'linear-gradient(135deg, #3b82f6, #6366f1)'}}>
          <svg width="20" height="20" fill="white" viewBox="0 0 20 20">
            <path d="M15.5 2A1.5 1.5 0 0014 3.5v13a1.5 1.5 0 003 0v-13A1.5 1.5 0 0015.5 2zM9.5 6A1.5 1.5 0 008 7.5v9a1.5 1.5 0 003 0v-9A1.5 1.5 0 009.5 6zM3.5 10A1.5 1.5 0 002 11.5v5a1.5 1.5 0 003 0v-5A1.5 1.5 0 003.5 10z"/>
          </svg>
        </div>
        <div className="text-center">
          <h1 className="text-[22px] font-bold tracking-[-0.01em] text-[#f0f4ff]">Candysur</h1>
          <p className="text-[13px] text-[#6b85a8] mt-0.5">Dashboard de Ventas</p>
        </div>
      </div>

      {/* Card */}
      <div className="w-full max-w-[340px] bg-[#0b1528] rounded-2xl border border-[#1a2d4a] shadow-[0_20px_60px_rgba(0,0,0,0.4)] px-8 py-8">
        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-1">
            <label className="block text-[13px] font-medium text-[#f0f4ff]">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 text-[14px] bg-[rgba(255,255,255,0.02)] border border-[#1a2d4a] rounded-[8px] text-[#f0f4ff] placeholder-[#2a3f5e] caret-[#3b82f6] focus:outline-none focus:border-[rgba(99,102,241,0.4)] focus:bg-[rgba(255,255,255,0.03)] transition-all"
              placeholder="usuario@empresa.com"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-[13px] font-medium text-[#f0f4ff]">Contraseña</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 text-[14px] bg-[rgba(255,255,255,0.02)] border border-[#1a2d4a] rounded-[8px] text-[#f0f4ff] caret-[#3b82f6] focus:outline-none focus:border-[rgba(99,102,241,0.4)] focus:bg-[rgba(255,255,255,0.03)] transition-all"
            />
          </div>

          {error && (
            <p className="text-[13px] text-[#f87171] bg-[#f87171]/[0.08] border border-[#f87171]/20 px-3 py-2 rounded-[8px]">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-[10px] px-4 text-white text-[14px] font-bold rounded-[9px] disabled:opacity-50 hover:-translate-y-px hover:brightness-110 active:translate-y-0 transition-all shadow-[0_4px_16px_rgba(99,102,241,0.3)]"
            style={{background: 'linear-gradient(135deg, #3b82f6, #6366f1)'}}
          >
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}
