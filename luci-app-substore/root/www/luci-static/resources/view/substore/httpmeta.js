'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require ui';

var callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: ['name'],
	expect: { '': {} }
});

var callInitAction = rpc.declare({
	object: 'rc',
	method: 'init',
	params: ['name', 'action']
});

function getServiceStatus() {
	return callServiceList('http-meta').then(function(res) {
		try {
			return res['http-meta']['instances']['instance1']['running'];
		} catch (e) {
			return false;
		}
	});
}

function isServiceEnabled() {
	return uci.get('substore', 'http_meta', 'enabled') === '1';
}

// HTTP-META 依附于 Sub-Store 主程序：主程序没启用时整个操作区置灰不可用，
// 主程序被停止时 HTTP-META 也跟着一起停（联动逻辑见 main.js 的 toggleServiceAndReload）。
function isMainServiceEnabled() {
	return uci.get('substore', 'config', 'enabled') === '1';
}

function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, function(c) {
		return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
	});
}

function renderStatusBadge(isRunning) {
	var color = isRunning ? '#2ecc71' : '#e74c3c';
	var text = 'HTTP-META ' + (isRunning ? '运行中' : '未运行');
	return '<div id="httpmeta_status_indicator" style="display:flex !important;align-items:center;justify-content:center;gap:8px;' +
		'background:linear-gradient(135deg,#ffffff,#f5f7fb);' +
		'border:1px solid #e3e8f0;border-radius:8px;padding:8px 14px;width:100% !important;box-sizing:border-box;' +
		'box-shadow:0 1px 2px rgba(0,0,0,0.04);">' +
		'<span style="width:9px;height:9px;border-radius:50%;background:' + color + ';flex-shrink:0;"></span>' +
		'<span style="font-style:italic;font-weight:700;font-size:15px;line-height:1.4 !important;color:' + color + ';letter-spacing:-0.3px;">' + text + '</span>' +
		'</div>';
}

function actionButtonStyle(enabled) {
	var base = 'display:block !important;width:100% !important;box-sizing:border-box !important;' +
		'margin:0 !important;float:none !important;text-align:center;padding:8px 8px;' +
		'font-size:13px;font-weight:400;line-height:1.4 !important;overflow:visible !important;' +
		'white-space:normal !important;height:auto !important;';
	return base + (enabled ? '' : 'opacity:0.45;filter:grayscale(70%);cursor:not-allowed;');
}

function renderToggleButton(isRunning, mainEnabled) {
	var label = isRunning ? '停止服务' : '启动服务';
	var cls = isRunning ? 'cbi-button-remove' : 'cbi-button-action';
	return '<button id="btn_hm_toggle" class="btn cbi-button ' + cls + '" ' +
		(mainEnabled ? '' : 'disabled ') +
		'style="' + actionButtonStyle(mainEnabled) + '">' + label + '</button>';
}

function renderActionsPanel(isRunning, isEnabled, mainEnabled) {
	var toggleHtml = renderToggleButton(isRunning, mainEnabled);
	var restartStyle = actionButtonStyle(mainEnabled && isEnabled);
	return '<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #e3e8f0;">' + toggleHtml + '</div>' +
		'<button class="btn cbi-button cbi-button-apply" id="btn_hm_restart" ' + (mainEnabled ? '' : 'disabled ') +
		'style="' + restartStyle + '">重启服务</button>';
}

function injectDesktopCss() {
	if (document.getElementById('httpmeta_desktop_css')) return;
	var style = document.createElement('style');
	style.id = 'httpmeta_desktop_css';
	style.textContent =
		'@media (min-width: 768px) {' +
		'#httpmeta_status_wrap, #httpmeta_actions_panel {' +
		'max-width: 480px !important; margin-left: 0 !important; margin-right: auto !important;' +
		'}}';
	document.head.appendChild(style);
}

function waitForApplySettle(ms) {
	return new Promise(function(resolve) { setTimeout(resolve, ms || 2000); });
}

function afterActionReload() {
	return waitForApplySettle(1500).then(function() {
		window.location.reload();
	});
}

function runInitActionAndReload(action) {
	return callInitAction('http-meta', action).then(function() {
		return afterActionReload();
	});
}

function suppressChangeIndicator() {
	if (!ui.changes || typeof ui.changes.setIndicator !== 'function') return function() {};
	var original = ui.changes.setIndicator;
	ui.changes.setIndicator = function() {
		return original.call(ui.changes, 0);
	};
	return function restore() {
		ui.changes.setIndicator = original;
	};
}

