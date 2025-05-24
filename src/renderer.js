// Onion HS Gen - Onion Service Generator
// Author: B5-Software
// License: CC0 1.0 Universal (CC0 1.0) Public Domain Dedication
// This software performs calculations based on the mkp224o (CC0 license) binary.
const { ipcRenderer } = require('electron');
const si = require('systeminformation');
const Chart = require('chart.js/auto');
const fs = require('fs-extra');
const path = require('path');

let speedChart;
let speedData = [];
let maxDataPoints = 30;
let generationActive = false;

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM content loaded');
  try {
    applyThemeFromStorage();
    applyLangFromStorage();
    initUI();
    initChart();
    loadSystemInfo().catch(error => {
      console.error('Failed to load system information:', error);
    });
    console.log('Renderer process initialized');
  } catch (error) {
    console.error('Renderer process initialization failed:', error);
  }
});

// Add global error handling
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled Promise rejection:', event.reason);
});

function initUI() {
  // Window controls
  document.getElementById('minimize-btn').addEventListener('click', () => {
    ipcRenderer.send('minimize-window');
  });

  document.getElementById('maximize-btn').addEventListener('click', () => {
    ipcRenderer.send('maximize-window');
  });

  document.getElementById('close-btn').addEventListener('click', () => {
    ipcRenderer.send('close-window');
  });

  // Directory selection
  document.getElementById('select-dir-btn').addEventListener('click', async () => {
    const dir = await ipcRenderer.invoke('select-directory');
    if (dir) {
      document.getElementById('workdir-path').textContent = dir;
      ipcRenderer.send('workdir-updated', dir);
    }
  });

  // Generation controls
  document.getElementById('start-btn').addEventListener('click', startGeneration);
  document.getElementById('stop-btn').addEventListener('click', stopGeneration);

  // Form validation
  document.getElementById('domain-count').addEventListener('input', validateForm);
  document.getElementById('prefix-input').addEventListener('input', validateForm);

  // IPC listeners
  ipcRenderer.on('speed-update', (event, speed) => {
    updateSpeed(speed);
  });

  ipcRenderer.on('keys-update', (event, keys) => {
    document.getElementById('keys-generated').textContent = keys;
  });

  ipcRenderer.on('time-update', (event, time) => {
    document.getElementById('estimated-time').textContent = time;
  });

  ipcRenderer.on('generation-complete', () => {
    generationComplete();
  });

  ipcRenderer.on('generation-stopped', () => {
    generationStopped();
  });

  ipcRenderer.on('workdir-updated', (event, dir) => {
    document.getElementById('workdir-path').textContent = dir;
  });

  ipcRenderer.on('estimated-time-update', (event, est) => {
    document.getElementById('estimated-time').textContent = est;
  });

  ipcRenderer.on('succ-speed-update', (event, val) => {
    // You can display the success rate in the UI here (if needed)
    // console.log('succ/sec:', val);
  });
  ipcRenderer.on('rest-speed-update', (event, val) => {
    // You can display the rest rate in the UI here (if needed)
    // console.log('rest/sec:', val);
  });
  ipcRenderer.on('elapsed-update', (event, val) => {
    document.getElementById('elapsed-time').textContent = val + ' seconds';
  });
  ipcRenderer.on('domains-generated-update', (event, val) => {
    document.getElementById('keys-generated').textContent = val;
  });

  // Theme toggle switch
  const themeSwitch = document.getElementById('theme-toggle-btn');
  if (themeSwitch) {
    themeSwitch.addEventListener('change', () => {
      if (themeSwitch.checked) {
        document.body.classList.add('light-mode');
        localStorage.setItem('theme', 'light');
      } else {
        document.body.classList.remove('light-mode');
        localStorage.setItem('theme', 'dark');
      }
    });
  }
}

function initChart() {
  const ctx = document.getElementById('speed-chart').getContext('2d');
  speedChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: Array(maxDataPoints).fill(''),
      datasets: [{
        label: 'Current Speed (calc/sec)',
        data: speedData,
        borderColor: '#4cc9f0',
        backgroundColor: 'rgba(76, 201, 240, 0.1)',
        borderWidth: 2,
        tension: 0.4,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          grid: {
            color: 'rgba(255, 255, 255, 0.1)'
          },
          ticks: {
            color: '#ffffff'
          }
        },
        x: {
          display: false,
          grid: {
            display: false
          }
        }
      },
      plugins: {
        legend: {
          labels: {
            color: '#ffffff'
          }
        }
      },
      animation: {
        duration: 1000,
        easing: 'easeOutQuart'
      }
    }
  });
}

