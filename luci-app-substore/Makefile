include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for Sub-Store (Subscription Manager)
LUCI_DEPENDS:=+node +unzip
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
#
# 2026-07 修复：之前这里直连 GitHub Releases 下载 bundle.js / dist.zip，
# 没有超时设置。GitHub Actions 的 CI runner 在国外机房访问 GitHub 很快，
# 从没暴露过问题；但本地/自建环境网络到 GitHub 不稳时，wget 会卡住不动、
# 不报错也不退出，导致整个固件编译卡死几个小时（表现为编译日志停在某个
# 毫不相关的包上，因为那只是并行编译里刚好同时跑完的其他任务）。
# 现在改成优先走自己的 Cloudflare 镜像（跟 ipk/apk 签名索引同一套基建），
# 镜像失败再退回 GitHub 直连兜底，并且两边都加了超时/重试，超时就直接
# 报错退出，不会再无限期卡死。
SUBSTORE_MIRROR_BACKEND_URL:=https://substore-openwrt.445568.xyz/assets/sub-store.bundle.js
SUBSTORE_MIRROR_FRONTEND_URL:=https://substore-openwrt.445568.xyz/assets/dist.zip
SUBSTORE_BACKEND_URL:=https://github.com/sub-store-org/Sub-Store/releases/latest/download/sub-store.bundle.js
SUBSTORE_FRONTEND_URL:=https://github.com/sub-store-org/Sub-Store-Front-End/releases/latest/download/dist.zip

# 连接超时15秒、总重试2次、重试间隔3秒——卡住15秒就判定失败，绝不无限等待。
WGET_OPTS:=--timeout=15 --tries=2 --waitretry=3

include $(TOPDIR)/feeds/luci/luci.mk

# $(1) = 目标文件路径, $(2) = 镜像URL, $(3) = 兜底URL, $(4) = 描述文字
define DownloadWithFallback
	echo "下载 $(4)（优先走自己的镜像）..."; \
	if wget $(WGET_OPTS) -q -O "$(1)" "$(2)" && [ -s "$(1)" ]; then \
		echo "$(4) 镜像下载成功"; \
	else \
		echo "镜像下载失败或为空，改用官方源重试: $(3)" >&2; \
		if ! wget $(WGET_OPTS) -q -O "$(1)" "$(3)"; then \
			echo "错误: $(4) 下载失败（镜像和官方源都不通）: $(3)" >&2; \
			rm -f "$(1)"; \
			exit 1; \
		fi; \
	fi; \
	if [ ! -s "$(1)" ]; then \
		echo "错误: $(4) 下载结果为空" >&2; \
		rm -f "$(1)"; \
		exit 1; \
	fi
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

	$(call DownloadWithFallback,$(1)/usr/libexec/substore/sub-store.bundle.js,$(SUBSTORE_MIRROR_BACKEND_URL),$(SUBSTORE_BACKEND_URL),Sub-Store 后端 bundle)

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
	$(call DownloadWithFallback,/tmp/substore-dist-luci-app-substore.zip,$(SUBSTORE_MIRROR_FRONTEND_URL),$(SUBSTORE_FRONTEND_URL),Sub-Store 前端 dist)
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
