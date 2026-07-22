#!/bin/sh

set -e

SUBSTORE_BACKEND_URL="https://github.com/sub-store-org/Sub-Store/releases/latest/download/sub-store.bundle.js"
SUBSTORE_MIRROR_BACKEND_URL="https://substore-openwrt.445568.xyz/assets/sub-store.bundle.js"
SUBSTORE_FRONTEND_URL="https://github.com/sub-store-org/Sub-Store-Front-End/releases/latest/download/dist.zip"
SUBSTORE_MIRROR_FRONTEND_URL="https://substore-openwrt.445568.xyz/assets/dist.zip"

# http-meta 的 bundle.js / tpl.yaml 跟后端 bundle 一样是与架构无关的静态资源，
# 直接在构建期下载打包进 arch:all 的 ipk 里；mihomo 内核走 opkg 依赖（+mihomo-meta），
# 由 opkg 按路由器实际架构自动装好，不再需要运行时探测架构再下载。
GH_PROXY_PREFIX="https://gh.445568.xyz/"
SUBSTORE_HTTPMETA_BUNDLE_URL="https://github.com/xream/http-meta/releases/latest/download/http-meta.bundle.js"
SUBSTORE_HTTPMETA_BUNDLE_MIRROR_URL="$GH_PROXY_PREFIX$SUBSTORE_HTTPMETA_BUNDLE_URL"
SUBSTORE_HTTPMETA_TPL_URL="https://github.com/xream/http-meta/releases/latest/download/tpl.yaml"
SUBSTORE_HTTPMETA_TPL_MIRROR_URL="$GH_PROXY_PREFIX$SUBSTORE_HTTPMETA_TPL_URL"

WGET_OPTS="${WGET_OPTS:---timeout=15 --tries=2 --waitretry=3}"

KIND="$1"
LIBEXEC_DIR="$2"
WWW_DIR="$3"

if [ -z "$KIND" ] || [ -z "$LIBEXEC_DIR" ]; then
	echo "错误: download-assets.sh 用法不对，至少需要 <backend|frontend> <libexec_dir>" >&2
	exit 1
fi

fetch_tag() {
	repo="$1"
	AUTH_HEADER=""
	[ -n "$GITHUB_TOKEN" ] && AUTH_HEADER="--header=Authorization: token $GITHUB_TOKEN"
	{ wget $WGET_OPTS $AUTH_HEADER -qO- "https://api.github.com/repos/$repo/releases/latest" 2>/dev/null \
	    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1; \
	  echo unknown; } | head -n1
}

case "$KIND" in
backend)
	OUT="$LIBEXEC_DIR/sub-store.bundle.js"
	echo "下载 Sub-Store 后端 bundle（优先走官方源）..."
	if wget $WGET_OPTS -q -O "$OUT" "$SUBSTORE_BACKEND_URL" \
	   && [ -s "$OUT" ] \
	   && ! head -c 200 "$OUT" | grep -qi '<html\|<!DOCTYPE'; then
		echo "官方源下载后端 bundle 成功"
	elif wget $WGET_OPTS -q -O "$OUT" "$SUBSTORE_MIRROR_BACKEND_URL" \
	   && [ -s "$OUT" ] \
	   && ! head -c 200 "$OUT" | grep -qi '<html\|<!DOCTYPE'; then
		echo "官方源不通，已改用自己的镜像下载后端 bundle 成功"
	else
		echo "错误: 后端 bundle 下载失败（镜像和官方源都拿不到有效文件）" >&2
		rm -f "$OUT"
		exit 1
	fi

	echo "记录后端版本号..."
	if [ -n "$SUBSTORE_BACKEND_TAG" ]; then
		echo "$SUBSTORE_BACKEND_TAG" > "$LIBEXEC_DIR/backend.version"
		echo "使用 CI 传入的后端版本号: $SUBSTORE_BACKEND_TAG"
	else
		fetch_tag "sub-store-org/Sub-Store" > "$LIBEXEC_DIR/backend.version"
	fi
	;;

