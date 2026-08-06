import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "API Hub｜订阅管理台";
  const description = "轻量、私密的 API 订阅到期、费用、渠道、标签与发票管理工具。订阅记录不会保存任何 API 密钥。";

  return {
    title,
    description,
    manifest: "/manifest.webmanifest",
    applicationName: "API Hub",
    appleWebApp: { capable: true, statusBarStyle: "default", title: "API Hub" },
    openGraph: { title, description, type: "website", images: [{ url: `${origin}/og.png`, width: 1732, height: 908, alt: "API Hub 订阅管理台" }] },
    twitter: { card: "summary_large_image", title, description, images: [`${origin}/og.png`] },
  };
}

export const viewport: Viewport = {
  themeColor: "#152b23",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
