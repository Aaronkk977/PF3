import type { Metadata } from "next";
import { Exo_2, Noto_Sans_TC } from "next/font/google";
import { AppShell } from "@/components/layout/app-shell";
import { SettingsMigration } from "@/components/layout/settings-migration";
import { getAllAppSettings } from "@/lib/app-settings";
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

// 每次載入都要讀資料庫裡的使用者設定，不能在建置時預先產生
export const dynamic = "force-dynamic";

/** 開頁時在任何程式碼執行前，把資料庫裡的設定寫進 localStorage，再套主題
 *  （避免 JS 載入前的主題閃爍）。各頁照舊同步讀 localStorage，但內容以
 *  資料庫為準，所以不管埠號怎麼換、從哪個入口開，看到的都是同一份設定。
 *  MERGE_KEYS 的物件跟本機合併（保留本機才有的計算結果快取），其餘直接覆蓋。 */
function settingsBootstrapScript(settings: Record<string, unknown>): string {
  const payload = JSON.stringify(settings).replace(/</g, "\\u003c");
  return `(function(){
try{
var s=${payload};
var MERGE_KEYS=['portfolio-performance-prefs'];
for(var k in s){
  var v=s[k];
  if(MERGE_KEYS.indexOf(k)>=0&&v&&typeof v==='object'){
    var local={};try{local=JSON.parse(localStorage.getItem(k)||'{}')||{};}catch(e){}
    for(var f in v){local[f]=v[f];}
    v=local;
  }
  localStorage.setItem(k,typeof v==='string'?v:JSON.stringify(v));
}
}catch(e){}
try{
var a=JSON.parse(localStorage.getItem('portfolio-app-settings')||'{}');
var themes=['cyberpunk','monochrome','noir'];
document.documentElement.dataset.theme=themes.indexOf(a.theme)>=0?a.theme:'cyberpunk';
document.documentElement.dataset.colorMode=a.colorMode==='red-up'?'red-up':'green-up';
}catch(e){}
})();`;
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const settings = await getAllAppSettings();

  return (
    <html
      lang="zh-TW"
      className={`${notoSansTC.variable} ${exo2.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: settingsBootstrapScript(settings) }}
        />
      </head>
      <body className={`${notoSansTC.className} font-sans antialiased`}>
        <SettingsMigration serverKeys={Object.keys(settings)} />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
