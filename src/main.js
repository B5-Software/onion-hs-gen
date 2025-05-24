// Onion HS Gen - Onion Service Generator
// Author: B5-Software
// License: CC0 1.0 Universal (CC0 1.0) Public Domain Dedication
// This software performs calculations based on the mkp224o (CC0 license) binary.

// Set console output encoding
if (process.platform === 'win32') {
  process.env.LANG = 'zh-CN.UTF-8';
}

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');

// Set application name and description
app.setName('Onion HS Gen');

let mainWindow;
let loadingWindow;
let mkpProcess = null;
let currentWorkDir = app.getPath('documents');
let initialDomainCount = 0;
let elapsedTimer = null;
let elapsedStart = 0;
let domainStatTimer = null;

const getDomainCount = () => {
  try {
    // Directly count the .onion directories under currentWorkDir
    const files = fs.readdirSync(currentWorkDir, { withFileTypes: true });
    return files.filter(f => f.isDirectory() && f.name.endsWith('.onion')).length;
  } catch (e) {
    return 0;
  }
};

// Get the absolute path of the executable file in the bin directory, compatible with asar and asar.unpacked
function getBinPath(filename) {
  let base = __dirname;
  if (base.includes('app.asar')) {
    base = base.replace('app.asar', 'app.asar.unpacked');
  }
  return path.join(base, '../bin', filename);
}

function createWindow() {
  // Set PowerShell code page to UTF-8
  spawn('powershell.exe', ['-Command', 'chcp', '65001'], { shell: true });

  // Create loading window first
  loadingWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    alwaysOnTopLevel: 'screen-saver',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  loadingWindow.loadFile('ui/loading.html')
    .catch(error => {
      console.error('Failed to load loading window:', error);
      app.quit();
    });
  
  console.log('Loading window created');

  // Create the main window
  let iconPath = path.join(__dirname, '../assets/icons/icon.png');
  try {
    if (!fs.existsSync(iconPath)) {
      iconPath = undefined;
    }
  } catch (e) {
    iconPath = undefined;
  }
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    show: true, // Directly show the main window to avoid being stuck on the loading page if the ready-to-show event is not triggered
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1a1a2e',
      symbolColor: '#ffffff'
    },
    icon: iconPath,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    }
  });

  // Add load error handling
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load main window:', errorDescription);
    dialog.showErrorBox('Load Error', `Failed to load application: ${errorDescription}`);
    if (loadingWindow) loadingWindow.destroy();
    if (mainWindow) mainWindow.destroy();
    app.quit();
  });

  mainWindow.loadFile('ui/index.html')
    .catch(error => {
      console.error('Failed to load main window:', error);
      dialog.showErrorBox('Load Error', `Failed to load application: ${error.message}`);
      if (loadingWindow) loadingWindow.destroy();
      if (mainWindow) mainWindow.destroy();
      app.quit();
    });

  console.log('Loading main window...');

  // Listen for renderer process ready event
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Renderer process loaded');
  });

  mainWindow.once('ready-to-show', () => {
    console.log('Main window ready');
    if (loadingWindow && !loadingWindow.isDestroyed()) {
      loadingWindow.destroy();
    }
    // mainWindow.show(); // Already shown during creation, no need to call again
    mainWindow.focus();
    mainWindow.webContents.send('workdir-updated', currentWorkDir);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (mkpProcess) {
      mkpProcess.kill();
      mkpProcess = null;
    }
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// IPC Handlers
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    currentWorkDir = result.filePaths[0];
    return currentWorkDir;
  }
  return null;
});

