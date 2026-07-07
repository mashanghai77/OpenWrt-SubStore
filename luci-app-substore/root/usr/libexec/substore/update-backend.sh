#!/bin/sh
set -e

# 2026-07 五次修复：之前镜像/官方源的重试全部埋在这一个脚本里一次性
# 跑完，LuCI 页面只能等它整个跑完才知道结果，中间到底在试哪个源、
# 失败在哪一步完全不可见，最后弹出来的还是拼在一起的错误堆叠文本。
# 现在改成脚本只负责"打一次某个来源的下载"，通过第一个参数指定
# proxy / mirror / official 里的哪一个，重试逻辑挪到 main.js 里——
# main.js 每调一次这个脚本，就能在页面上更新一次文字，用户能实时看到
# 现在在试哪个来源。
#
# 2026-07 六次修复：加了第三个来源 proxy——自建的 GitHub 加速代理
# （gh.445568.xyz），用法是在原始 GitHub 地址前面拼上代理域名。优先级
# 是 proxy（走加速代理拉官方最新）> mirror（自己的静态资源镜像）>
# official（官方原始直连，最后兜底）。
SOURCE="$1"
if [ "$SOURCE" != "proxy" ] && [ "$SOURCE" != "mirror" ] && [ "$SOURCE" != "official" ]; then
	echo "FAIL: 参数必须是 proxy、mirror 或 official（实际收到: $SOURCE）" >&2
	exit 1
fi

NODE=$(command -v node)
MV=$(command -v mv)
RM=$(command -v rm)
BUNDLE=/usr/libexec/substore/sub-store.bundle.js
TMP="$BUNDLE.tmp"
PROXY_PREFIX="https://gh.445568.xyz/"
OFFICIAL_URL="https://github.com/sub-store-org/Sub-Store/releases/latest/download/sub-store.bundle.js"
PROXY_URL="$PROXY_PREFIX$OFFICIAL_URL"
MIRROR_URL="https://substore-openwrt.445568.xyz/assets/sub-store.bundle.js"
MIRROR_VERSION_URL="https://substore-openwrt.445568.xyz/assets/backend-version.txt"
GITHUB_API_URL="https://api.github.com/repos/sub-store-org/Sub-Store/releases/latest"
PROXY_API_URL="$PROXY_PREFIX$GITHUB_API_URL"
VERSION_FILE="/usr/libexec/substore/backend.version"

if [ -z "$NODE" ]; then
	echo "FAIL: node 命令未找到" >&2
	exit 1
fi

case "$SOURCE" in
	proxy) URL="$PROXY_URL" ;;
	mirror) URL="$MIRROR_URL" ;;
	official) URL="$OFFICIAL_URL" ;;
esac

# 不再依赖 wget/uclient-fetch 等外部下载工具，node 自带的 fetch 本身
# 就有完整的 HTTPS 实现。加了 AbortSignal.timeout 防止网络卡住时无限
# 挂起；下载完检查内容开头不是 HTML 标签，避免 Cloudflare/代理对不存
# 在的路径返回的错误页被当成合法 bundle.js 存下来。
#
# 下载失败（网络问题、超时、内容校验没过）算"可恢复"的失败：打印
# DOWNLOAD_FAILED: 原因 到 stdout、正常退出（exit 0），main.js 看到
# 这个特定前缀就知道"这一步没通过，可以换个来源再试一次"，不会被当成
# 脚本本身出了异常。这里用 $(...) 直接捕获 node 的输出到变量——这是
# 普通 shell 脚本，不是 Package/install 那种会被多展开一轮的 Makefile
# recipe，不受那个 $$VAR 被吃字符的坑影响，可以放心用。
DL_OUTPUT=$("$NODE" -e "
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

download('$URL').catch(function(e) {
  console.log('DOWNLOAD_FAILED: ' + (e && e.message || e));
});
")

if [ -n "$DL_OUTPUT" ]; then
	"$RM" -f "$TMP"
	echo "$DL_OUTPUT"
	exit 0
fi

if [ ! -s "$TMP" ]; then
	"$RM" -f "$TMP"
	echo "DOWNLOAD_FAILED: 下载后文件为空"
	exit 0
fi

"$MV" -f "$TMP" "$BUNDLE"

/etc/init.d/substore restart

sleep 2

if ! pgrep -f "$BUNDLE" >/dev/null; then
	echo "FAIL: 重启后未检测到进程运行" >&2
	exit 1
fi

# 版本号记录放在这里、确认新版 bundle 已经真正跑起来之后再做，理由
# 跟之前一样：先确保内容真的换成新的了，再更新页面上显示的版本号。
#
# 三个下载来源各自有一套版本号查询的优先顺序，跟"这次到底是从哪条路
# 真正拿到内容的"对应起来，尽量优先用同一条路径去查版本号（大概率跟
# 下载一样能通），查不到再依次退化到另外两种方法，全部失败才保留旧值
# 不动，不会用 unknown 把之前查到的正确版本号覆盖掉。
#
# 内容校验：Cloudflare Pages 对不存在的路径没配 404 页面时会把根目录
# index.html 原样返回、状态码还是 200，之前只判断 res.ok 会把这种情况
# 当成合法版本号收下来——现在加一层校验，不像 tag_name 的内容一律当
# 查询失败处理。
"$NODE" -e "
const fs = require('fs');

function looksLikeVersionTag(s) {
  if (!s) return false;
  var t = String(s).trim();
  if (!t || t.length > 40) return false;
  if (/[<>\r\n\s]/.test(t)) return false;
  return /^[A-Za-z0-9._+-]+\$/.test(t);
}

async function fromProxyApi() {
  try {
    const res = await fetch('$PROXY_API_URL', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    var tag = data && data.tag_name;
    return looksLikeVersionTag(tag) ? tag : null;
  } catch (e) {
    return null;
  }
}

async function fromMirror() {
  try {
    const res = await fetch('$MIRROR_VERSION_URL', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    return looksLikeVersionTag(text) ? text : null;
  } catch (e) {
    return null;
  }
}

async function fromDirectApi() {
  try {
    const res = await fetch('$GITHUB_API_URL', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    var tag = data && data.tag_name;
    return looksLikeVersionTag(tag) ? tag : null;
  } catch (e) {
    return null;
  }
}

var ORDER = {
  proxy:    [fromProxyApi, fromMirror, fromDirectApi],
  mirror:   [fromMirror, fromProxyApi, fromDirectApi],
  official: [fromDirectApi, fromProxyApi, fromMirror]
};

(async () => {
  var fns = ORDER['$SOURCE'] || ORDER.official;
  var tag = null;
  for (var i = 0; i < fns.length; i++) {
    tag = await fns[i]();
    if (tag) break;
  }

  if (tag) {
    fs.writeFileSync('$VERSION_FILE', tag);
  } else {
    console.error('本次没能确定版本号，保留原有记录');
  }
})().catch(function(e) {
  console.error('版本号查询流程异常（不影响本次更新结果）：' + (e && e.message || e));
});
" || true

echo "OK"
exit 0
