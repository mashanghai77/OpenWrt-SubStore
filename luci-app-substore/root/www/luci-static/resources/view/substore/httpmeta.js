'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require ui';
'require fs';

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

var callRunCmd = rpc.declare({
	object: 'file',
	method: 'exec',
	params: ['command', 'params'],
	expect: { '': {} }
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

function readVersionFile(path) {
	return fs.read(path).then(function(v) {
		return (v || '').trim();
	}).catch(function() {
		return null;
	});
}

function loadVersionInfo() {
	return Promise.all([
		readVersionFile('/usr/libexec/substore/http-meta.version'),
		readVersionFile('/usr/libexec/substore/http-meta-core.version')
	]).then(function(res) {
		return { bundleVersion: res[0], coreVersion: res[1] };
	});
}

function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, function(c) {
		return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
	});
}

function formatVersionLine(label, version) {
	var v = (version && version !== 'unknown') ? version : '未安装';
	if (v.length > 60) v = v.slice(0, 60) + '…';
	return '<div style="display:flex !important;justify-content:space-between;align-items:center;' +
		'background:linear-gradient(135deg,#ffffff,#f5f7fb);' +
		'border:1px solid #e3e8f0;border-radius:8px;padding:5px 10px;' +
		'box-shadow:0 1px 2px rgba(0,0,0,0.04);width:100% !important;box-sizing:border-box;">' +
		'<span style="font-size:11px;color:#8a94a6;font-weight:500;">' + label + '</span>' +
		'<span style="font-size:13px;font-weight:600;color:#2d3748;word-break:break-all;text-align:right;">' + escapeHtml(v) + '</span>' +
		'</div>';
}