ipcMain.on('start-generation', (event, { count, prefix }) => {
  if (mkpProcess) {
    mkpProcess.kill();
  }
  if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
  if (domainStatTimer) { clearInterval(domainStatTimer); domainStatTimer = null; }

  initialDomainCount = getDomainCount();
  elapsedStart = Date.now();
  elapsedTimer = setInterval(() => {
    const elapsed = ((Date.now() - elapsedStart) / 1000).toFixed(2);
    if (mainWindow) mainWindow.webContents.send('elapsed-update', elapsed);
  }, 100);
  domainStatTimer = setInterval(() => {
    if (mainWindow) {
      const currentCount = getDomainCount();
      const generated = currentCount - initialDomainCount;
      mainWindow.webContents.send('domains-generated-update', generated);
    }
  }, 50);

  // Fix parameter concatenation logic
  let filter = prefix && prefix.trim() ? prefix.trim() : 'a'; // Filter cannot be empty
  let userCount = parseInt(count);
  // Add -d parameter to specify the output directory as currentWorkDir
  const args = [filter, '-n', userCount.toString(), '-v', '-s', '-d', currentWorkDir];

  try {
    const mkp224oPath = getBinPath('mkp224o.exe');
    console.log('Starting mkp224o path:', mkp224oPath);
    console.log('Parameters:', args);
    mkpProcess = spawn(mkp224oPath, args, {
      cwd: path.dirname(mkp224oPath),
      stdio: ['ignore', 'pipe', 'pipe'] // Explicitly request pipe communication
    });
  } catch (e) {
    dialog.showErrorBox('Error', 'Unable to start mkp224o.exe, please check if the file exists or is in use.' + (e && e.message ? ('\n' + e.message) : ''));
    if (elapsedTimer) clearInterval(elapsedTimer);
    if (domainStatTimer) clearInterval(domainStatTimer);
    return;
  }

  if (mkpProcess.stdout) {
    let stdoutBuffer = '';
    mkpProcess.stdout.on('data', (data) => {
      stdoutBuffer += data.toString();
      let lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop(); // Retain the last line (possibly incomplete)
      for (const line of lines) {
        // Process each line
        const speedMatch = line.match(/(\d+) keys\/s/);
        const keysMatch = line.match(/(\d+) keys/);
        const timeMatch = line.match(/(\d+\.\d+) (s|m|h)/);
        let speed = speedMatch ? speedMatch[1] : null;
        let keys = keysMatch ? keysMatch[1] : null;
        if (speed) {
          mainWindow.webContents.send('speed-update', speed);
        }
        if (keys) {
          mainWindow.webContents.send('keys-update', keys);
        }
        if (timeMatch) {
          mainWindow.webContents.send('time-update', timeMatch[0]);
        }
      }
    });
  }
  if (mkpProcess.stderr) {
    let stderrBuffer = '';
    mkpProcess.stderr.on('data', (data) => {
      stderrBuffer += data.toString();
      let lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop();
      for (const line of lines) {
        // Process each line
        const statMatch = line.match(/calc\/sec:([\d.]+), succ\/sec:([\d.]+), rest\/sec:([\d.]+), elapsed:([\d.]+)sec/);
        if (statMatch) {
          const calcPerSec = statMatch[1];
          const succPerSec = statMatch[2];
          const restPerSec = statMatch[3];
          const elapsed = statMatch[4];
          mainWindow.webContents.send('speed-update', Math.round(calcPerSec));
          mainWindow.webContents.send('succ-speed-update', succPerSec);
          mainWindow.webContents.send('rest-speed-update', restPerSec);
          mainWindow.webContents.send('elapsed-update', elapsed);
        }
      }
    });
  }

  mkpProcess.on('close', (code) => {
    if (elapsedTimer) clearInterval(elapsedTimer);
    if (domainStatTimer) clearInterval(domainStatTimer);
    console.log(`mkp224o process exited with code ${code}`);
    mkpProcess = null;
    mainWindow.webContents.send('generation-complete');
  });
});

ipcMain.on('stop-generation', () => {
  if (mkpProcess) {
    mkpProcess.kill();
    mkpProcess = null;
    mainWindow.webContents.send('generation-stopped');
  }
});

ipcMain.on('minimize-window', () => {
  mainWindow.minimize();
});

ipcMain.on('maximize-window', () => {
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on('close-window', () => {
  mainWindow.close();
});