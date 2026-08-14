import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/** DM Sans para interfaz, JetBrains Mono para toda cifra, URL, código y fecha. */
const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Borsoga · Prospector",
  description: "Prospección B2B para el sur de Florida",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      /*
       * Base actual: tinta sobre claro. El conmutador de tema cambia
       * pc-light/pc-dark y el selector de acento cambia p-bronce/p-tinta/p-pino.
       */
      className={`pc-light p-tinta ${dmSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
