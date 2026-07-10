(function () {
  var body = document.querySelector('[data-score-list]');
  var tabs = document.querySelectorAll('[data-status]');
  var currentStatus = '';
  var modeLabels = { classic: '经典', level: '闯关', chaos: '混沌', bossRush: 'Boss 挑战' };
  var diffLabels = { easy: '简单', normal: '普通', hard: '困难', hell: '炼狱' };

  function request(url, options) {
    return fetch(url, options).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.message || '请求失败');
        return data;
      });
    });
  }

  function button(text, className, handler) {
    var element = document.createElement('button');
    element.type = 'button';
    element.textContent = text;
    if (className) element.className = className;
    element.addEventListener('click', handler);
    return element;
  }

  function loadScores() {
    body.innerHTML = '<tr><td colspan="7" class="loading-state">正在读取成绩…</td></tr>';
    var query = currentStatus ? '?status=' + encodeURIComponent(currentStatus) : '';
    request('/api/admin/game/scores' + query).then(function (data) {
      document.querySelector('[data-count]').textContent = String(data.count);
      body.textContent = '';
      if (!data.scores.length) {
        body.innerHTML = '<tr><td colspan="7" class="empty-state">当前筛选下没有成绩。</td></tr>';
        return;
      }
      data.scores.forEach(function (score) {
        var row = document.createElement('tr');
        [score.name, score.score, modeLabels[score.mode] || score.mode, diffLabels[score.diff] || score.diff, new Date(score.created_at).toLocaleString('zh-CN')].forEach(function (value, index) {
          var cell = document.createElement('td');
          cell.textContent = String(value);
          if (index === 1) cell.className = 'score-value';
          row.appendChild(cell);
        });
        var stateCell = document.createElement('td');
        var state = document.createElement('span');
        state.className = 'score-state' + (score.status === 'hidden' ? ' hidden' : '');
        state.textContent = score.status === 'hidden' ? '已隐藏' : '公开';
        stateCell.appendChild(state);
        row.appendChild(stateCell);
        var actions = document.createElement('td');
        actions.className = 'score-actions';
        actions.appendChild(button(score.status === 'hidden' ? '恢复' : '隐藏', '', function () {
          request('/api/admin/game/scores/' + score.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: score.status === 'hidden' ? 'visible' : 'hidden' }) }).then(loadScores);
        }));
        actions.appendChild(button('删除', 'danger', function () {
          if (!window.confirm('确定永久删除这条成绩吗？')) return;
          request('/api/admin/game/scores/' + score.id, { method: 'DELETE' }).then(loadScores);
        }));
        row.appendChild(actions);
        body.appendChild(row);
      });
    }).catch(function () {
      body.innerHTML = '<tr><td colspan="7" class="loading-state error-state">无法读取排行榜，请确认 SSH 隧道仍在运行。</td></tr>';
    });
  }

  tabs.forEach(function (tab) { tab.addEventListener('click', function () {
    tabs.forEach(function (item) { item.classList.remove('active'); });
    tab.classList.add('active');
    currentStatus = tab.dataset.status;
    loadScores();
  }); });
  document.querySelector('[data-refresh]').addEventListener('click', loadScores);
  loadScores();
}());
