// electron-builder afterPack hook：
// prepare-standalone.mjs 為了繞過 electron-builder 會整包跳過
// 「頂層剛好叫 node_modules」資料夾的複製行為，把它改名成 _node_modules
// 再交給 extraResources。打包完成後，這裡把名字改回 node_modules，
// 讓 standalone/server.js 可以正常 require 到它的依賴。
const fs = require("fs");
const path = require("path");

exports.default = async function afterPack(context) {
  const renamed = path.join(
    context.appOutDir,
    "resources",
    "standalone",
    "_node_modules",
  );
  const target = path.join(
    context.appOutDir,
    "resources",
    "standalone",
    "node_modules",
  );

  if (fs.existsSync(renamed)) {
    fs.renameSync(renamed, target);
    console.log(`[afterPack] Restored ${target}`);
  } else if (!fs.existsSync(target)) {
    console.warn(
      `[afterPack] Warning: neither _node_modules nor node_modules found under standalone resource — server may fail to start.`,
    );
  }
};
