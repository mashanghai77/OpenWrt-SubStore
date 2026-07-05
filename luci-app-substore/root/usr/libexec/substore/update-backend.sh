#!/bin/sh
set -e

NODE=$(command -v node)
MV=$(command -v mv)
RM=$(command -v rm)
BUNDLE=/usr/libexec/substore/sub-store.bundle.js
TMP="$BUNDLE.tmp"
MIRROR_URL="https://substore-openwrt.445568.xyz/assets/sub-store.bundle.js"
FALLBACK_URL="https://github.com/sub-store-org/Sub-Store/releases/latest/download/sub-store.bundle.js"

if [ -z "$NODE" ]; then
	echo "FAIL: node 命令未找到" >&2
	exit 1
fi

# 不再依赖 wget/uclient-fetch 等外部下载工具，node 自带的 fetch 本身
# 就有完整的 HTTPS 实现（跟妙妙屋的 Go 二进制自带网络栈是同一个思路），
# 反正 node 本身就是跑后端必须要装的东西，不算多引入依赖。
#
# 2026-07 修复：加上 AbortSignal.timeout，避免网络卡住时 fetch 一直挂着
# 不返回；同时优先走自己的 Cloudflare 镜像，镜像不通再退回官方 GitHub。
#
# 2026-07 二次修复：Cloudflare Pages 对不存在的路径会返回一个 HTML 错误
# 页而不是网络错误，之前只判断了"下载没有报错"，会把这个 HTML 页面当成
# 合法 bundle.js 存下来。现在下载后检查内容开头不是 HTML 标签，不对就
# 当失败处理，触发退回官方源。
"$NODE" -e "
const fs = require('fs');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream('$TMP'));
  const head = fs.readFileSync('$TMP', { encoding: 'utf8', flag: 'r' }).slice(0, 200);
  if (/<html|<!DOCTYPE/i.test(head)) {
    throw new Error('返回内容像是 HTML 错误页，不是 js bundle');
  }
}

(async () => {
  try {
    await download('$MIRROR_URL');
  } catch (e) {
    console.error('镜像下载失败(' + (e && e.message || e) + ')，改用官方源重试...');
    await download('$FALLBACK_URL');
  }
})().catch(e => { console.error(e && e.message || e); process.exit(1); });
"

if [ ! -s "$TMP" ]; then
	"$RM" -f "$TMP"
	echo "FAIL: 下载失败，文件为空" >&2
	exit 1
fi

"$MV" -f "$TMP" "$BUNDLE"

/etc/init.d/substore restart

sleep 2

if ! pgrep -f "$BUNDLE" >/dev/null; then
	echo "FAIL: 重启后未检测到进程运行" >&2
	exit 1
fi

echo "OK"
exit 0