function renderVersionInfo(info) {
	return '<div style="display:grid !important;grid-template-columns:repeat(2,1fr) !important;gap:8px !important;width:100% !important;">' +
		formatVersionLine('http-meta 版本', info.bundleVersion) +
		formatVersionLine('内核版本', info.coreVersion) +
		'</div>';
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

function renderToggleButton(isRunning) {
	var label = isRunning ? '停止服务' : '启动服务';
	var cls = isRunning ? 'cbi-button-remove' : 'cbi-button-action';
	return '<button id="btn_hm_toggle" class="btn cbi-button ' + cls + '" ' +
		'style="' + actionButtonStyle(true) + '">' + label + '</button>';
}

function renderActionsPanel(isRunning, isEnabled) {
	var toggleHtml = renderToggleButton(isRunning);
	var restartStyle = actionButtonStyle(isEnabled);
	return '<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #e3e8f0;">' + toggleHtml + '</div>' +
		'<button class="btn cbi-button cbi-button-apply" id="btn_hm_restart" style="' + restartStyle + '">重启服务</button>';
}

function injectDesktopCss() {
	if (document.getElementById('httpmeta_desktop_css')) return;
	var style = document.createElement('style');
	style.id = 'httpmeta_desktop_css';
	style.textContent =
		'@media (min-width: 768px) {' +
		'#httpmeta_status_wrap, #httpmeta_version_info, #httpmeta_actions_panel, #httpmeta_update_panel {' +
		'max-width: 480px !important; margin-left: 0 !important; margin-right: auto !important;' +
		'}}';
	document.head.appendChild(style);
}

function runSourceScript(scriptPath, source) {
	return callRunCmd(scriptPath, [source]).then(function(res) {
		var stdout = (res && res.stdout) ? res.stdout.trim() : '';
		var stderr = (res && res.stderr) ? res.stderr.trim() : '';
		var code = res ? res.code : -1;

		if (code === 0 && stdout === 'OK') return { ok: true };
		if (code === 0 && stdout.indexOf('DOWNLOAD_FAILED:') === 0) {
			return { ok: false, retry: true, message: stdout.slice('DOWNLOAD_FAILED:'.length).trim() };
		}
		return { ok: false, retry: false, message: stderr || stdout || ('脚本执行失败（退出码 ' + code + '）') };
	});
}

var SOURCE_CHAIN = [
	{ source: 'proxy', name: '加速代理' },
	{ source: 'official', name: '官方源' }
];

function updateWithFallback(scriptPath, label, statusEl) {
	function tryStep(i) {
		var step = SOURCE_CHAIN[i];
		statusEl.style.color = '#666';
		statusEl.textContent = '正在尝试' + step.name + '下载' + label + '...';

		return runSourceScript(scriptPath, step.source).then(function(r) {
			if (r.ok) return r;
			if (!r.retry) throw new Error(r.message);

			var next = SOURCE_CHAIN[i + 1];
			if (!next) throw new Error(step.name + '下载失败：' + r.message);

			statusEl.style.color = '#e67e22';
			statusEl.textContent = step.name + '下载失败（' + r.message + '），正在改用' + next.name + '...';

			return tryStep(i + 1);
		});
	}
	return tryStep(0);
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

var ENABLE_HINT_TEXT = '服务当前未启用：请先安装内核，再点击"启动服务"';

function guardedClick(btn, action) {
	if (!btn) return;
	btn.addEventListener('click', function() {
		if (!isServiceEnabled()) return;
		action();
	});
}

function bindActionButtons(node) {
	var btnToggle = node.querySelector('#btn_hm_toggle');
	if (btnToggle) {
		btnToggle.addEventListener('click', function() {
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
	guardedClick(btnRestart, function() {
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
			getServiceStatus(),
			loadVersionInfo()
		]);
	},

	render: function(data) {
		var isRunning = data[1];
		var versionInfo = data[2];
		var isEnabled = isServiceEnabled();
		var m, s, o;

		m = new form.Map('substore', _('Sub-Store'),
			_('HTTP-META 为测活/延迟/落地检测等脚本提供本地 Meta(mihomo) 内核测试能力，属于可选组件，用不到相关脚本可以不装。'));

		// ── 服务状态 ────────────────────────────────────────────
		s = m.section(form.NamedSection, 'http_meta', 'http_meta', _('服务状态'));
		s.anonymous = true;

		o = s.option(form.DummyValue, '_status', '');
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<div id="httpmeta_status_wrap">' + renderStatusBadge(isRunning) + '</div>';
		};

		o = s.option(form.DummyValue, '_version', '');
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<div id="httpmeta_version_info">' + renderVersionInfo(versionInfo) + '</div>';
		};

		o = s.option(form.DummyValue, '_actions', _('操作'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<div id="httpmeta_actions_panel">' + renderActionsPanel(isRunning, isEnabled) + '</div>';
		};
		o.write = function() {};

		o = s.option(form.DummyValue, '_update', '');
		o.rawhtml = true;
		o.cfgvalue = function() {
			var style = actionButtonStyle(true);
			return '<div id="httpmeta_update_panel" style="margin-top:8px;">' +
				'<button class="btn cbi-button cbi-button-action" id="btn_install_httpmeta" style="' + style + '">安装/更新 HTTP-META（bundle + 内核）</button>' +
				'<span id="httpmeta_update_status" style="display:block;font-size:13px;color:#666;text-align:center;margin-top:6px;"></span>' +
				'</div>';
		};
		o.write = function() {};

		o = s.option(form.DummyValue, '_enable_hint', '');
		o.rawhtml = true;
		o.cfgvalue = function() {
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

		o = s.option(form.Value, 'meta_dir', _('内核数据目录'), _('存放 http-meta 内核可执行文件与 tpl.yaml，对应环境变量 META_FOLDER 的上级目录'));
		o.default = '/etc/sub-store/http-meta';

		o = s.option(form.Flag, 'reuse_core', _('自动复用已有内核'), _('若路由器已安装 OpenClash/nikki，安装时优先软链接复用其 mihomo 内核，不重复下载'));
		o.default = '1';

		o = s.option(form.Value, 'external_core_path', _('外部内核路径'), _('手动指定一个已存在的 mihomo/clash-meta 可执行文件路径，设置后优先于自动探测/下载'));
		o.placeholder = '/usr/bin/mihomo';

		return m.render().then(function(node) {
			injectDesktopCss();

			forceStackedRow(node, 'httpmeta_status_wrap');
			forceStackedRow(node, 'httpmeta_version_info');
			forceStackedRow(node, 'httpmeta_actions_panel', 'left');
			forceStackedRow(node, 'httpmeta_update_panel');

			bindActionButtons(node);

			var btnInstall = node.querySelector('#btn_install_httpmeta');
			var updateStatus = node.querySelector('#httpmeta_update_status');
			if (btnInstall) {
				btnInstall.addEventListener('click', function() {
					btnInstall.disabled = true;
					updateWithFallback('/usr/libexec/substore/update-http-meta.sh', 'HTTP-META', updateStatus).then(function() {
						updateStatus.style.color = '#2ecc71';
						updateStatus.textContent = '安装/更新成功。';
						return Promise.all([loadVersionInfo(), getServiceStatus()]);
					}).then(function(res) {
						var info = res[0];
						if (!info) return;
						var el = node.querySelector('#httpmeta_version_info');
						if (el) el.innerHTML = renderVersionInfo(info);
					}).catch(function(err) {
						updateStatus.style.color = '#e74c3c';
						updateStatus.textContent = '安装/更新失败：' + (err && err.message ? err.message : '未知错误');
					}).finally(function() {
						btnInstall.disabled = false;
					});
				});
			}

			return node;
		});
	}
});
