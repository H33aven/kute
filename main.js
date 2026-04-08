const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const DiscordRPC = require('discord-rpc');

app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform');
app.commandLine.appendSwitch('ozone-platform', 'wayland');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-ipc-flooding-protection');
app.commandLine.appendSwitch('max_old_space_size', '512');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');
app.commandLine.appendSwitch('enable-wayland-ime');
app.commandLine.appendSwitch('disable-features', 'UseChromeOSDirectVideoDecoder');

let mainWindow;
let rpc = null;
let reconnectTimer = null;
const clientId = '1488264103607926834';

async function initDiscordRPC() {
    if (rpc) {
        rpc.destroy();
        rpc = null;
    }
    if (reconnectTimer) clearTimeout(reconnectTimer);
    try {
        rpc = new DiscordRPC.Client({ transport: 'ipc' });
        rpc.on('ready', () => { });
        await rpc.login({ clientId });
    } catch (err) {
        reconnectTimer = setTimeout(initDiscordRPC, 5000);
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 500,
        height: 410,
        minWidth: 500,
        minHeight: 410,
        frame: false,
        backgroundColor: '#1a1a1a',
        fullscreenable: false,
        maximizable: false,
        titleBarStyle: 'hidden',
        transparent: false,
        hasShadow: true,
        autoHideMenuBar: true,
        resizable: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: false,
            spellcheck: false,
            backgroundThrottling: false,
            sandbox: false
        }
    });
    mainWindow.loadFile('index.html');
    mainWindow.setFullScreen(false);
    mainWindow.setMaximizable(false);

    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.control && (input.key === 'w' || input.key === 'q')) {
            event.preventDefault();
        }
    });
}

ipcMain.handle('select-file', async (event, options) => {
    const result = await dialog.showOpenDialog(mainWindow, options);
    return result;
});

ipcMain.on('minimize-window', () => mainWindow.minimize());
ipcMain.on('maximize-window', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
});
ipcMain.on('close-window', () => mainWindow.close());
ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    return result.filePaths[0];
});

ipcMain.on('update-presence', (event, data) => {
    if (!rpc) return;
    if (data === null) {
        rpc.clearActivity();
    } else {
        rpc.setActivity(data);
    }
});

ipcMain.on('rpc-reconnect', () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    initDiscordRPC();
});

app.whenReady().then(() => {
    createWindow();
    initDiscordRPC();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (rpc) rpc.destroy();
});