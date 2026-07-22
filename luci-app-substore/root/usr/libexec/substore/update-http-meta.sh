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
# http-meta 官方 bundle 里 bin = path.join(folder, 'http-meta') 是写死的，
# meta 目录内必须有一个文件名字面量叫 http-meta，否则进程启动直接 exit(1)，这个名字不能改。
CORE_PATH="$CORE_DIR/http-meta"
# 全路由器共享的内核槽位：跟 Nikki、官方 mihomo-meta/mihomo-alpha opkg 包完全一致的路径约定。
# Nikki 的 init 脚本里 PROG 就是硬编码这个路径；mihomo-meta/mihomo-alpha 这两个 opkg 包
# 也是靠 opkg 的 update-alternatives 机制把这个路径管理成软链接。谁先在路由器上把这个
# 位置填上，后来者（不管是 Nikki、OpenClash 新版还是我们自己）都会直接复用，不用重复下载。
SHARED_CORE="/usr/bin/mihomo"
# 我们自己下载 / 提升外部内核为共享内核时，真身存放位置。这个路径跟官方 mihomo-meta 包
# 实际安装真身的路径（GO_PKG_INSTALL_BIN_PATH:=/usr/libexec）完全一致，所以就算之后
# 用户又通过 opkg 装了官方 mihomo-meta/mihomo-alpha 包，它会直接覆盖这个文件并接管
# SHARED_CORE 的软链，无缝衔接，不会冲突。
MIHOMO_BIN="/usr/libexec/mihomo"
MIHOMO_TMP="$MIHOMO_BIN.tmp"
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
mkdir -p "$(dirname "$MIHOMO_BIN")"

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

# ── 2. 内核获取：优先复用全路由器共享的 /usr/bin/mihomo，其次外部指定路径，
#      再次自动探测其它工具的内核并「提升」为共享内核，最后才考虑自己下载 ──
# 协议约定：本脚本 stdout 只能是 "OK" 或 "DOWNLOAD_FAILED: ..."，其余诊断/提示信息一律走 stderr，
# 否则前端 runSourceScript() 按 stdout === 'OK' 的严格比较会把"成功但带提示"误判为失败。
write_reused_core_version() {
	# 复用路径也要写内核版本文件，否则前端「内核版本」会一直显示未安装。
	# mihomo/clash-meta 的 -v 原始输出形如：
	#   Mihomo Meta v1.19.9 linux/arm64 with go1.26.4 2026-07-22T02:10:00Z
	# 直接整行塞给前端会在窄屏两栏布局里把 label 挤成竖排一个字一行，
	# 这里只提取干净的版本号本体（v 开头的那一段），系统/go版本/构建时间这些噪音一律丢弃。
	local core_path="$1"
	local raw=""
	if command -v timeout >/dev/null 2>&1; then
		raw=$(timeout 3 "$core_path" -v 2>/dev/null | head -n1)
	else
		raw=$("$core_path" -v 2>/dev/null | head -n1)
	fi
	local ver=""
	if [ -n "$raw" ]; then
		ver=$(echo "$raw" | grep -oE 'v[0-9]+\.[0-9]+(\.[0-9]+)?([-.][a-zA-Z0-9]+)*' | head -n1)
	fi
	if [ -z "$ver" ]; then
		ver="外部复用: $core_path"
	fi
	echo "$ver" > "$CORE_VERSION_FILE"
}

# 把某个内核路径「提升」为全路由器共享内核：真身放到 MIHOMO_BIN，再把 SHARED_CORE
# 软链到它。这样之后任何直接检测/调用 /usr/bin/mihomo 的工具（比如 Nikki）都能立刻用上，
# 不用重复下载。如果来源本身就已经是 SHARED_CORE（比如系统已经有 opkg 装的 mihomo-meta/
# mihomo-alpha），就不做任何改动，直接复用，避免碰坏 opkg 的 alternatives 软链。
promote_to_shared_core() {
	local source_path="$1"
	if [ "$source_path" != "$SHARED_CORE" ]; then
		ln -sf "$source_path" "$MIHOMO_BIN"
		ln -sf "$MIHOMO_BIN" "$SHARED_CORE"
	fi
	ln -sf "$SHARED_CORE" "$CORE_PATH"
	write_reused_core_version "$SHARED_CORE"
}

if [ -x "$SHARED_CORE" ]; then
	# 全路由器共享槽位已经有内核了（不管是 opkg 装的 mihomo-meta/mihomo-alpha、Nikki、
	# 还是我们自己之前下载/提升的），直接复用，绝不重复下载。
	promote_to_shared_core "$SHARED_CORE"
	echo "复用系统共享内核: $SHARED_CORE" >&2
	SKIP_CORE_DOWNLOAD=1
elif [ -n "$EXTERNAL_CORE" ] && [ -x "$EXTERNAL_CORE" ]; then
	promote_to_shared_core "$EXTERNAL_CORE"
	echo "复用外部内核并提升为系统共享: $EXTERNAL_CORE -> $SHARED_CORE" >&2
	SKIP_CORE_DOWNLOAD=1
elif [ "$REUSE_CORE" = "1" ]; then
	# 这里只列非 opkg-alternatives 管理的内核位置（OpenClash 走自己的一套核心管理，
	# 不经过 /usr/bin/mihomo）。Nikki/官方 mihomo-meta/mihomo-alpha 已经在上面
	# SHARED_CORE 那一分支覆盖，不需要重复列出。
	for candidate in \
		/etc/openclash/core/clash_meta \
		/etc/openclash/core/mihomo
	do
		if [ -x "$candidate" ]; then
			promote_to_shared_core "$candidate"
			echo "自动探测到已安装内核并提升为系统共享: $candidate -> $SHARED_CORE" >&2
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
  await pipeline(Readable.fromWeb(dres.body), zlib.createGunzip(), fs.createWriteStream('$MIHOMO_TMP'));
  fs.chmodSync('$MIHOMO_TMP', 0o755);
  fs.writeFileSync('$CORE_VERSION_FILE', data.tag_name || 'unknown');
}
run().catch(function(e) {
  console.log('DOWNLOAD_FAILED: ' + (e && e.message || e));
});
")
	if [ -n "$CORE_DL_OUTPUT" ]; then
		rm -f "$MIHOMO_TMP"
		echo "$CORE_DL_OUTPUT"
		exit 0
	fi
	if [ ! -s "$MIHOMO_TMP" ]; then
		rm -f "$MIHOMO_TMP"
		echo "DOWNLOAD_FAILED: 内核下载后文件为空"
		exit 0
	fi
	# 新下载的内核本体固定落在 /usr/libexec/mihomo（跟官方 mihomo-meta 包安装路径一致），
	# 然后提升为全路由器共享内核 /usr/bin/mihomo，之后 Nikki/OpenClash 等其它工具
	# 也能直接复用这一份，不用各自重复下载。
	mv -f "$MIHOMO_TMP" "$MIHOMO_BIN"
	chmod +x "$MIHOMO_BIN"
	ln -sf "$MIHOMO_BIN" "$SHARED_CORE"
	ln -sf "$SHARED_CORE" "$CORE_PATH"
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
