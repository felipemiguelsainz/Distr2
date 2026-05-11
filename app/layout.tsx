import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Candysur — Dashboard de Ventas",
  description: "Sistema de gestión de ventas Mondelez",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="h-full">
      <body className="h-full antialiased">
        {children}
      </body>
    </html>
  );
}
