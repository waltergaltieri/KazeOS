import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "KazeOS",
  description: "Gestión simple de clientes, cobros y tareas.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
