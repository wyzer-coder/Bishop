import type { Metadata } from "next";
import { Archivo, Inter_Tight, JetBrains_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/lib/query-provider";
import { ThemeProvider } from "@/lib/theme-provider";
import "./globals.css";

// Design system (see app/design for the review page): Archivo for display/
// KPI numerals, Inter Tight for UI/body — the Tight cut buys back column
// width the inventory matrix and ledger table need — and JetBrains Mono,
// ligatures off, for anything the system generated (addresses, hashes,
// amounts, timestamps) as opposed to anything a human wrote.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
});
const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin"],
});
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BishopOS",
  description: "The operating system for a blood-supply network.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${archivo.variable} ${interTight.variable} ${jetbrainsMono.variable}`}
        suppressHydrationWarning
      >
        <body className="antialiased">
          <ThemeProvider>
            <QueryProvider>
              {children}
              <Toaster />
            </QueryProvider>
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
