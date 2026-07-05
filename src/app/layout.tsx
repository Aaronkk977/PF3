import type { Metadata } from "next";
import { Exo_2, Noto_Sans_TC } from "next/font/google";
import { AppShell } from "@/components/layout/app-shell";
import "./globals.css";

const notoSansTC = Noto_Sans_TC({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-noto-sans-tc",
});

const exo2 = Exo_2({
  weight: ["500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-clock",
});

export const metadata: Metadata = {
  title: "Portfolio Performance",
  description: "Cyberpunk portfolio tracker MVP",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-TW"
      className={`${notoSansTC.variable} ${exo2.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* 同步讀取 localStorage 套主題，避免 JS 載入前的主題閃爍（FOUC） */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=JSON.parse(localStorage.getItem('portfolio-app-settings')||'{}');var themes=['cyberpunk','monochrome','noir'];var t=themes.includes(s.theme)?s.theme:'cyberpunk';var c=s.colorMode==='red-up'?'red-up':'green-up';document.documentElement.dataset.theme=t;document.documentElement.dataset.colorMode=c;}catch(e){}})();`,
          }}
        />
      </head>
      <body className={`${notoSansTC.className} font-sans antialiased`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