function toggleServiceAndReload(action) {
	var newEnabled = (action === 'start') ? '1' : '0';
	var restoreIndicator = suppressChangeIndicator();

	uci.set('substore', 'http_meta', 'enabled', newEnabled);

	return uci.save().then(function() {
		return uci.apply();
	}).then(function() {
		return afterActionReload();
	}).finally(function() {
		restoreIndicator();
	});
}

var ENABLE_HINT_TEXT = '服务当前未启用：请先点击"启动服务"';
var MAIN_DISABLED_HINT_TEXT = '请先在「基础设置」启用 Sub-Store 主程序，才能使用 HTTP-META';

function guardedClick(btn, mainEnabled, action) {
	if (!btn) return;
	btn.addEventListener('click', function() {
		if (!mainEnabled) return;
		if (!isServiceEnabled()) return;
		action();
	});
}

function bindActionButtons(node, mainEnabled) {
	var btnToggle = node.querySelector('#btn_hm_toggle');
	if (btnToggle) {
		btnToggle.addEventListener('click', function() {
			if (!mainEnabled) return;
			var action = btnToggle.textContent.indexOf('停止') !== -1 ? 'stop' : 'start';
			btnToggle.disabled = true;
			if (action === 'start') btnToggle.style.color = '#e67e22';
			btnToggle.textContent = (action === 'stop') ? '停止中...' : '启动中...';
			toggleServiceAndReload(action).catch(function() {
				ui.addNotification(null, E('p', (action === 'stop' ? '停止' : '启动') + '失败。'), 'danger');
				btnToggle.disabled = false;
				btnToggle.style.color = '';
				btnToggle.textContent = (action === 'stop') ? '停止服务' : '启动服务';
			});
		});
	}

	var btnRestart = node.querySelector('#btn_hm_restart');
	guardedClick(btnRestart, mainEnabled, function() {
		btnRestart.disabled = true;
		btnRestart.style.color = '#e67e22';
		btnRestart.textContent = '重启中...';
		runInitActionAndReload('restart').catch(function() {
			ui.addNotification(null, E('p', '重启失败。'), 'danger');
			btnRestart.disabled = false;
			btnRestart.style.color = '';
			btnRestart.textContent = '重启服务';
		});
	});
}

function forceStackedRow(node, innerId, align) {
	var el = node.querySelector('#' + innerId);
	if (!el) return;
	var row = el.closest('.cbi-value') || el.parentElement;
	if (row) {
		row.style.setProperty('display', 'block', 'important');
		row.style.overflow = 'visible';
	}
	var title = row ? row.querySelector('.cbi-value-title') : null;
	if (title) {
		title.style.setProperty('display', 'block', 'important');
		title.style.setProperty('width', 'auto', 'important');
		title.style.setProperty('float', 'none', 'important');
		title.style.marginBottom = '8px';
		if (align) title.style.setProperty('text-align', align, 'important');
	}
	var field = row ? row.querySelector('.cbi-value-field') : null;
	if (field) {
		field.style.setProperty('display', 'block', 'important');
		field.style.setProperty('width', '100%', 'important');
		field.style.setProperty('max-width', 'none', 'important');
		field.style.setProperty('margin-left', '0', 'important');
		field.style.setProperty('float', 'none', 'important');
	}
}