async function loadSystemInfo() {
  try {
    const cpu = await si.cpu();
    const mem = await si.mem();
    document.getElementById('cpu-info').textContent = `${cpu.manufacturer} ${cpu.brand}`;
    document.getElementById('cpu-cores').textContent = `${cpu.cores} threads`;
    document.getElementById('mem-info').textContent = `${(mem.total / 1024 / 1024 / 1024).toFixed(2)} GB`;
  } catch (e) {
    console.error('Failed to load system info:', e);
  }
}

function updateSpeed(speed) {
  const speedNum = parseInt(speed);
  document.getElementById('current-speed').textContent = speedNum.toLocaleString();
  
  // Update chart data
  speedData.push(speedNum);
  if (speedData.length > maxDataPoints) {
    speedData.shift();
  }
  
  speedChart.data.datasets[0].data = speedData;
  speedChart.update();
}

function validateForm() {
  const count = document.getElementById('domain-count').value;
  const prefix = document.getElementById('prefix-input').value;
  // Only require count to be greater than 0, no longer limit the maximum value
  const valid = count > 0 && (prefix === '' || /^[a-z2-7]{0,10}$/.test(prefix));
  document.getElementById('start-btn').disabled = !valid;
  return valid;
}

function startGeneration() {
  if (!validateForm()) return;
  const count = document.getElementById('domain-count').value;
  const prefix = document.getElementById('prefix-input').value;
  generationActive = true;
  document.getElementById('start-btn').disabled = true;
  document.getElementById('stop-btn').disabled = false;
  document.getElementById('generation-status').textContent = 'Running';
  document.getElementById('generation-status').className = 'status-running';
  // Reset stats
  speedData = [];
  document.getElementById('keys-generated').textContent = '0';
  // Only reset elapsed time, no longer operate on non-existent estimated-time
  var elapsedTimeEl = document.getElementById('elapsed-time');
  if (elapsedTimeEl) elapsedTimeEl.textContent = '0 seconds';
  ipcRenderer.send('start-generation', { count, prefix });
}

function stopGeneration() {
  ipcRenderer.send('stop-generation');
}

function generationComplete() {
  generationActive = false;
  document.getElementById('start-btn').disabled = false;
  document.getElementById('stop-btn').disabled = true;
  document.getElementById('generation-status').textContent = 'Complete';
  document.getElementById('generation-status').className = 'status-complete';
  
  // Show completion animation
  const completion = document.getElementById('completion-animation');
  completion.style.display = 'block';
  setTimeout(() => {
    completion.style.display = 'none';
  }, 3000);
}

function generationStopped() {
  generationActive = false;
  document.getElementById('start-btn').disabled = false;
  document.getElementById('stop-btn').disabled = true;
  document.getElementById('generation-status').textContent = 'Stopped';
  document.getElementById('generation-status').className = 'status-stopped';
}

function applyThemeFromStorage() {
  const themeSwitch = document.getElementById('theme-toggle-btn');
  const theme = localStorage.getItem('theme');
  if (theme === 'light') {
    document.body.classList.add('light-mode');
    if (themeSwitch) themeSwitch.checked = true;
  } else {
    document.body.classList.remove('light-mode');
    if (themeSwitch) themeSwitch.checked = false;
  }
  // Synchronize chart title, legend, and axis font colors when switching themes
  if (window.speedChart) {
    const isLight = document.body.classList.contains('light-mode');
    const fontColor = isLight ? '#222222' : '#ffffff';
    speedChart.options.plugins.legend.labels.color = fontColor;
    speedChart.options.plugins.title = speedChart.options.plugins.title || {};
    speedChart.options.plugins.title.color = fontColor;
    speedChart.options.scales.y.ticks.color = fontColor;
    speedChart.options.scales.x.ticks.color = fontColor;
    speedChart.update();
  }
}

function applyLangFromStorage() {
  const lang = localStorage.getItem('lang') || 'en';
  const langSelect = document.getElementById('lang-select');
  if (langSelect) langSelect.value = lang;
  setLang(lang);
}

