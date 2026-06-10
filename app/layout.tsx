import type { Metadata } from "next";
import { DM_Sans, DM_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "900"],
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Battery Splits",
  description: "MLB pitcher leaderboard with catcher presence filter",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${dmMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#edeae4]">
        {children}
        <Script data-goatcounter="https://battery-splits.goatcounter.com/count" src="//gc.zgo.at/count.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
