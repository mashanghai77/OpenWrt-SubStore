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
	return callServiceList('substore').then(function(res) {
		try {
			return res['substore']['instances']['instance1']['running'];
		} catch(e) {
			return false;
		}
	});
}

// 版本文件由 Makefile 安装阶段 / update-backend.sh / update-frontend.sh
// 在"实际下载发生的那一刻"写入，不是另开一条独立的记录渠道，所以点了
// 更新按钮之后这里显示的内容一定跟到底装的是哪个版本对得上。
// 文件不存在（比如老版本装的包还没有这两个文件）时按"未知"处理，不报错。
function readVersionFile(path) {
	return fs.read(path).then(function(v) {
		return (v || '').trim();
	}).catch(function() {
		return null;
	});
}

function loadVersionInfo() {
	return Promise.all([
		readVersionFile('/usr/libexec/substore/backend.version'),
		readVersionFile('/usr/libexec/substore/frontend.version')
	]).then(function(res) {
		return {
			backendVersion: res[0],
			frontendVersion: res[1]
		};
	});
}

function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, function(c) {
		return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
	});
}

// 2026-07 四次修复：这里是最后一道保险。前面 update-backend.sh /
// update-frontend.sh 已经加了内容校验，正常情况下 version 文件里只会
// 是一个干净的 tag_name。但万一以后镜像那边（Cloudflare）出了什么没
// 预料到的岔子、又绕过了前面的校验，这里强制转义可以保证：不管文件里
// 存的是什么，最多显示成一堆看着奇怪的文字，绝不会被当成 HTML 解析
// 执行、把整个页面布局搞炸。同时限制显示长度，避免万一是一大段内容
// 把这一行撑得很长。
function formatVersionLine(label, version) {
	var v = (version && version !== 'unknown') ? version : '未知';
	if (v.length > 60) {
		v = v.slice(0, 60) + '…';
	}
	return '<span style="margin-right:20px;">' + label + ': <b>' + escapeHtml(v) + '</b></span>';
}

function renderVersionInfo(info) {
	return formatVersionLine('后端', info.backendVersion) +
		formatVersionLine('前端', info.frontendVersion);
}

// 调用脚本时指定来源（'proxy' / 'mirror' / 'official'），脚本只会打
// 一次这个来源的下载，不会自己在内部悄悄切换来源。返回三种结果：
//   ok: true                        —— 这次调用成功
//   ok: false, retry: true          —— 这个来源下载失败，可以换另一个来源再试
//   ok: false, retry: false         —— 真正的脚本异常（比如重启失败），不该再重试
function runSourceScript(scriptPath, source) {
	return callRunCmd(scriptPath, [source]).then(function(res) {
		var stdout = (res && res.stdout) ? res.stdout.trim() : '';
		var stderr = (res && res.stderr) ? res.stderr.trim() : '';
		var code = res ? res.code : -1;

		if (code === 0 && stdout === 'OK') {
			return { ok: true };
		}
		if (code === 0 && stdout.indexOf('DOWNLOAD_FAILED:') === 0) {
			return { ok: false, retry: true, message: stdout.slice('DOWNLOAD_FAILED:'.length).trim() };
		}
		return { ok: false, retry: false, message: stderr || stdout || ('脚本执行失败（退出码 ' + code + '）') };
	});
}

