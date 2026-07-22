'use strict';
'require view';
'require form';
'require uci';

return view.extend({
	load: function() {
		return uci.load('substore');
	},

	render: function() {
		var m, s, o;

		m = new form.Map('substore', _('Sub-Store'), null);

		// ── 高级设置 ────────────────────────────────────────────
		s = m.section(form.NamedSection, 'config', 'substore', _('高级设置'));
		s.anonymous = true;

		o = s.option(form.Value, 'backend_custom_icon', _('自定义图标URL'), _('显示在前端界面上的后端图标'));
		o.placeholder = 'https://example.com/icon.png';

		o = s.option(form.Value, 'x_powered_by', _('X-Powered-By 响应头'), _('自定义 HTTP 响应头中的 X-Powered-By 字段'));
		o.placeholder = 'Express';

		o = s.option(form.Value, 'cors_allowed_origins', _('CORS 允许来源'), _('允许访问后端 API 的浏览器来源，多个用逗号分隔，* 表示允许所有'));
		o.default = '*';
		o.placeholder = '*';

		o = s.option(form.Value, 'max_header_size', _('最大 Header 大小（字节）'), _('遇到 Headers Overflow Error 时可适当调大'));
		o.default = '32768';
		o.datatype = 'uinteger';

		o = s.option(form.Value, 'body_json_limit', _('JSON Body 大小限制'), _('例如 1mb、10mb'));
		o.default = '1mb';
		o.placeholder = '1mb';

		o = s.option(form.Value, 'backend_prefix', _('后端路径附加前缀'), _('设置后，后端 API 端口（即使未走前端合并）也会额外带上「后端路径前缀」设置的后缀，适合同主机防扫场景，一般不用填'));

		// ── MMDB 落地检测数据库 ──────────────────────────────────
		s = m.section(form.NamedSection, 'config', 'substore', _('MMDB 落地检测数据库'));
		s.anonymous = true;
		s.description = _('配合检测落地/检测入口脚本使用，数据来自本地数据库，可节省大量请求耗时；不使用这类脚本可以不填');

		o = s.option(form.Value, 'mmdb_country_path', _('Country 数据库路径'), _('GeoLite2-Country.mmdb 在路由器上的存放路径'));
		o.placeholder = '/etc/sub-store/GeoLite2-Country.mmdb';

		o = s.option(form.Value, 'mmdb_country_url', _('Country 数据库下载地址'), _('用于自动下载/更新 GeoLite2-Country.mmdb'));

		o = s.option(form.Value, 'mmdb_asn_path', _('ASN 数据库路径'), _('GeoLite2-ASN.mmdb 在路由器上的存放路径'));
		o.placeholder = '/etc/sub-store/GeoLite2-ASN.mmdb';

		o = s.option(form.Value, 'mmdb_asn_url', _('ASN 数据库下载地址'), _('用于自动下载/更新 GeoLite2-ASN.mmdb'));

		o = s.option(form.Value, 'mmdb_cron', _('数据库定时更新'), _('cron 表达式，需要同时设置了 Country 或 ASN 的路径+下载地址才会生效'));
		o.placeholder = '0 0 * * *';

		// ── 推送通知 ────────────────────────────────────────────
		s = m.section(form.NamedSection, 'config', 'substore', _('推送通知'));
		s.anonymous = true;

		o = s.option(form.Value, 'push_service', _('推送服务URL'), _('支持 Bark、Telegram、PushPlus 等，用 [推送标题] 和 [推送内容] 作为占位符'));
		o.placeholder = 'https://api.day.app/YOUR_KEY/[推送标题]/[推送内容]';

		return m.render();
	}
});
