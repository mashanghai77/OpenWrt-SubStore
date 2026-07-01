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

// 调用固定路径脚本，严格校验：必须 code===0 且 stdout 最后一行是 OK，否则一律视为失败
function runUpdateScript(scriptPath) {
	return callRunCmd(scriptPath, []).then(function(res) {
		var stdout = (res && res.stdout) ? res.stdout.trim() : '';
		var stderr = (res && res.stderr) ? res.stderr.trim() : '';

		if (!res || res.code !== 0) {
			throw new Error(stderr || stdout || ('脚本执行失败（退出码 ' + (res ? res.code : '未知') + '）'));
		}
		if (stdout !== 'OK') {
			throw new Error(stderr || stdout || '脚本未返回预期结果');
		}
		return true;
	});
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
			return '<span style="color:%s;font-weight:bold;">● %s</span>'.format(color, text);
		};

		o = s.option(form.DummyValue, '_open', _('网页面板'));
		o.rawhtml = true;
		o.cfgvalue = function(section_id) {
			var port = uci.get('substore', section_id, 'frontend_port') || '3001';
			var path = uci.get('substore', section_id, 'frontend_backend_path') || '/sub-store-api';
			var host = window.location.hostname;
			var url  = 'http://' + host + ':' + port + '?api=http://' + host + ':' + port + path;
			if (!isRunning) {
				return '<span style="color:#999;">— 请先启动服务 —</span>';
			}
			return '<a href="%s" target="_blank" class="btn cbi-button cbi-button-action">打开 Sub-Store ↗</a>'
				.format(url);
		};

		o = s.option(form.DummyValue, '_actions', _('操作'));
		o.rawhtml = true;
		o.cfgvalue = function() {
			return '<button class="btn cbi-button cbi-button-apply" id="btn_restart">重启</button>';
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
					}).catch(function() {
						ui.addNotification(null, E('p', '重启失败。'), 'danger');
					}).finally(function() {
						btnRestart.disabled = false;
						btnRestart.textContent = '重启';
					});
				});
			}

			// 更新后端按钮
			var btnUpdateBackend = node.querySelector('#btn_update_backend');
			var updateStatus = node.querySelector('#update_status');
			if (btnUpdateBackend) {
				btnUpdateBackend.addEventListener('click', function() {
					btnUpdateBackend.disabled = true;
					updateStatus.style.color = '#666';
					updateStatus.textContent = '正在更新后端...';

					runUpdateScript('/usr/libexec/substore/update-backend.sh').then(function() {
						updateStatus.style.color = '#2ecc71';
						updateStatus.textContent = '后端已更新并重启成功。';
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
					updateStatus.style.color = '#666';
					updateStatus.textContent = '正在更新前端...';

					runUpdateScript('/usr/libexec/substore/update-frontend.sh').then(function() {
						updateStatus.style.color = '#2ecc71';
						updateStatus.textContent = '前端已更新。';
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
