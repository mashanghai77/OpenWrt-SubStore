include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for Sub-Store (Subscription Manager)
LUCI_DEPENDS:=+node +unzip +wget-ssl
LUCI_PKGARCH:=all

PKG_NAME:=luci-app-substore
PKG_VERSION:=2.9
PKG_RELEASE:=1
PKG_LICENSE:=GPL-3.0
PKG_MAINTAINER:=xiaohai77

# Sub-Store 官方后端/前端最新 release 地址。之前这两个文件是靠 GitHub Actions
# 在编译前手动 wget 下载塞进 root/ 目录，git 仓库里其实从没提交过。
# 别人直接拿这个仓库当 feed 编译时 root/ 下没有这两个东西，会直接报错。
# 现在改成编译时自己下载，不再依赖外部 CI 提前把文件塞进 root/。
SUBSTORE_BACKEND_URL:=https://github.com/sub-store-org/Sub-Store/releases/latest/download/sub-store.bundle.js
SUBSTORE_FRONTEND_URL:=https://github.com/sub-store-org/Sub-Store-Front-End/releases/latest/download/dist.zip

include $(TOPDIR)/feeds/luci/luci.mk

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	echo "下载 Sub-Store 后端 bundle..."
	wget -q -O $(PKG_BUILD_DIR)/sub-store.bundle.js "$(SUBSTORE_BACKEND_URL)"
	[ -s $(PKG_BUILD_DIR)/sub-store.bundle.js ] || { echo "错误: 后端下载失败或为空" >&2; exit 1; }

	echo "下载 Sub-Store 前端 dist..."
	wget -q -O $(PKG_BUILD_DIR)/dist.zip "$(SUBSTORE_FRONTEND_URL)"
	[ -s $(PKG_BUILD_DIR)/dist.zip ] || { echo "错误: 前端下载失败或为空" >&2; exit 1; }
	# dist.zip 内部自带一层 dist/ 目录(dist/index.html ...)，
	# 解压目标要写 PKG_BUILD_DIR 本身，不能再套一层 PKG_BUILD_DIR/dist，
	# 否则会变成 PKG_BUILD_DIR/dist/dist/index.html，装上后网页打不开
	rm -rf $(PKG_BUILD_DIR)/dist
	unzip -q -o $(PKG_BUILD_DIR)/dist.zip -d $(PKG_BUILD_DIR)
	[ -f $(PKG_BUILD_DIR)/dist/index.html ] || { echo "错误: 解压后没找到 dist/index.html，前端包结构可能变了" >&2; exit 1; }
endef

define Build/Compile
endef

define Package/luci-app-substore/install
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./root/etc/init.d/substore $(1)/etc/init.d/substore
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_DATA) ./root/etc/config/substore $(1)/etc/config/substore
	$(INSTALL_DIR) $(1)/usr/libexec/substore
	$(INSTALL_BIN) ./root/usr/libexec/substore/postinstall.sh $(1)/usr/libexec/substore/postinstall.sh
	$(INSTALL_BIN) ./root/usr/libexec/substore/update-backend.sh $(1)/usr/libexec/substore/update-backend.sh
	$(INSTALL_BIN) ./root/usr/libexec/substore/update-frontend.sh $(1)/usr/libexec/substore/update-frontend.sh
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/sub-store.bundle.js $(1)/usr/libexec/substore/sub-store.bundle.js
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
	$(CP) $(PKG_BUILD_DIR)/dist $(1)/www/sub-store/
endef

define Package/luci-app-substore/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
/usr/libexec/substore/postinstall.sh
exit 0
endef

$(eval $(call BuildPackage,luci-app-substore))