frontend)
	if [ -z "$WWW_DIR" ]; then
		echo "错误: frontend 模式需要第三个参数 <www_dir>" >&2
		exit 1
	fi

	TMP_ZIP="/tmp/substore-dist-luci-app-substore.zip"
	echo "下载 Sub-Store 前端 dist（优先走官方源）..."
	if wget $WGET_OPTS -q -O "$TMP_ZIP" "$SUBSTORE_FRONTEND_URL" \
	   && [ -s "$TMP_ZIP" ] \
	   && unzip -tq "$TMP_ZIP" >/dev/null 2>&1; then
		echo "官方源下载前端 dist 成功"
	elif wget $WGET_OPTS -q -O "$TMP_ZIP" "$SUBSTORE_MIRROR_FRONTEND_URL" \
	   && [ -s "$TMP_ZIP" ] \
	   && unzip -tq "$TMP_ZIP" >/dev/null 2>&1; then
		echo "官方源不通，已改用自己的镜像下载前端 dist 成功"
	else
		echo "错误: 前端 dist 下载失败（镜像和官方源都拿不到有效 zip）" >&2
		rm -f "$TMP_ZIP"
		exit 1
	fi

	unzip -q -o "$TMP_ZIP" -d "$WWW_DIR"
	rm -f "$TMP_ZIP"

	echo "记录前端版本号..."
	if [ -n "$SUBSTORE_FRONTEND_TAG" ]; then
		echo "$SUBSTORE_FRONTEND_TAG" > "$LIBEXEC_DIR/frontend.version"
		echo "使用 CI 传入的前端版本号: $SUBSTORE_FRONTEND_TAG"
	else
		fetch_tag "sub-store-org/Sub-Store-Front-End" > "$LIBEXEC_DIR/frontend.version"
	fi

	if [ ! -f "$WWW_DIR/dist/index.html" ]; then
		echo "错误: 解压后没找到 dist/index.html，前端包结构可能变了" >&2
		exit 1
	fi
	;;

httpmeta)
	OUT="$LIBEXEC_DIR/http-meta.bundle.js"
	echo "下载 HTTP-META bundle（优先走官方源）..."
	if wget $WGET_OPTS -q -O "$OUT" "$SUBSTORE_HTTPMETA_BUNDLE_URL" \
	   && [ -s "$OUT" ] \
	   && ! head -c 200 "$OUT" | grep -qi '<html\|<!DOCTYPE'; then
		echo "官方源下载 HTTP-META bundle 成功"
	elif wget $WGET_OPTS -q -O "$OUT" "$SUBSTORE_HTTPMETA_BUNDLE_MIRROR_URL" \
	   && [ -s "$OUT" ] \
	   && ! head -c 200 "$OUT" | grep -qi '<html\|<!DOCTYPE'; then
		echo "官方源不通，已改用加速代理下载 HTTP-META bundle 成功"
	else
		echo "错误: HTTP-META bundle 下载失败（代理和官方源都拿不到有效文件）" >&2
		rm -f "$OUT"
		exit 1
	fi

	TPL_OUT="$LIBEXEC_DIR/http-meta-tpl.yaml"
	echo "下载 HTTP-META tpl.yaml（优先走官方源）..."
	if wget $WGET_OPTS -q -O "$TPL_OUT" "$SUBSTORE_HTTPMETA_TPL_URL" && [ -s "$TPL_OUT" ]; then
		echo "官方源下载 tpl.yaml 成功"
	elif wget $WGET_OPTS -q -O "$TPL_OUT" "$SUBSTORE_HTTPMETA_TPL_MIRROR_URL" && [ -s "$TPL_OUT" ]; then
		echo "官方源不通，已改用加速代理下载 tpl.yaml 成功"
	else
		echo "错误: tpl.yaml 下载失败（代理和官方源都拿不到有效文件）" >&2
		rm -f "$TPL_OUT"
		exit 1
	fi
	;;

*)
	echo "错误: 未知的类型 $KIND，只支持 backend/frontend/httpmeta" >&2
	exit 1
	;;
esac
