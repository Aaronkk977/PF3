import { redirect } from "next/navigation";

/** 舊路由：Performance 已併入 /analysis 的「績效曲線」子頁籤 */
export default function PerformanceRedirect() {
  redirect("/analysis");
}
