import "./globals.css";

export const metadata = {
  title: "subHUB｜数字服务与资产控制台",
  description: "简单管理个人服务、订阅、续费、到期和数字资产。",
  applicationName: "subHUB",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f4f6f2",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
