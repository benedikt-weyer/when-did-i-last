import type { Metadata, Viewport } from "next";
import { Space_Grotesk } from "next/font/google";
import Script from "next/script";

import { SiteHeader } from "@/components/site-header";

import { PwaRegistration } from "./pwa-registration";
import "./globals.css";

const sans = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

export const metadata: Metadata = {
  applicationName: "When Did I Last",
  title: "When Did I Last",
  description:
    "A When Did I Last tracker with secure card sync, auth flows, and realtime updates.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/pwa/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/pwa/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/pwa/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "When Did I Last",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#F5EFB9",
  colorScheme: "light dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html className="scroll-smooth" lang="en" suppressHydrationWarning>
      <body className={`${sans.variable} min-h-screen font-sans`}>
        <Script src="/runtime-config" strategy="beforeInteractive" />
        <PwaRegistration />
        <div className="relative flex min-h-screen flex-col">
          <SiteHeader />
          <div className="flex-1">{children}</div>
        </div>
      </body>
    </html>
  );
}