function validateHost(value) {
	if (!value || value.trim() === '') return true;
	var v = value.trim();
	if (v === '127.0.0.1' || v === '::1' || v === '0.0.0.0' || v === '::') return true;
	return _('监听地址建议使用 127.0.0.1（仅本机，推荐）、0.0.0.0 或 ::（不建议对外暴露）');
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('substore'),
			getServiceStatus()
		]);
	},

	render: function(data) {
		var isRunning = data[1];
		var isEnabled = isServiceEnabled();
		var mainEnabled = isMainServiceEnabled();
		var m, s, o;

		m = new form.Map('substore', _('Sub-Store'),
			_('HTTP-META 为测活/延迟/落地检测等脚本提供本地 Meta(mihomo) 内核测试能力，属于可选组件，用不到相关脚本可以不装。所需的 bundle 与 mihomo 内核已随本包一起安装完毕，直接启动即可使用。依赖 Sub-Store 主程序，主程序未启用或被停止时本页操作不可用。'));

		// ── 服务状态 ────────────────────────────────────────────
		s = m.section(form.NamedSection, 'http_meta', 'http_meta', _('服务状态'));
		s.anonymous = true;

		o = s.option(form.DummyValue, '_status', '');
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<div id="httpmeta_status_wrap">' + renderStatusBadge(isRunning) + '</div>';
		};

		o = s.option(form.DummyValue, '_actions', _('操作'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<div id="httpmeta_actions_panel">' + renderActionsPanel(isRunning, isEnabled, mainEnabled) + '</div>';
		};
		o.write = function() {};

		o = s.option(form.DummyValue, '_enable_hint', '');
		o.rawhtml = true;
		o.cfgvalue = function() {
			if (!mainEnabled) {
				return '<div id="httpmeta_enable_hint" style="color:#e74c3c;font-size:13px;">⚠ ' + escapeHtml(MAIN_DISABLED_HINT_TEXT) + '</div>';
			}
			if (isEnabled) return '';
			return '<div id="httpmeta_enable_hint" style="color:#e74c3c;font-size:13px;">⚠ ' + escapeHtml(ENABLE_HINT_TEXT) + '</div>';
		};

		// ── 监听设置 ────────────────────────────────────────────
		s = m.section(form.NamedSection, 'http_meta', 'http_meta', _('监听设置'));
		s.anonymous = true;

		o = s.option(form.Value, 'host', _('监听地址'), _('对应环境变量 HOST，默认只监听本机，脚本从路由器本地调用即可'));
		o.default = '127.0.0.1';
		o.validate = function(section_id, value) { return validateHost(value); };

		o = s.option(form.Value, 'port', _('监听端口'), _('对应环境变量 PORT，默认 9876，注意与 ddns-go 等常见服务的端口冲突'));
		o.default = '9876';
		o.datatype = 'port';

		o = s.option(form.Value, 'authorization', _('鉴权 Token'), _('对应环境变量 AUTHORIZATION，设置后调用需带 Authorization 请求头，留空则不鉴权'));
		o.password = true;

		// ── 内核与端口范围 ──────────────────────────────────────
		s = m.section(form.NamedSection, 'http_meta', 'http_meta', _('内核与测试端口'));
		s.anonymous = true;

		o = s.option(form.Value, 'min_available_port', _('最小可用端口'), _('对应环境变量 META_MIN_AVAILABLE_PORT，测试实例使用的端口下限，留空使用内核默认'));
		o.datatype = 'range(1024,65535)';
		o.placeholder = '留空使用默认';

		o = s.option(form.Value, 'max_available_port', _('最大可用端口'), _('对应环境变量 META_MAX_AVAILABLE_PORT，测试实例使用的端口上限，留空使用内核默认'));
		o.datatype = 'range(1024,65535)';
		o.placeholder = '留空使用默认';

		o = s.option(form.Flag, 'disable_auto_clean', _('禁用自动清理'), _('对应环境变量 META_DISABLE_AUTO_CLEAN，开启后临时文件夹里的内核日志/配置不会自动清理，方便调试'));
		o.default = '0';

		o = s.option(form.Value, 'temp_folder', _('临时文件目录'), _('对应环境变量 META_TEMP_FOLDER，留空使用系统默认临时目录'));
		o.placeholder = '/etc/sub-store/http-meta/tmp';

		o = s.option(form.Value, 'body_json_limit', _('请求体大小限制'), _('对应环境变量 BODY_JSON_LIMIT，例如 1mb、10mb'));
		o.default = '1mb';
		o.placeholder = '1mb';

		o = s.option(form.Value, 'meta_dir', _('内核数据目录'), _('存放 http-meta 运行时的内核软链接与 tpl.yaml，对应环境变量 META_FOLDER 的上级目录'));
		o.default = '/etc/sub-store/http-meta';

		o = s.option(form.Value, 'external_core_path', _('外部内核路径'), _('留空默认使用本包依赖自动安装好的 /usr/bin/mihomo；如需使用其它版本的 mihomo/clash-meta，可在此手动指定可执行文件路径，设置后优先生效'));
		o.placeholder = '/usr/bin/mihomo';

		return m.render().then(function(node) {
			injectDesktopCss();

			forceStackedRow(node, 'httpmeta_status_wrap');
			forceStackedRow(node, 'httpmeta_actions_panel', 'left');

			bindActionButtons(node, mainEnabled);

			return node;
		});
	}
});
