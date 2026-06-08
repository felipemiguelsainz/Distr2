import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  experimental: {
    // El proxy (proxy.ts) bufferea el body con tope de 10MB por defecto.
    // Lo subimos para permitir uploads grandes de Excel al correr local.
    // Nota: en Vercel igual aplica el tope duro de plataforma (~4.5MB);
    // esto solo ayuda en local / self-host.
    proxyClientMaxBodySize: '30mb',
  },
};

export default nextConfig;
