import { redirect } from "next/navigation";

/** 舊路由：Trades 已併入 /analysis 的「已實現損益」子頁籤 */
export default function TradesRedirect() {
  redirect("/analysis");
}
