#!/bin/sh
# luci-app-substore 一键安装脚本
# 用法: wget -O - https://substore-openwrt.pages.dev/install.sh | ash

set -e

REPO_URL="https://substore-openwrt.445568.xyz"

echo "=== luci-app-substore 一键安装 ==="

if [ -x /usr/bin/apk ]; then
    echo "检测到 apk 包管理器 (OpenWrt 25.12+)"

    wget -q -O /etc/apk/keys/substore-apk.pem "$REPO_URL/substore-apk.pem"

    echo "添加软件源..."
    mkdir -p /etc/apk/repositories.d
    # 单独放一个 substore.list，不追加进公共的 customfeeds.list：
    # 一是重装/更新时不用再 grep 判重，直接整份覆盖就是最新状态；
    # 二是卸载的时候能精确删掉这一个文件，不会动到别的软件源。
    echo "$REPO_URL/openwrt-25.12/all/packages.adb" > /etc/apk/repositories.d/substore.list

    echo "更新索引..."
    # apk update 会刷新机器上所有已配置的源，哪怕跟本包无关的第三方源
    # （比如 istore 之类）超时/中断，也会让 apk update 返回非零，配合
    # set -e 会把整个安装脚本在这一步杀掉——即使我们自己的源其实是好的。
    # 这里放宽为不因此中断，本包源是否真的可用交给下面的 apk add 判断，
    # 它会给出明确报错。
    apk update || true

    echo "安装 luci-app-substore..."
    apk add luci-app-substore

elif [ -x /bin/opkg ]; then
    echo "检测到 opkg 包管理器 (OpenWrt 24.10 及更早)"

    wget -q -O /tmp/substore-ipk.pub "$REPO_URL/substore-ipk.pub"
    opkg-key add /tmp/substore-ipk.pub
    rm -f /tmp/substore-ipk.pub

    echo "添加软件源..."
    # 同上：单独放 /etc/opkg/substore.conf，不追加进公共的
    # customfeeds.conf。opkg 会自动读取 /etc/opkg/ 下所有 *.conf 文件，
    # 文件名本身不用是 customfeeds.conf 也一样生效。
    echo "src/gz substore $REPO_URL/openwrt-23.05/all" > /etc/opkg/substore.conf

    echo "更新索引..."
    # 同上：不让不相关源的抖动杀死整个脚本
    opkg update || true

    echo "安装 luci-app-substore..."
    opkg install luci-app-substore

else
    echo "错误: 未检测到 opkg 或 apk，不支持的系统" >&2
    exit 1
fi

echo "=== 安装完成 ==="
echo "请在 LuCI 中查看 luci-app-substore"
