import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: '../public/fonts/Geist-latin.woff2',
  variable: "--font-geist-sans",
  weight: '100 900',
});

const geistMono = localFont({
  src: '../public/fonts/GeistMono-latin.woff2',
  variable: "--font-geist-mono",
  weight: '100 900',
});

export const metadata: Metadata = {
  title: "Assignations PsychoEducAction",
  description: "Gestion interne des assignations et du suivi client",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
