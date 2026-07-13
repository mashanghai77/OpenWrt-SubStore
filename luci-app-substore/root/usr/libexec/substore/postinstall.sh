#!/bin/sh

mkdir -p /etc/sub-store

chmod +x /etc/init.d/substore
/etc/init.d/substore enable

echo "Sub-Store installed."

rm -f /tmp/luci-indexcache* 
rm -rf /tmp/luci-modulecache/

# 重载 rpcd（不打断当前会话），这样新增的 acl.d 权限才会对已登录的 session 生效，
# 不用像 killall -HUP rpcd 那样只刷新了 rpcd 自身的 ACL 定义、却刷新不到当前 session 的授权快照。
[ -x /etc/init.d/rpcd ] && /etc/init.d/rpcd reload >/dev/null 2>&1

exit 0
