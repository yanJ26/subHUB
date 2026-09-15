import "./globals.css";

export const metadata = {
  title: "subHUB｜数字服务与资产控制台",
  description: "统一管理订阅、API、Agent、域名、设备、部署、费用与使用权益。",
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
