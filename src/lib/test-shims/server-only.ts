// 測試專用替身：正式建置由 Next.js 內建處理 "server-only" 這個特殊 import，
// 但用 node:test 直接跑 .ts 檔案時沒有那層 bundler，會找不到這個套件（它
// 甚至沒被裝成真正的 npm 套件）。只有 tsconfig.test.json 的 paths 會把
// "server-only" 導到這個空檔案，正式的 tsconfig.json／Next.js 建置完全不受影響。
export {};
