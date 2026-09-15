import type { Metadata } from "next";
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
