import type { Metadata } from "next";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { ConvexClientProvider } from "./ConvexClientProvider";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "Field Voter Finder",
  description: "Mobile-first nearby voter finder for field form collection.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Field Voter Finder",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn("h-full antialiased", "font-sans", geist.variable)}>
      <body className="min-h-full flex flex-col">
        <ConvexClientProvider>
          {children}
        </ConvexClientProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
