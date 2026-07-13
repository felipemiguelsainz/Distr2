'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#fafafa] px-4 animate-rise">
      {/* Logo mark */}
      <div className="mb-8 flex flex-col items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/logo-candysur.png" alt="Candysur" className="w-[56px] h-[56px] object-contain" />
        <div className="text-center">
          <h1 className="text-[22px] font-bold tracking-[-0.01em] text-[#09090b]">Candysur</h1>
          <p className="text-[13px] text-[#71717a] mt-0.5">Dashboard de Ventas</p>
        </div>
      </div>

      {/* Card */}
      <div className="w-full max-w-[340px] bg-[#ffffff] rounded-2xl border border-[#e4e4e7] shadow-[0_10px_30px_rgba(0,0,0,0.08)] px-8 py-8">
        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-1">
            <label className="block text-[13px] font-medium text-[#09090b]">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 text-[14px] bg-[rgba(0,0,0,0.02)] border border-[#e4e4e7] rounded-[8px] text-[#09090b] placeholder-[#d4d4d8] caret-[#0c5cab] focus:outline-none focus:border-[rgba(12,92,171,0.4)] focus:bg-[rgba(0,0,0,0.03)] transition-all"
              placeholder="usuario@empresa.com"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-[13px] font-medium text-[#09090b]">Contraseña</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-3 pr-10 py-2 text-[14px] bg-[rgba(0,0,0,0.02)] border border-[#e4e4e7] rounded-[8px] text-[#09090b] caret-[#0c5cab] focus:outline-none focus:border-[rgba(12,92,171,0.4)] focus:bg-[rgba(0,0,0,0.03)] transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#a1a1aa] hover:text-[#52525b] transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-[13px] text-[#dc2626] bg-[#dc2626]/[0.08] border border-[#dc2626]/20 px-3 py-2 rounded-[8px]">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-[10px] px-4 text-white text-[14px] font-bold rounded-[9px] disabled:opacity-50 hover:-translate-y-px hover:brightness-110 active:translate-y-0 transition-all shadow-[0_4px_16px_rgba(12,92,171,0.3)]"
            style={{background: 'linear-gradient(135deg, #0c5cab, #0c5cab)'}}
          >
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}
