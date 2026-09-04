import { Inter } from "next/font/google";
import "./globals.css";
import "react-mockframe/styles/mockframe.css";
import { BASE_URL } from "@/utils/common";
import { cn } from "@/utils/cn";
import { TooltipProvider } from "@/components/tooltip";
import { Viewport } from "next";
import { Toaster } from "@/components/toast";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500"], display: "swap" });

const title = "Design";
const description = "Design — Simple browser tools for creating and preparing digital assets.";

export const metadata = {
  metadataBase: new URL(BASE_URL),
  title: title,
  description: description,
  icons: {
    icon: [{ url: "/icon.svg?v=2", type: "image/svg+xml", sizes: "any" }],
  },
  openGraph: {
    type: "website",
    siteName: "Design",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export const viewport: Viewport = {
  themeColor: "#181818",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" style={{ colorScheme: "dark" }}>
      <TooltipProvider>
        <body className={cn("isolate", inter.className)}>
          {children}
          <Toaster position="top-center" offset={70} duration={2000} />
        </body>
      </TooltipProvider>
    </html>
  );
}
