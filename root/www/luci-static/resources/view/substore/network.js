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

		s = m.section(form.NamedSection, 'config', 'substore', _('端口与网络'));
		s.anonymous = true;

		o = s.option(form.Value, 'frontend_port', _('服务端口'), _('前端和后端统一使用此端口'));
		o.default = '3001';
		o.datatype = 'port';

		o = s.option(form.Value, 'frontend_host', _('监听地址'), _(':: 表示同时监听 IPv4 和 IPv6'));
		o.default = '::';
		o.placeholder = '::';

		o = s.option(form.Value, 'backend_default_proxy', _('默认代理'), _('抓取订阅时使用的代理，支持 socks5://、http://、https://'));
		o.placeholder = 'http://127.0.0.1:7890';

		return m.render();
	}
});
