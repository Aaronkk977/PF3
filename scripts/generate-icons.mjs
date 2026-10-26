/**
 * 從 assets/logo-source.png 產生各處要用的 app 圖示。
 *
 *   node scripts/generate-icons.mjs
 *
 * 來源圖是一張帶深灰底的方形圖，圓角方塊四周留了一圈灰邊。直接拿去當 icon
 * 的話，工作列／桌面上會看到一塊灰色方底，所以這裡先裁掉外圈、再套圓角遮罩
 * 讓四角透明，輸出才是乾淨的 app 圖示。
 *
 * 產物（都不要手改，改 logo 請換 logo-source.png 後重跑）：
 *   assets/icon.png      1024  electron-builder 打包 Windows exe／安裝檔用
 *   src/app/icon.png      256  Next.js App Router 慣例檔名，自動變成網頁 favicon
 *   electron/icon.png     256  開發模式下 BrowserWindow 的視窗／工作列圖示
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(root, "assets", "logo-source.png");

/** 圓角半徑佔邊長比例；量過來源圖實際的圓角約 18.9% */
const CORNER_RADIUS_RATIO = 0.19;
/** 裁切時往外多留幾 px，把圓角方塊自己那圈淺灰描邊一起帶進來 */
const EDGE_PADDING = 6;
/** 主圖尺寸；electron-builder 要求至少 256，給 1024 讓它自己降採樣品質最好 */
const MASTER_SIZE = 1024;

/** 找出圓角方塊（近黑區塊）在來源圖中的範圍，外面那圈灰底不要 */
async function findLogoBounds(file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const isDark = (x, y) => {
    const o = (y * width + x) * channels;
    return data[o] < 14 && data[o + 1] < 14 && data[o + 2] < 14;
  };
  const midX = width >> 1;
  const midY = height >> 1;
  let left = 0;
  while (left < width && !isDark(left, midY)) left++;
  let right = width - 1;
  while (right > 0 && !isDark(right, midY)) right--;
  let top = 0;
  while (top < height && !isDark(midX, top)) top++;
  let bottom = height - 1;
  while (bottom > 0 && !isDark(midX, bottom)) bottom--;
  if (left >= right || top >= bottom) throw new Error("找不到圖示範圍，來源圖是不是換過了？");
  return {
    left: Math.max(0, left - EDGE_PADDING),
    top: Math.max(0, top - EDGE_PADDING),
    width: Math.min(width, right + EDGE_PADDING) - Math.max(0, left - EDGE_PADDING) + 1,
    height: Math.min(height, bottom + EDGE_PADDING) - Math.max(0, top - EDGE_PADDING) + 1,
  };
}

/** 產生 MASTER_SIZE 見方、四角透明的主圖 */
async function buildMaster() {
  const bounds = await findLogoBounds(SOURCE);
  // 等比縮到塞得下 MASTER_SIZE，不做拉伸變形
  const scale = MASTER_SIZE / Math.max(bounds.width, bounds.height);
  const w = Math.round(bounds.width * scale);
  const h = Math.round(bounds.height * scale);
  const offsetX = Math.round((MASTER_SIZE - w) / 2);
  const offsetY = Math.round((MASTER_SIZE - h) / 2);

  const cropped = await sharp(SOURCE)
    .extract(bounds)
    .resize(w, h, { fit: "fill" })
    .ensureAlpha()
    .png()
    .toBuffer();

  const canvas = await sharp({
    create: {
      width: MASTER_SIZE,
      height: MASTER_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: cropped, left: offsetX, top: offsetY }])
    .png()
    .toBuffer();

  // 圓角遮罩：白色圓角矩形當 alpha，dest-in 之後方塊外就是透明
  const radius = Math.round(Math.min(w, h) * CORNER_RADIUS_RATIO);
  const mask = Buffer.from(
    `<svg width="${MASTER_SIZE}" height="${MASTER_SIZE}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect x="${offsetX}" y="${offsetY}" width="${w}" height="${h}" rx="${radius}" ry="${radius}" fill="#fff"/>` +
      `</svg>`,
  );

  return sharp(canvas).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
}

const OUTPUTS = [
  { file: ["assets", "icon.png"], size: MASTER_SIZE },
  { file: ["src", "app", "icon.png"], size: 256 },
  { file: ["electron", "icon.png"], size: 256 },
];

const master = await buildMaster();
for (const { file, size } of OUTPUTS) {
  const out = path.join(root, ...file);
  await fs.mkdir(path.dirname(out), { recursive: true });
  const buf =
    size === MASTER_SIZE ? master : await sharp(master).resize(size, size).png().toBuffer();
  await fs.writeFile(out, buf);
  console.log(`${file.join("/")}  ${size}x${size}  ${(buf.length / 1024).toFixed(0)} KB`);
}
