#!/bin/sh
set -e

SOURCE="$1"
if [ "$SOURCE" != "proxy" ] && [ "$SOURCE" != "official" ]; then
	echo "FAIL: 参数必须是 proxy 或 official（实际收到: $SOURCE）" >&2
	exit 1
fi

NODE=$(command -v node)
GZIP=$(command -v gzip)
[ -z "$NODE" ] && { echo "FAIL: node 命令未找到" >&2; exit 1; }
[ -z "$GZIP" ] && { echo "FAIL: gzip 命令未找到" >&2; exit 1; }

uci_get() {
	local ret=$(uci -q get substore.http_meta.$1)
	echo "${ret:-$2}"
}

META_DIR=$(uci_get meta_dir /etc/sub-store/http-meta)
EXTERNAL_CORE=$(uci_get external_core_path "")
REUSE_CORE=$(uci_get reuse_core 1)

LIBEXEC_DIR=/usr/libexec/substore
BUNDLE="$LIBEXEC_DIR/http-meta.bundle.js"
BUNDLE_TMP="$BUNDLE.tmp"
CORE_DIR="$META_DIR/meta"
CORE_PATH="$CORE_DIR/http-meta"
CORE_TMP="$CORE_PATH.tmp"
VERSION_FILE="$LIBEXEC_DIR/http-meta.version"
CORE_VERSION_FILE="$LIBEXEC_DIR/http-meta-core.version"

PROXY_PREFIX="https://gh.445568.xyz/"

BUNDLE_OFFICIAL_URL="https://github.com/xream/http-meta/releases/latest/download/http-meta.bundle.js"
BUNDLE_PROXY_URL="$PROXY_PREFIX$BUNDLE_OFFICIAL_URL"
TPL_OFFICIAL_URL="https://github.com/xream/http-meta/releases/latest/download/tpl.yaml"
TPL_PROXY_URL="$PROXY_PREFIX$TPL_OFFICIAL_URL"
MIHOMO_API_URL="https://api.github.com/repos/MetaCubeX/mihomo/releases/latest"
MIHOMO_PROXY_API_URL="$PROXY_PREFIX$MIHOMO_API_URL"

case "$SOURCE" in
	proxy)
		BUNDLE_URL="$BUNDLE_PROXY_URL"
		TPL_URL="$TPL_PROXY_URL"
		API_URL="$MIHOMO_PROXY_API_URL"
		DL_PREFIX="$PROXY_PREFIX"
		;;
	official)
		BUNDLE_URL="$BUNDLE_OFFICIAL_URL"
		TPL_URL="$TPL_OFFICIAL_URL"
		API_URL="$MIHOMO_API_URL"
		DL_PREFIX=""
		;;
esac

mkdir -p "$CORE_DIR"

# ── 1. 架构探测（用于匹配 mihomo release 资产名）──────────────────
detect_mihomo_arch() {
	local m=$(uname -m)
	case "$m" in
		x86_64) echo "amd64" ;;
		aarch64) echo "arm64" ;;
		armv7l|armv7) echo "armv7" ;;
		armv6l) echo "armv6" ;;
		armv5l|armv5tel) echo "armv5" ;;
		mips)
			if [ -e /lib/ld-musl-mips-sf.so.1 ]; then echo "mips-softfloat"; else echo "mips-hardfloat"; fi
			;;
		mipsel)
			if [ -e /lib/ld-musl-mipsel-sf.so.1 ]; then echo "mipsle-softfloat"; else echo "mipsle-hardfloat"; fi
			;;
		mips64) echo "mips64" ;;
		mips64el) echo "mips64le" ;;
		riscv64) echo "riscv64" ;;
		i386|i686) echo "386" ;;
		*) echo "" ;;
	esac
}

# ── 2. 若配置了外部内核路径或允许复用已有 mihomo/clash-meta 核心，优先软链接，不再下载 ──
if [ -n "$EXTERNAL_CORE" ] && [ -x "$EXTERNAL_CORE" ]; then
	ln -sf "$EXTERNAL_CORE" "$CORE_PATH"
	echo "复用外部内核: $EXTERNAL_CORE"
	SKIP_CORE_DOWNLOAD=1
elif [ "$REUSE_CORE" = "1" ]; then
	for candidate in \
		/etc/openclash/core/clash_meta \
		/etc/openclash/core/mihomo \
		/usr/bin/mihomo \
		/usr/libexec/nikki/bin/mihomo
	do
		if [ -x "$candidate" ]; then
			ln -sf "$candidate" "$CORE_PATH"
			echo "自动探测到已安装内核并复用: $candidate"
			SKIP_CORE_DOWNLOAD=1
			break
		fi
	done
fi

