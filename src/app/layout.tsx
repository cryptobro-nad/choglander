import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import { MotionPrefs } from "@/components/app/MotionPrefs";
import { Placeholder } from "@/components/app/Placeholder";
import "./globals.css";

const TITLE = "Choglander";
const DESCRIPTION = "Your Chog wakes you up, knows your day, and makes you laugh.";

// The same variable cuts the app has always used (Inter 4.001, Fraunces 1.000), with every axis it
// had: optical size follows the font size, and Fraunces keeps its soft and wonky axes at their
// defaults. Downloaded at build time and served from this app as woff2 subsets, Latin preloaded.
const inter = Inter({ subsets: ["latin"], axes: ["opsz"], display: "swap", variable: "--font-inter" });
const fraunces = Fraunces({ subsets: ["latin"], axes: ["opsz", "SOFT", "WONK"], display: "swap", variable: "--font-fraunces" });

// The link-preview images are the opengraph-image.png and twitter-image.png files beside this
// layout. Next writes their absolute URLs itself (from the Vercel deployment URL), so no
// metadataBase or relative image URL is set here.
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  applicationName: TITLE,
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: TITLE },
  icons: { icon: [{ url: "/icons/icon-48.png", sizes: "48x48", type: "image/png" }], apple: "/icons/apple-touch-icon.png" },
  openGraph: { type: "website", siteName: TITLE, title: TITLE, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = {
  // The top of the morning sky the server paints first. Sky.tsx retints it for the real hour.
  themeColor: "#fff6ea",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable} h-full antialiased`}>
      <body className="min-h-full">
        {/* Static first paint. Hidden by CSS as soon as the app (or the error screen) renders its <main>. */}
        <Placeholder />
        <MotionPrefs>{children}</MotionPrefs>
      </body>
    </html>
  );
}
