#!/bin/sh

mkdir -p /etc/sub-store

chmod +x /etc/init.d/substore
/etc/init.d/substore enable

echo "Sub-Store installed. Enable it in Services > Sub-Store."

rm -f /tmp/luci-indexcache* >/dev/null 2>&1
rm -rf /tmp/luci-modulecache/* >/dev/null 2>&1
/etc/init.d/rpcd reload >/dev/null 2>&1

exit 0
