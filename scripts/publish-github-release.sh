#!/usr/bin/env bash
# 把 release/ 底下打包好的安裝檔發布到 GitHub Release（由 .github/workflows/release.yml 呼叫）。
#
# 不用 electron-builder 的 --publish：它會同時上傳 exe／blockmap／latest.yml，每個上傳
# 各自查「這個 tag 有沒有 release」，都查不到就各自建立，第二個拿到 422 already_exists
# 讓整個步驟失敗（v0.1.8、v0.2.0 都是這樣，release 上只剩 blockmap，自動更新抓不到新版）。
# 這裡改成依序：建草稿 → 上傳三個檔案 → 確認都在 → 才改成正式發布。草稿在完成前
# 不會被使用者端的自動更新看到。
#
# 用法：scripts/publish-github-release.sh <tag>      例：v0.2.1
#       DRY_RUN=1 只檢查檔案、印出會執行的指令，不碰 GitHub。

set -euo pipefail

tag="${1:?usage: publish-github-release.sh <tag>}"
version="${tag#v}"
release_dir="release"
dry_run="${DRY_RUN:-0}"

run() {
  if [ "$dry_run" = "1" ]; then
    echo "[dry-run] $*"
  else
    "$@"
  fi
}

# electron-builder 產出的檔名有空白；latest.yml 裡寫的下載網址是把空白換成 "-"
# 的版本，GitHub 上的檔名必須跟它一致，自動更新才找得到安裝檔。
src_exe="$release_dir/Portfolio Performance Setup $version.exe"
src_blockmap="$src_exe.blockmap"
src_latest="$release_dir/latest.yml"
asset_exe="Portfolio-Performance-Setup-$version.exe"

for f in "$src_exe" "$src_blockmap" "$src_latest"; do
  [ -f "$f" ] || { echo "Missing build output: $f" >&2; exit 1; }
done

grep -qx "version: $version" "$src_latest" || {
  echo "latest.yml is not for version $version (tag $tag):" >&2
  head -1 "$src_latest" >&2
  exit 1
}
grep -q "url: $asset_exe" "$src_latest" || {
  echo "latest.yml does not point at $asset_exe" >&2
  exit 1
}

staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
cp "$src_exe" "$staging/$asset_exe"
cp "$src_blockmap" "$staging/$asset_exe.blockmap"
cp "$src_latest" "$staging/latest.yml"

if gh release view "$tag" > /dev/null 2>&1; then
  echo "Release $tag already exists; replacing its files."
else
  run gh release create "$tag" --draft --verify-tag --title "$version" --notes ""
fi

run gh release upload "$tag" --clobber \
  "$staging/$asset_exe" \
  "$staging/$asset_exe.blockmap" \
  "$staging/latest.yml"

if [ "$dry_run" != "1" ]; then
  assets="$(gh release view "$tag" --json assets --jq '.assets[].name')"
  for name in "$asset_exe" "$asset_exe.blockmap" latest.yml; do
    grep -qx "$name" <<< "$assets" || {
      echo "Upload check failed: $name is not on release $tag" >&2
      exit 1
    }
  done
fi

run gh release edit "$tag" --draft=false --latest
echo "Published $tag with $asset_exe, its blockmap and latest.yml."