# ── 3. 下载 bundle.js ──────────────────────────────────────────
BUNDLE_DL_OUTPUT=$("$NODE" -e "
const fs = require('fs');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
async function download(url, out) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(out));
  const head = fs.readFileSync(out, { encoding: 'utf8', flag: 'r' }).slice(0, 200);
  if (/<html|<!DOCTYPE/i.test(head)) throw new Error('返回内容像是 HTML 错误页，不是 js bundle');
}
download('$BUNDLE_URL', '$BUNDLE_TMP').catch(function(e) {
  console.log('DOWNLOAD_FAILED: ' + (e && e.message || e));
});
")

if [ -n "$BUNDLE_DL_OUTPUT" ]; then
	rm -f "$BUNDLE_TMP"
	echo "$BUNDLE_DL_OUTPUT"
	exit 0
fi
if [ ! -s "$BUNDLE_TMP" ]; then
	rm -f "$BUNDLE_TMP"
	echo "DOWNLOAD_FAILED: bundle 下载后文件为空"
	exit 0
fi
mv -f "$BUNDLE_TMP" "$BUNDLE"

# ── 4. 下载 tpl.yaml（跟 meta 内核放一起）─────────────────────────
TPL_DL_OUTPUT=$("$NODE" -e "
const fs = require('fs');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
async function download(url, out) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(out));
}
download('$TPL_URL', '$CORE_DIR/tpl.yaml.tmp').catch(function(e) {
  console.log('DOWNLOAD_FAILED: ' + (e && e.message || e));
});
")
if [ -n "$TPL_DL_OUTPUT" ]; then
	rm -f "$CORE_DIR/tpl.yaml.tmp"
	echo "$TPL_DL_OUTPUT"
	exit 0
fi
mv -f "$CORE_DIR/tpl.yaml.tmp" "$CORE_DIR/tpl.yaml"

# ── 5. 按架构下载 mihomo 内核（除非上面已经复用了现成的）────────────
if [ "$SKIP_CORE_DOWNLOAD" != "1" ]; then
	MIHOMO_ARCH=$(detect_mihomo_arch)
	if [ -z "$MIHOMO_ARCH" ]; then
		echo "DOWNLOAD_FAILED: 未能识别当前 CPU 架构（uname -m: $(uname -m)），请到「HTTP-META」页面手动填写外部内核路径"
		exit 0
	fi

	CORE_DL_OUTPUT=$("$NODE" -e "
const fs = require('fs');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const zlib = require('zlib');

async function run() {
  const res = await fetch('$API_URL', { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('release API HTTP ' + res.status);
  const data = await res.json();
  const re = new RegExp('^mihomo-linux-$MIHOMO_ARCH-v[0-9][^/]*\\\\.gz\$');
  const asset = (data.assets || []).find(a => re.test(a.name));
  if (!asset) throw new Error('没有找到匹配架构 $MIHOMO_ARCH 的内核资产');

  const url = '$DL_PREFIX' + asset.browser_download_url;
  const dres = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!dres.ok) throw new Error('内核下载 HTTP ' + dres.status);
  await pipeline(Readable.fromWeb(dres.body), zlib.createGunzip(), fs.createWriteStream('$CORE_TMP'));
  fs.chmodSync('$CORE_TMP', 0o755);
  fs.writeFileSync('$CORE_VERSION_FILE', data.tag_name || 'unknown');
}
run().catch(function(e) {
  console.log('DOWNLOAD_FAILED: ' + (e && e.message || e));
});
")
	if [ -n "$CORE_DL_OUTPUT" ]; then
		rm -f "$CORE_TMP"
		echo "$CORE_DL_OUTPUT"
		exit 0
	fi
	if [ ! -s "$CORE_TMP" ]; then
		rm -f "$CORE_TMP"
		echo "DOWNLOAD_FAILED: 内核下载后文件为空"
		exit 0
	fi
	mv -f "$CORE_TMP" "$CORE_PATH"
	chmod +x "$CORE_PATH"
fi

# ── 6. 记录 http-meta.bundle.js 自身版本号 ─────────────────────
"$NODE" -e "
const fs = require('fs');
async function fetchTag(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.tag_name || null;
  } catch (e) { return null; }
}
(async () => {
  var url = '$DL_PREFIX' + 'https://api.github.com/repos/xream/http-meta/releases/latest';
  var tag = await fetchTag(url);
  if (tag) fs.writeFileSync('$VERSION_FILE', tag);
})();
" || true

# ── 7. 若服务已启用，重启生效 ──────────────────────────────────
if [ "$(uci_get enabled 0)" = "1" ]; then
	/etc/init.d/http-meta restart
	sleep 1
	pgrep -f "$BUNDLE" >/dev/null || { echo "FAIL: 重启后未检测到进程运行" >&2; exit 1; }
fi

echo "OK"
exit 0