// 2026-07 五次修复：这里是真正让页面能实时显示进度的地方——按顺序试
// 每一个来源，调用之间更新一次页面文字，某个来源下载失败（且明确是
// "可以换源重试"的失败）才去试下一个，不是下载问题导致的失败（比如
// 重启没成功）直接报错，不会盲目重试。用户任何时候都能从页面文字上
// 看出现在走的是哪个来源，不用等到最后弹出一条看不明白的拼接错误。
//
// 2026-07 六次修复：加了第三个来源 proxy（自建的 GitHub 加速代理），
// 优先级：proxy（加速代理拉官方最新）> mirror（自己的静态镜像）>
// official（官方原始直连，最后兜底）。这里用一个顺序数组描述整条链，
// 以后再加/减来源只用改这个数组，不用动下面的调用逻辑。
var SOURCE_CHAIN = [
	{ source: 'proxy', name: '加速代理' },
	{ source: 'mirror', name: '静态镜像' },
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

// 启动/停止/重启之后，用真实查询到的运行状态刷新页面上的状态指示灯
// 和启动/停止按钮的文字——不用整页重新加载，也不会出现"按钮文字和
// 实际状态对不上"的情况。
function refreshRunningState(node) {
	return getServiceStatus().then(function(running) {
		var indicator = node.querySelector('#substore_status_indicator');
		if (indicator) {
			indicator.style.color = running ? '#2ecc71' : '#e74c3c';
			indicator.textContent = '● ' + (running ? '运行中' : '已停止');
		}
		var toggle = node.querySelector('#btn_toggle');
		if (toggle) {
			toggle.textContent = running ? '停止服务' : '启动服务';
		}
		var panel = node.querySelector('#substore_open_panel');
		if (panel) {
			if (running) {
				var port = uci.get('substore', 'config', 'frontend_port') || '3001';
				var path = uci.get('substore', 'config', 'frontend_backend_path') || '/sub-store-api';
				var host = window.location.hostname;
				var url  = 'http://' + host + ':' + port + '?api=http://' + host + ':' + port + path;
				panel.innerHTML = '<a href="%s" target="_blank" class="btn cbi-button cbi-button-action">打开 Sub-Store ↗</a>'.format(url);
			} else {
				panel.innerHTML = '<span style="color:#999;">— 请先启动服务 —</span>';
			}
		}
		return running;
	});
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
		var m, s, o;

		m = new form.Map('substore', _('Sub-Store'),
			_('高级订阅管理器'));

		// ── 状态栏 ──────────────────────────────────────────────
		s = m.section(form.NamedSection, 'config', 'substore', _('服务状态'));
		s.anonymous = true;

		o = s.option(form.DummyValue, '_status', _('运行状态'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			var color = isRunning ? '#2ecc71' : '#e74c3c';
			var text  = isRunning ? _('运行中') : _('已停止');
			return '<span id="substore_status_indicator" style="color:%s;font-weight:bold;">● %s</span>'.format(color, text);
		};

		o = s.option(form.DummyValue, '_version', _('版本信息'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<div id="substore_version_info" style="display:flex;flex-wrap:wrap;line-height:1.6;">' + renderVersionInfo(versionInfo) + '</div>';
		};

		o = s.option(form.DummyValue, '_open', _('网页面板'));
		o.rawhtml = true;
		o.cfgvalue = function(section_id) {
			var port = uci.get('substore', section_id, 'frontend_port') || '3001';
			var path = uci.get('substore', section_id, 'frontend_backend_path') || '/sub-store-api';
			var host = window.location.hostname;
			var url  = 'http://' + host + ':' + port + '?api=http://' + host + ':' + port + path;
			var inner = isRunning
				? '<a href="%s" target="_blank" class="btn cbi-button cbi-button-action">打开 Sub-Store ↗</a>'.format(url)
				: '<span style="color:#999;">— 请先启动服务 —</span>';
			return '<div id="substore_open_panel">' + inner + '</div>';
		};

		o = s.option(form.DummyValue, '_actions', _('操作'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			var toggleLabel = isRunning ? '停止服务' : '启动服务';
			return '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
				'<button class="btn cbi-button cbi-button-action" id="btn_toggle">' + toggleLabel + '</button>' +
				'<button class="btn cbi-button cbi-button-apply" id="btn_restart">重启服务</button>' +
				'</div>';
		};
		o.write = function() {};

		o = s.option(form.DummyValue, '_update', _('更新'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">\
				<button class="btn cbi-button cbi-button-action" id="btn_update_backend">更新后端</button>\
				<button class="btn cbi-button cbi-button-action" id="btn_update_frontend">更新前端</button>\
				<span id="update_status" style="font-size:13px;color:#666;"></span>\
			</div>';
		};
		o.write = function() {};

		// ── 基础设置 ────────────────────────────────────────────
		s = m.section(form.NamedSection, 'config', 'substore', _('基础设置'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.Flag, 'enabled', _('启用'), _('开机自动启动，保存并应用后立即生效'));
		o.rmempty = false;
		o.default = '1';

		o = s.option(form.Value, 'data_dir', _('数据目录'), _('Sub-Store 数据文件存放路径'));
		o.default = '/etc/sub-store';
		o.placeholder = '/etc/sub-store';

		o = s.option(form.Value, 'backend_custom_name', _('实例名称'), _('显示在前端界面上的后端名称'));
		o.default = 'OpenWrt';

		o = s.option(form.Value, 'frontend_backend_path', _('后端路径前缀'), _('作为 API 路径使用，避免使用特殊符号'));
		o.default = '/sub-store-api';
		o.placeholder = 'sub-store-api';

		// 读取时去掉开头的 /，只在输入框里显示路径内容本身
		o.cfgvalue = function(section_id) {
			var v = uci.get('substore', section_id, 'frontend_backend_path') || this.default;
			return v.replace(/^\/+/, '');
		};

		// 保存时去除多余的 /，再统一拼上开头的 /；清空则回退默认值
		o.write = function(section_id, value) {
			value = (value || '').replace(/^\/+/, '');
			if (value === '') {
				uci.set('substore', section_id, 'frontend_backend_path', this.default);
			} else {
				uci.set('substore', section_id, 'frontend_backend_path', '/' + value);
			}
		};

		return m.render().then(function(node) {

			// 重启按钮
			var btnRestart = node.querySelector('#btn_restart');
			if (btnRestart) {
				btnRestart.addEventListener('click', function() {
					btnRestart.disabled = true;
					btnRestart.textContent = '重启中...';
					callInitAction('substore', 'restart').then(function() {
						ui.addNotification(null, E('p', 'Sub-Store 已重启。'), 'info');
						return refreshRunningState(node);
					}).catch(function() {
						ui.addNotification(null, E('p', '重启失败。'), 'danger');
					}).finally(function() {
						btnRestart.disabled = false;
						btnRestart.textContent = '重启服务';
					});
				});
			}

			// 启动/停止切换按钮：按钮当前文字决定这次点击是要启动还是停止，
			// 动作结束后用真实状态刷新按钮文字和状态指示灯，不是简单假设
			// "点了启动就一定在运行"——比如 enabled 被取消勾选保存过，
			// init.d 里 start_service 会直接返回，实际不会真的跑起来，
			// 这里刷新后会如实显示"已停止"，不会跟按钮文字对不上。
			var btnToggle = node.querySelector('#btn_toggle');
			if (btnToggle) {
				btnToggle.addEventListener('click', function() {
					var action = btnToggle.textContent.indexOf('停止') !== -1 ? 'stop' : 'start';
					btnToggle.disabled = true;
					btnToggle.textContent = (action === 'stop') ? '停止中...' : '启动中...';

					callInitAction('substore', action).then(function() {
						ui.addNotification(null, E('p', action === 'stop' ? 'Sub-Store 已停止。' : 'Sub-Store 已启动。'), 'info');
						return refreshRunningState(node);
					}).catch(function() {
						ui.addNotification(null, E('p', (action === 'stop' ? '停止' : '启动') + '失败。'), 'danger');
						return refreshRunningState(node);
					}).finally(function() {
						btnToggle.disabled = false;
					});
				});
			}

			// 更新后端按钮
			var btnUpdateBackend = node.querySelector('#btn_update_backend');
			var updateStatus = node.querySelector('#update_status');
			if (btnUpdateBackend) {
				btnUpdateBackend.addEventListener('click', function() {
					btnUpdateBackend.disabled = true;

					updateWithFallback('/usr/libexec/substore/update-backend.sh', '后端', updateStatus).then(function() {
						updateStatus.style.color = '#2ecc71';
						updateStatus.textContent = '后端已更新并重启成功。';
						return loadVersionInfo();
					}).then(function(info) {
						if (!info) return;
						var el = node.querySelector('#substore_version_info');
						if (el) el.innerHTML = renderVersionInfo(info);
					}).catch(function(err) {
						updateStatus.style.color = '#e74c3c';
						updateStatus.textContent = '后端更新失败：' + (err && err.message ? err.message : '未知错误');
					}).finally(function() {
						btnUpdateBackend.disabled = false;
					});
				});
			}

			// 更新前端按钮
			var btnUpdateFrontend = node.querySelector('#btn_update_frontend');
			if (btnUpdateFrontend) {
				btnUpdateFrontend.addEventListener('click', function() {
					btnUpdateFrontend.disabled = true;

					updateWithFallback('/usr/libexec/substore/update-frontend.sh', '前端', updateStatus).then(function() {
						updateStatus.style.color = '#2ecc71';
						updateStatus.textContent = '前端已更新。';
						return loadVersionInfo();
					}).then(function(info) {
						if (!info) return;
						var el = node.querySelector('#substore_version_info');
						if (el) el.innerHTML = renderVersionInfo(info);
					}).catch(function(err) {
						updateStatus.style.color = '#e74c3c';
						updateStatus.textContent = '前端更新失败：' + (err && err.message ? err.message : '未知错误');
					}).finally(function() {
						btnUpdateFrontend.disabled = false;
					});
				});
			}

			return node;
		});
	},

	handleSaveApply: function(ev) {
		return this.super('handleSaveApply', [ev]).then(function() {
			var btn = document.querySelector('#btn_restart');
			if (btn) btn.click();
		});
	}
});