function setLang(lang) {
  // UI text mapping
  const textMap = {
    en: {
      'settings-title': 'Settings',
      'cpu-label': 'CPU:',
      'cpu-cores-label': 'Threads:',
      'mem-label': 'Memory:',
      'workdir-title': 'Working Directory',
      'workdir-change': 'Change',
      'about-title': 'About',
      'about-text': 'Onion HS Gen is a graphical client for <strong>mkp224o</strong>, used to generate vanity Tor v3 onion service addresses.',
      'about-credits': 'Based on mkp224o<br>2025 B5-Software',
      'gen-title': 'Generate Onion v3 Address',
      'domain-count-label': 'Count:',
      'prefix-label': 'Optional Prefix (a-z, 2-7):',
      'prefix-hint': 'Leave blank for random',
      'start-btn': 'Start',
      'stop-btn': 'Stop',
      'status-title': 'Status',
      'status-idle': 'Idle',
      'status-running': 'Running',
      'status-complete': 'Complete',
      'status-stopped': 'Stopped',
      'speed-title': 'Current Speed',
      'keys-title': 'Keys Generated',
      'elapsed-title': 'Elapsed Time',
      'completion-msg': 'Generation Complete!',
      'system-title': 'System Info'
    },
    zh: {
      'settings-title': '设置',
      'cpu-label': 'CPU：',
      'cpu-cores-label': '线程数：',
      'mem-label': '内存：',
      'workdir-title': '工作目录',
      'workdir-change': '更改',
      'about-title': '关于',
      'about-text': 'Onion HS Gen 是 <strong>mkp224o</strong> 的图形界面客户端，\n用于生成 Tor v3 洋葱服务的个性化地址。',
      'about-credits': '基于 mkp224o<br>2025 B5-Software',
      'gen-title': '生成 Onion v3 地址',
      'domain-count-label': '生成数量：',
      'prefix-label': '可选前缀（a-z, 2-7）：',
      'prefix-hint': '留空则随机生成',
      'start-btn': '开始生成',
      'stop-btn': '停止',
      'status-title': '生成状态',
      'status-idle': '空闲',
      'status-running': '运行中',
      'status-complete': '完成',
      'status-stopped': '已停止',
      'speed-title': '当前算力',
      'keys-title': '已生成地址',
      'elapsed-title': '已用时间',
      'completion-msg': '生成完成！',
      'system-title': '系统信息'
    }
  };
  // Sidebar
  setText('settings-title', textMap[lang]['settings-title']);
  setText('system-title', textMap[lang]['system-title']);
  setText('cpu-info-label', textMap[lang]['cpu-label']);
  setText('cpu-cores-label', textMap[lang]['cpu-cores-label']);
  setText('mem-info-label', textMap[lang]['mem-label']);
  setText('workdir-title', textMap[lang]['workdir-title']);
  setText('workdir-change', textMap[lang]['workdir-change']);
  setText('about-title', textMap[lang]['about-title']);
  setHTML('about-text', textMap[lang]['about-text']);
  setHTML('about-credits', textMap[lang]['about-credits']);
  // Main content
  setText('gen-title', textMap[lang]['gen-title']);
  setText('domain-count-label', textMap[lang]['domain-count-label']);
  setText('prefix-label', textMap[lang]['prefix-label']);
  setText('prefix-hint', textMap[lang]['prefix-hint']);
  setText('start-btn', textMap[lang]['start-btn']);
  setText('stop-btn', textMap[lang]['stop-btn']);
  setText('status-title', textMap[lang]['status-title']);
  setText('generation-status', textMap[lang]['status-idle']);
  setText('speed-title', textMap[lang]['speed-title']);
  setText('keys-title', textMap[lang]['keys-title']);
  setText('elapsed-title', textMap[lang]['elapsed-title']);
  setText('completion-msg', textMap[lang]['completion-msg']);
  // Chart label
  if (window.speedChart) {
    window.speedChart.data.datasets[0].label = lang === 'en' ? 'Current Speed (calc/sec)' : '当前算力 (calc/sec)';
    window.speedChart.update();
  }
}
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}
// Language switch event
const langSelect = document.getElementById('lang-select');
if (langSelect) {
  langSelect.addEventListener('change', (e) => {
    const lang = e.target.value;
    localStorage.setItem('lang', lang);
    setLang(lang);
  });
}