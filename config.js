const fs = require('fs');
const path = require('path');
const os = require('os');

function getConfigPath() {
    return path.join(os.homedir(), '.config', 'kute-player');
}

const CONFIG_DIR = getConfigPath();
const CONFIG_FILE = path.join(CONFIG_DIR, 'settings.json');

function loadSettings() {
    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            return { volume: 80, libraryPath: '', repeatMode: 'none' };
        }
        const data = fs.readFileSync(CONFIG_FILE, 'utf8');
        const settings = JSON.parse(data);
        if (settings.repeatMode === undefined) {
            settings.repeatMode = 'none';
        }
        return settings;
    } catch (error) {
        return { volume: 80, libraryPath: '', repeatMode: 'none' };
    }
}

let saveTimer = null;
function saveSettings(volume, libraryPath, repeatMode) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try {
            if (!fs.existsSync(CONFIG_DIR)) {
                fs.mkdirSync(CONFIG_DIR, { recursive: true });
            }
            const settings = {
                volume: volume,
                libraryPath: libraryPath || '',
                repeatMode: repeatMode || 'none',
                version: '1.0.1'
            };
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(settings, null, 2));
        } catch (error) {}
    }, 300);
}

module.exports = { loadSettings, saveSettings };