import type { Metadata, Viewport } from "next";
import { Inter, Anton } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import Toaster from "@/components/Toaster";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const anton = Anton({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-anton",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Gratitude",
  description: "Your Gratitude workspace assistant",
};

// viewport-fit=cover exposes the safe-area insets the composer and drawer pad
// against; resizes-content shrinks dvh when the on-screen keyboard opens
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${anton.variable}`}>
      <body className="bg-dark-950 text-white font-body antialiased">
        <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-in">
          {children}
          <Toaster />
        </ClerkProvider>
      </body>
    </html>
  );
}
