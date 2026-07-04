include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for Sub-Store (Subscription Manager)
LUCI_DEPENDS:=+node +unzip +wget-ssl
LUCI_PKGARCH:=all

PKG_NAME:=luci-app-substore
PKG_VERSION:=2.9
PKG_RELEASE:=1
PKG_LICENSE:=GPL-3.0
PKG_MAINTAINER:=xiaohai77

# 之前 sub-store.bundle.js / dist 是靠 GitHub Actions 编译前手动 wget 塞进
# root/ 目录，git 仓库里从没提交过。别人拿仓库当 feed 编译会因为 root/
# 下没这两个文件而失败。
#
# 上一版我把下载动作放进了 Build/Prepare，结果实测发现 luci.mk 这种
# arch:all、没有真正编译步骤的纯前端包，压根不会触发 Build/Prepare 这个
# 阶段（它走的是更简化的直装流程），导致下载代码从没执行过。
# 这一版改成直接放进 Package/install 里——这一步是确定会执行的
# （旧版本 Makefile 靠的也是这个阶段），下载完直接装到 $(1) 里，
# 不再依赖 PKG_BUILD_DIR / Build/Prepare。
SUBSTORE_BACKEND_URL:=https://github.com/sub-store-org/Sub-Store/releases/latest/download/sub-store.bundle.js
SUBSTORE_FRONTEND_URL:=https://github.com/sub-store-org/Sub-Store-Front-End/releases/latest/download/dist.zip

include $(TOPDIR)/feeds/luci/luci.mk

define Package/luci-app-substore/install
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./root/etc/init.d/substore $(1)/etc/init.d/substore
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_DATA) ./root/etc/config/substore $(1)/etc/config/substore
	$(INSTALL_DIR) $(1)/usr/libexec/substore
	$(INSTALL_BIN) ./root/usr/libexec/substore/postinstall.sh $(1)/usr/libexec/substore/postinstall.sh
	$(INSTALL_BIN) ./root/usr/libexec/substore/update-backend.sh $(1)/usr/libexec/substore/update-backend.sh
	$(INSTALL_BIN) ./root/usr/libexec/substore/update-frontend.sh $(1)/usr/libexec/substore/update-frontend.sh

	echo "下载 Sub-Store 后端 bundle..."
	wget -q -O $(1)/usr/libexec/substore/sub-store.bundle.js "$(SUBSTORE_BACKEND_URL)"
	if [ ! -s $(1)/usr/libexec/substore/sub-store.bundle.js ]; then \
		echo "错误: 后端下载失败或为空: $(SUBSTORE_BACKEND_URL)" >&2; \
		exit 1; \
	fi

	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/luci-app-substore.json $(1)/usr/share/luci/menu.d/luci-app-substore.json
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/luci-app-substore.json $(1)/usr/share/rpcd/acl.d/luci-app-substore.json
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/substore
	$(INSTALL_DATA) ./root/www/luci-static/resources/view/substore/main.js $(1)/www/luci-static/resources/view/substore/main.js
	$(INSTALL_DATA) ./root/www/luci-static/resources/view/substore/advanced.js $(1)/www/luci-static/resources/view/substore/advanced.js
	$(INSTALL_DATA) ./root/www/luci-static/resources/view/substore/network.js $(1)/www/luci-static/resources/view/substore/network.js
	$(INSTALL_DATA) ./root/www/luci-static/resources/view/substore/recovery.js $(1)/www/luci-static/resources/view/substore/recovery.js
	$(INSTALL_DATA) ./root/www/luci-static/resources/view/substore/cron.js $(1)/www/luci-static/resources/view/substore/cron.js

	$(INSTALL_DIR) $(1)/www/sub-store
	echo "下载 Sub-Store 前端 dist..."
	wget -q -O /tmp/substore-dist-luci-app-substore.zip "$(SUBSTORE_FRONTEND_URL)"
	if [ ! -s /tmp/substore-dist-luci-app-substore.zip ]; then \
		echo "错误: 前端下载失败或为空: $(SUBSTORE_FRONTEND_URL)" >&2; \
		rm -f /tmp/substore-dist-luci-app-substore.zip; \
		exit 1; \
	fi
	unzip -q -o /tmp/substore-dist-luci-app-substore.zip -d $(1)/www/sub-store
	rm -f /tmp/substore-dist-luci-app-substore.zip
	if [ ! -f $(1)/www/sub-store/dist/index.html ]; then \
		echo "错误: 解压后没找到 dist/index.html，前端包结构可能变了" >&2; \
		exit 1; \
	fi
endef

define Package/luci-app-substore/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
/usr/libexec/substore/postinstall.sh
exit 0
endef

$(eval $(call BuildPackage,luci-app-substore))
