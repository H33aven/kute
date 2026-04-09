const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const mm = require('music-metadata');

const selectLibraryBtn = document.getElementById('select-library-small');
const trackList = document.getElementById('track-list-small');
const trackCount = document.getElementById('track-count');
const libraryPath = document.getElementById('library-path-small');
const audio = new Audio();
let isExternalControl = false;

const playBtn = document.getElementById('play-btn-small');
const pauseBtn = document.getElementById('pause-btn-small');
const prevBtn = document.getElementById('prev-btn-small');
const nextBtn = document.getElementById('next-btn-small');
const repeatBtn = document.getElementById('repeat-btn-small');
const progressSlider = document.getElementById('progress-small');
const volumeSlider = document.getElementById('volume-small');
const currentTimeEl = document.getElementById('current-time-small');
const durationEl = document.getElementById('duration-small');
const trackTitle = document.getElementById('track-title-small');
const trackArtist = document.getElementById('track-artist-small');

const lyricsBtn = document.getElementById('lyrics-btn-small');
const lyricsModal = document.getElementById('lyrics-modal');
const lyricsTextarea = document.getElementById('lyrics-textarea');
const lyricsSaveBtn = document.getElementById('lyrics-save-btn');
const lyricsLoadBtn = document.getElementById('lyrics-load-btn');
const lyricsCloseBtn = document.getElementById('lyrics-close-btn');

const editPlaylistBtn = document.getElementById('edit-playlist-btn');
const searchInput = document.getElementById('track-search');

const config = require('./config');

let tracks = [];
let currentTrackIndex = 0;
let repeatMode = 'none';
let isPlaying = false;
let libraryFolder = '';
let currentLyricsTrack = null;
let originalTracks = [];
let isLyricsEditing = false;
let isPlaylistEditing = false;
let draggedItem = null;
let dropIndicator = null;
let scrollPosition = 0;
let dragOverContainer = false;
let insertAfterIndex = -1;

const coverCache = new Map();

const CONFIG_DIR = path.join(require('os').homedir(), '.config', 'kute-player');
const LYRICS_DIR = path.join(CONFIG_DIR, 'txts');
const PLAYLIST_ORDER_FILE = path.join(CONFIG_DIR, 'playlist_order.json');

const editMetadataBtn = document.getElementById('edit-metadata-btn');
const metadataModal = document.getElementById('metadata-modal');
const metadataModalClose = document.querySelector('.metadata-modal-close');
const metadataCoverPreview = document.getElementById('metadata-cover-preview');
const metadataCoverBtn = document.getElementById('metadata-cover-btn');
const metadataCoverInput = document.getElementById('metadata-cover-input');
const metadataTitle = document.getElementById('metadata-title');
const metadataArtist = document.getElementById('metadata-artist');
const metadataAlbum = document.getElementById('metadata-album');
const metadataSaveBtn = document.getElementById('metadata-save-btn');
const metadataCancelBtn = document.getElementById('metadata-cancel-btn');

const shortcutsBtn = document.getElementById('shortcuts-btn-small');
const shortcutsModal = document.getElementById('shortcuts-modal');
const shortcutsCloseBtn = document.getElementById('shortcuts-close-btn');

const settingsBtn = document.getElementById('settings-btn-small');
const settingsModal = document.getElementById('settings-modal');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const discordRpcToggle = document.getElementById('discord-rpc-toggle');
const themeToggle = document.getElementById('theme-toggle');
let discordRpcEnabled = true;
let currentTheme = 'dark';

let currentCoverFile = null;

if (!fs.existsSync(LYRICS_DIR)) fs.mkdirSync(LYRICS_DIR, { recursive: true });

let presenceStartTimestamp = null;

function updateDiscordPresence() {
    if (!discordRpcEnabled) return;
    if (!isPlaying) {
        ipcRenderer.send('update-presence', null);
        return;
    }
    const track = tracks[currentTrackIndex];
    if (!track) return;
    const activity = {
        details: track.name,
        state: track.artist,
        type: 2,
        largeImageText: 'Kute Player',
        startTimestamp: Math.floor(Date.now() / 1000 - audio.currentTime)
    };
    ipcRenderer.send('update-presence', activity);
}

function applyTheme(theme) {
    if (theme === 'light') {
        document.body.classList.add('light-theme');
    } else {
        document.body.classList.remove('light-theme');
    }
    currentTheme = theme;
}

document.getElementById('maximize-btn').addEventListener('click', () => ipcRenderer.send('maximize-window'));
document.getElementById('close-btn').addEventListener('click', () => ipcRenderer.send('close-window'));

selectLibraryBtn.addEventListener('click', async () => {
    try {
        const folderPath = await ipcRenderer.invoke('select-folder');
        if (folderPath) {
            libraryFolder = folderPath;
            libraryPath.textContent = folderPath.split('/').pop() || folderPath;
            coverCache.clear();
            loadTracksFromFolder(folderPath);
            config.saveSettings(volumeSlider.value, libraryFolder, repeatMode, discordRpcEnabled, currentTheme);
        }
    } catch (error) {
        showNotification('Error loading library');
    }
});

async function loadTracksFromFolder(folderPath) {
    try {
        const files = fs.readdirSync(folderPath);
        const trackPromises = [];
        for (const file of files) {
            if (file.toLowerCase().endsWith('.mp3')) {
                trackPromises.push(parseTrackFile(folderPath, file));
            }
        }
        const batchSize = 10;
        tracks = [];
        for (let i = 0; i < trackPromises.length; i += batchSize) {
            const batch = trackPromises.slice(i, i + batchSize);
            const batchResults = await Promise.allSettled(batch);
            batchResults.forEach(result => {
                if (result.status === 'fulfilled' && result.value) tracks.push(result.value);
            });
        }
        loadPlaylistOrder();
        updateTrackList();
        trackCount.textContent = `${tracks.length} tracks`;
        saveOriginalTracks();
        if (tracks.length > 0) loadTrack(0, false);
    } catch (error) {
        showNotification('Failed to load tracks');
    }
}

async function parseTrackFile(folderPath, filename) {
    const filePath = path.join(folderPath, filename);
    const cacheKey = filePath + fs.statSync(filePath).mtime.getTime();
    if (coverCache.has(cacheKey)) {
        const cachedTrack = coverCache.get(cacheKey);
        if (cachedTrack.cover && cachedTrack.cover.startsWith('blob:')) {
            try {
                await fetch(cachedTrack.cover, { method: 'HEAD' });
                return cachedTrack;
            } catch {
                coverCache.delete(cacheKey);
            }
        } else {
            return cachedTrack;
        }
    }
    try {
        const metadata = await mm.parseFile(filePath);
        let coverData = null;
        if (metadata.common?.picture?.length) {
            const picture = metadata.common.picture[0];
            let mimeType = 'image/jpeg';
            if (picture.format) {
                if (picture.format.startsWith('image/')) mimeType = picture.format;
                else if (picture.format.includes('jpeg') || picture.format.includes('jpg')) mimeType = 'image/jpeg';
                else if (picture.format.includes('png')) mimeType = 'image/png';
            }
            try {
                const blob = new Blob([picture.data], { type: mimeType });
                coverData = URL.createObjectURL(blob);
            } catch (err) { }
        }
        const track = {
            name: metadata.common.title || path.basename(filename, '.mp3'),
            artist: metadata.common.artist || 'Unknown Artist',
            album: metadata.common.album || 'Unknown Album',
            path: filePath,
            cover: coverData,
            duration: metadata.format.duration || 0
        };
        coverCache.set(cacheKey, track);
        return track;
    } catch (err) {
        return {
            name: path.basename(filename, '.mp3'),
            artist: 'Unknown Artist',
            album: 'Unknown Album',
            path: filePath,
            cover: null,
            duration: 0
        };
    }
}

function updateTrackList() { refreshTrackList(); }

function refreshTrackList() {
    if (tracks.length === 0) {
        trackList.innerHTML = `<div class="empty-state-small ${isPlaylistEditing ? 'editing' : ''}">
            <i class="fas fa-folder-open"></i><p>No music folder selected</p>
            <small>Click "Select" to choose your music library</small>
        </div>`;
        return;
    }
    const fragment = document.createDocumentFragment();
    tracks.forEach((track, index) => {
        const trackItem = document.createElement('div');
        trackItem.className = `track-item-small ${index === currentTrackIndex ? 'active' : ''}`;
        trackItem.dataset.index = index;
        trackItem.dataset.id = track.path;
        const coverDiv = document.createElement('div');
        coverDiv.className = 'track-cover-small';
        if (track.cover) {
            const img = document.createElement('img');
            img.src = track.cover;
            img.alt = track.name;
            img.onerror = () => {
                coverDiv.style.background = 'linear-gradient(135deg, #a78bfa 0%, #7c4dff 100%)';
                coverDiv.innerHTML = '<i class="fas fa-music"></i>';
            };
            coverDiv.appendChild(img);
        } else {
            const hash = track.name.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0);
            const hue = Math.abs(hash) % 360;
            coverDiv.style.background = `linear-gradient(135deg, hsl(${hue}, 75%, 60%), hsl(${hue + 40}, 75%, 40%))`;
            coverDiv.innerHTML = '<i class="fas fa-music"></i>';
        }
        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'track-details-small';
        const nameDiv = document.createElement('div');
        nameDiv.className = 'track-name-small';
        nameDiv.textContent = track.name.length > 25 ? track.name.substring(0, 22) + '...' : track.name;
        const infoDiv = document.createElement('div');
        infoDiv.className = 'track-info-small-text';
        infoDiv.textContent = `${track.artist} • ${track.album || 'No Album'}`;
        detailsDiv.appendChild(nameDiv);
        detailsDiv.appendChild(infoDiv);
        trackItem.appendChild(coverDiv);
        trackItem.appendChild(detailsDiv);
        trackItem.addEventListener('click', (e) => {
            if (isPlaylistEditing) return;
            loadTrack(index, true);
            if (!isPlaying) playTrack();
        });
        fragment.appendChild(trackItem);
    });
    trackList.innerHTML = '';
    trackList.appendChild(fragment);
    if (scrollPosition > 0) {
        trackList.scrollTop = scrollPosition;
        scrollPosition = 0;
    }
    if (isPlaylistEditing) {
        setTimeout(() => setupDragAndDrop(), 20);
    }
}

function loadTrack(index, autoPlay = true) {
    if (!tracks[index]) return;
    currentTrackIndex = index;
    const track = tracks[index];
    currentLyricsTrack = track;
    if (audio.src && audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
    audio.src = track.path;
    updateTrackInfo(index);
    updateAlbumArt(track.cover, track.name);
    updateActiveTrack(index);
    audio.addEventListener('loadedmetadata', () => {
        durationEl.textContent = formatTime(audio.duration);
    }, { once: true });
    if (autoPlay && isPlaying) playTrack();
    else { playBtn.style.display = 'flex'; pauseBtn.style.display = 'none'; }
}

function updateTrackInfo(index) {
    const track = tracks[index];
    const truncate = (text, max) => text.length > max ? text.substring(0, max - 1) + '…' : text;
    trackTitle.textContent = truncate(track.name, 35);
    let info = '';
    if (track.artist && track.album) info = `${track.artist} • ${track.album}`;
    else if (track.artist) info = track.artist;
    else info = `Track ${index + 1} of ${tracks.length}`;
    trackArtist.textContent = truncate(info, 45);
}

function updateAlbumArt(coverUrl, title) {
    const albumArt = document.getElementById('album-art-small');
    while (albumArt.firstChild) albumArt.firstChild.remove();
    if (coverUrl) {
        const img = document.createElement('img');
        img.src = coverUrl;
        img.alt = title;
        img.onload = () => { albumArt.style.background = 'none'; };
        img.onerror = () => showFallbackCover(albumArt, title);
        albumArt.appendChild(img);
    } else {
        showFallbackCover(albumArt, title);
    }
}

function showFallbackCover(element, title) {
    const hash = title.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0);
    const hue = Math.abs(hash) % 360;
    element.style.background = `linear-gradient(135deg, hsl(${hue}, 75%, 60%), hsl(${hue + 40}, 75%, 40%))`;
    const icon = document.createElement('i');
    icon.className = 'fas fa-music';
    element.appendChild(icon);
}

function updateActiveTrack(index) {
    document.querySelectorAll('.track-item-small').forEach((item, i) => item.classList.toggle('active', i === index));
}

function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function playTrack() {
    audio.play().then(() => {
        isPlaying = true;
        updateDiscordPresence();
        playBtn.style.display = 'none';
        pauseBtn.style.display = 'flex';
        isExternalControl = false;
    }).catch(() => { showNotification('Playback failed'); });
}

function pauseTrack() {
    audio.pause();
    isPlaying = false;
    updateDiscordPresence();
    playBtn.style.display = 'flex';
    pauseBtn.style.display = 'none';
    isExternalControl = false;
}

function nextTrack() {
    if (tracks.length === 0) return;
    let nextIndex = currentTrackIndex + 1;
    if (nextIndex >= tracks.length) {
        if (repeatMode === 'none') return;
        nextIndex = 0;
    }
    loadTrack(nextIndex, true);
    if (!isPlaying) playTrack();
}

function prevTrack() {
    if (tracks.length === 0) return;
    if (audio.currentTime > 3) {
        audio.currentTime = 0;
        if (isPlaying) playTrack();
        return;
    }
    let prevIndex = currentTrackIndex - 1;
    if (prevIndex < 0) {
        if (repeatMode === 'none') return;
        prevIndex = tracks.length - 1;
    }
    loadTrack(prevIndex, true);
    if (!isPlaying) playTrack();
}

function toggleRepeat() {
    const modes = ['none', 'all', 'one'];
    const idx = modes.indexOf(repeatMode);
    repeatMode = modes[(idx + 1) % modes.length];
    repeatBtn.classList.remove('repeat-one', 'repeat-all');
    if (repeatMode === 'one') {
        repeatBtn.classList.add('repeat-one');
        document.getElementById('repeat-status').textContent = 'repeat mode:  one';
    } else if (repeatMode === 'all') {
        repeatBtn.classList.add('repeat-all');
        document.getElementById('repeat-status').textContent = 'repeat mode:  all';
    } else {
        document.getElementById('repeat-status').textContent = 'repeat mode:  none';
    }
    config.saveSettings(volumeSlider.value, libraryFolder, repeatMode, discordRpcEnabled, currentTheme);
}

function showNotification(message, duration = 3000) {
    document.querySelectorAll('.temp-notification').forEach(n => n.remove());
    const notification = document.createElement('div');
    notification.className = 'temp-notification';
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.style.animation = 'fadeOut 0.5s ease forwards';
        setTimeout(() => notification.remove(), 500);
    }, duration);
}

function showSaveNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'save-notification';
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 2500);
}

function saveOriginalTracks() { originalTracks = [...tracks]; }
function filterTracks(searchText) {
    if (!searchText.trim()) tracks = [...originalTracks];
    else {
        const query = searchText.toLowerCase();
        tracks = originalTracks.filter(t => t.name.toLowerCase().includes(query) || t.artist.toLowerCase().includes(query) || t.album.toLowerCase().includes(query));
    }
    refreshTrackList();
}
searchInput.addEventListener('input', e => filterTracks(e.target.value));

function openLyrics(track) {
    if (!track) return;
    currentLyricsTrack = track;
    const lyricsPath = path.join(LYRICS_DIR, `${track.name}.txt`);
    try {
        lyricsTextarea.value = fs.existsSync(lyricsPath) ? fs.readFileSync(lyricsPath, 'utf-8') : '';
    } catch (e) {
        lyricsTextarea.value = '';
    }
    isLyricsEditing = false;
    lyricsTextarea.readOnly = true;
    lyricsTextarea.style.cursor = 'default';
    lyricsSaveBtn.innerHTML = '<i class="fas fa-edit"></i>';
    lyricsModal.style.display = 'flex';
    setTimeout(() => lyricsModal.classList.add('show'), 10);
}

function closeLyrics() {
    if (isLyricsEditing) {
        isLyricsEditing = false;
        lyricsTextarea.readOnly = true;
        lyricsTextarea.style.cursor = 'default';
        lyricsSaveBtn.innerHTML = '<i class="fas fa-edit"></i>';
        const lyricsPath = path.join(LYRICS_DIR, `${currentLyricsTrack.name}.txt`);
        try {
            lyricsTextarea.value = fs.existsSync(lyricsPath) ? fs.readFileSync(lyricsPath, 'utf-8') : '';
        } catch (e) { }
    }
    lyricsModal.classList.remove('show');
    setTimeout(() => {
        lyricsModal.style.display = 'none';
    }, 300);
}

lyricsBtn.addEventListener('click', () => {
    if (tracks[currentTrackIndex]) {
        openLyrics(tracks[currentTrackIndex]);
    } else {
        showNotification('No track loaded');
    }
});

lyricsSaveBtn.addEventListener('click', () => {
    if (!currentLyricsTrack) return;
    const lyricsPath = path.join(LYRICS_DIR, `${currentLyricsTrack.name}.txt`);
    if (isLyricsEditing) {
        try {
            fs.writeFileSync(lyricsPath, lyricsTextarea.value, 'utf-8');
            showNotification('Lyrics saved');
            isLyricsEditing = false;
            lyricsTextarea.readOnly = true;
            lyricsTextarea.style.cursor = 'default';
            lyricsSaveBtn.innerHTML = '<i class="fas fa-edit"></i>';
        } catch (err) {
            showNotification('Error saving lyrics');
        }
    } else {
        isLyricsEditing = true;
        lyricsTextarea.readOnly = false;
        lyricsTextarea.style.cursor = 'text';
        lyricsTextarea.focus();
        lyricsSaveBtn.innerHTML = '<i class="fas fa-save"></i>';
        showNotification('Edit mode enabled', 2000);
    }
});

lyricsLoadBtn.addEventListener('click', async () => {
    if (!currentLyricsTrack) return;
    const result = await ipcRenderer.invoke('select-file', {
        title: 'Select lyrics file',
        filters: [{ name: 'Text Files', extensions: ['txt'] }, { name: 'All Files', extensions: ['*'] }],
        properties: ['openFile']
    });
    if (result.filePaths && result.filePaths[0]) {
        try {
            const content = fs.readFileSync(result.filePaths[0], 'utf-8');
            lyricsTextarea.value = content;
            showNotification('Lyrics loaded');
            if (!isLyricsEditing) {
                isLyricsEditing = true;
                lyricsTextarea.readOnly = false;
                lyricsTextarea.style.cursor = 'text';
                lyricsSaveBtn.innerHTML = '<i class="fas fa-save"></i>';
            }
        } catch (e) {
            showNotification('Error loading file');
        }
    }
});

lyricsCloseBtn.addEventListener('click', closeLyrics);
lyricsModal.addEventListener('click', (e) => {
    if (e.target === lyricsModal) closeLyrics();
});

function initPlaylistEditing() {
    editPlaylistBtn.addEventListener('click', togglePlaylistEditMode);
}

function togglePlaylistEditMode() {
    if (!tracks.length) { showNotification('No tracks to edit'); return; }
    isPlaylistEditing = !isPlaylistEditing;
    if (isPlaylistEditing) enterEditMode();
    else exitEditMode();
}

function enterEditMode() {
    editPlaylistBtn.classList.add('active');
    editPlaylistBtn.innerHTML = '<i class="fas fa-save"></i> <span class="btn-text">Save</span>';
    document.querySelector('.search-wrapper').classList.add('editing');
    tracks = [...originalTracks];
    refreshTrackList();
    showNotification('Edit mode: Drag tracks to reorder', 2000);
}

function exitEditMode() {
    editPlaylistBtn.classList.remove('active');
    editPlaylistBtn.innerHTML = '<i class="fas fa-edit"></i> <span class="btn-text">Edit</span>';
    document.querySelector('.search-wrapper').classList.remove('editing');
    const items = document.querySelectorAll('.track-item-small');
    items.forEach(item => {
        item.classList.remove('editable');
        item.removeAttribute('draggable');
        item.style.transition = 'all 0.2s ease';
    });
    savePlaylistOrder();
    originalTracks = [...tracks];
    setTimeout(() => {
        refreshTrackList();
        showSaveNotification('Playlist order saved!');
    }, 200);
}

function setupDragAndDrop() {
    const items = document.querySelectorAll('.track-item-small');
    items.forEach(item => {
        item.classList.add('editable');
        item.setAttribute('draggable', 'true');
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('drop', handleDrop);
        item.addEventListener('dragend', handleDragEnd);
        item.addEventListener('dragleave', handleDragLeave);
    });
    trackList.addEventListener('dragover', handleContainerDragOver);
    trackList.addEventListener('drop', handleContainerDrop);
    trackList.addEventListener('dragleave', handleContainerDragLeave);
    if (dropIndicator) dropIndicator.remove();
    dropIndicator = document.createElement('div');
    dropIndicator.className = 'drop-indicator';
    trackList.appendChild(dropIndicator);
}

function handleDragStart(e) {
    draggedItem = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.dataset.index);
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!draggedItem || this === draggedItem) return;
    document.querySelectorAll('.track-item-small').forEach(i => i.classList.remove('drop-zone-above', 'drop-zone-below'));
    const rect = this.getBoundingClientRect();
    const y = e.clientY - rect.top;
    if (y < rect.height / 2) {
        this.classList.add('drop-zone-above');
        insertAfterIndex = parseInt(this.dataset.index) - 1;
    } else {
        this.classList.add('drop-zone-below');
        insertAfterIndex = parseInt(this.dataset.index);
    }
}
function handleDrop(e) {
    e.preventDefault();
    if (!draggedItem || this === draggedItem) return;
    const fromIndex = parseInt(draggedItem.dataset.index);
    let toIndex = parseInt(this.dataset.index);
    const rect = this.getBoundingClientRect();
    if (e.clientY - rect.top >= rect.height / 2) toIndex++;
    if (fromIndex < toIndex) toIndex--;
    if (fromIndex === toIndex) { resetDragState(); return; }
    const [moved] = tracks.splice(fromIndex, 1);
    tracks.splice(toIndex, 0, moved);
    updateCurrentTrackIndex(fromIndex, toIndex);
    refreshTrackList();
    resetDragState();
}
function handleDragEnd(e) {
    resetDragState();
}

function handleDragLeave(e) {
    this.classList.remove('drop-zone-above', 'drop-zone-below');
}

function handleContainerDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!draggedItem) return;

    const containerRect = trackList.getBoundingClientRect();
    const y = e.clientY - containerRect.top;
    const trackItems = document.querySelectorAll('.track-item-small');
    if (trackItems.length === 0) {
        showDropIndicatorAtPosition(0);
        insertAfterIndex = -1;
        return;
    }

    let targetIndex = -1;
    let position = 'below';
    for (let i = 0; i < trackItems.length; i++) {
        const item = trackItems[i];
        const rect = item.getBoundingClientRect();
        const itemTop = rect.top - containerRect.top;
        const itemBottom = itemTop + rect.height;
        if (y >= itemTop && y <= itemBottom) {
            if (y - itemTop < rect.height / 2) {
                targetIndex = i;
                position = 'above';
            } else {
                targetIndex = i;
                position = 'below';
            }
            break;
        }
        if (i < trackItems.length - 1) {
            const nextItem = trackItems[i + 1];
            const nextTop = nextItem.getBoundingClientRect().top - containerRect.top;
            if (y > itemBottom && y < nextTop) {
                targetIndex = i;
                position = 'below';
                break;
            }
        }
    }
    if (targetIndex === -1 && y > trackItems[trackItems.length - 1].getBoundingClientRect().bottom - containerRect.top) {
        targetIndex = trackItems.length - 1;
        position = 'below';
    }
    if (targetIndex === -1 && y < trackItems[0].getBoundingClientRect().top - containerRect.top) {
        targetIndex = -1;
        position = 'above';
    }

    if (targetIndex === -1) {
        showDropIndicatorAtPosition(0);
        insertAfterIndex = -1;
    } else if (position === 'above') {
        showDropIndicatorAtPosition(targetIndex);
        insertAfterIndex = targetIndex - 1;
    } else {
        showDropIndicatorAtPosition(targetIndex + 1);
        insertAfterIndex = targetIndex;
    }
}
function handleContainerDrop(e) {
    e.preventDefault();
    if (!draggedItem) return;
    const fromIndex = parseInt(draggedItem.dataset.index);
    let insertIndex = insertAfterIndex === -1 ? 0 : insertAfterIndex + 1;
    if (fromIndex < insertIndex) insertIndex--;
    if (fromIndex !== insertIndex) {
        const [moved] = tracks.splice(fromIndex, 1);
        tracks.splice(insertIndex, 0, moved);
        updateCurrentTrackIndex(fromIndex, insertIndex);
        refreshTrackList();
    }
    resetDragState();
}

function handleContainerDragLeave(e) {
    if (!trackList.contains(e.relatedTarget)) {
        hideDropIndicator();
        insertAfterIndex = -1;
    }
}
function showDropIndicatorAtPosition(position) {
    if (!dropIndicator) return;
    const trackItems = document.querySelectorAll('.track-item-small');
    let top = 0;
    if (position === 0) {
        top = 0;
    } else if (position >= trackItems.length) {
        if (trackItems.length > 0) {
            const last = trackItems[trackItems.length - 1];
            top = last.offsetTop + last.offsetHeight;
        } else {
            top = 0;
        }
    } else {
        const prev = trackItems[position - 1];
        top = prev.offsetTop + prev.offsetHeight;
    }
    dropIndicator.style.top = `${top}px`;
    dropIndicator.classList.add('visible');
}
function hideDropIndicator() {
    if (dropIndicator) dropIndicator.classList.remove('visible');
}

function updateCurrentTrackIndex(from, to) {
    if (currentTrackIndex === from) currentTrackIndex = to;
    else if (currentTrackIndex > from && currentTrackIndex <= to) currentTrackIndex--;
    else if (currentTrackIndex < from && currentTrackIndex >= to) currentTrackIndex++;
}

function resetDragState() {
    document.querySelectorAll('.track-item-small').forEach(i => i.classList.remove('dragging', 'drop-zone-above', 'drop-zone-below'));
    hideDropIndicator();
    draggedItem = null;
    insertAfterIndex = -1;
}

function savePlaylistOrder() {
    try {
        const order = tracks.map(t => t.path);
        fs.writeFileSync(PLAYLIST_ORDER_FILE, JSON.stringify({ playlistOrder: order, lastModified: new Date().toISOString(), libraryPath: libraryFolder, trackCount: tracks.length }, null, 2));
    } catch (e) { }
}
function loadPlaylistOrder() {
    try {
        if (fs.existsSync(PLAYLIST_ORDER_FILE)) {
            const data = JSON.parse(fs.readFileSync(PLAYLIST_ORDER_FILE, 'utf-8'));
            if (data.playlistOrder?.length && data.libraryPath === libraryFolder) {
                const map = new Map(tracks.map(t => [t.path, t]));
                const sorted = [], rest = [];
                data.playlistOrder.forEach(p => { if (map.has(p)) { sorted.push(map.get(p)); map.delete(p); } });
                tracks.forEach(t => { if (map.has(t.path)) rest.push(t); });
                tracks = [...sorted, ...rest];
            }
        }
    } catch (e) { }
}

function openShortcuts() {
    shortcutsModal.style.display = 'flex';
    setTimeout(() => shortcutsModal.classList.add('show'), 10);
}

function closeShortcuts() {
    shortcutsModal.classList.remove('show');
    setTimeout(() => {
        shortcutsModal.style.display = 'none';
    }, 300);
}

shortcutsBtn.addEventListener('click', openShortcuts);
shortcutsCloseBtn.addEventListener('click', closeShortcuts);
shortcutsModal.addEventListener('click', (e) => {
    if (e.target === shortcutsModal) closeShortcuts();
});

function openSettingsModal() {
    settingsModal.style.display = 'flex';
    setTimeout(() => settingsModal.classList.add('show'), 10);
}

function closeSettingsModal() {
    settingsModal.classList.remove('show');
    setTimeout(() => {
        settingsModal.style.display = 'none';
    }, 300);
}

settingsBtn.addEventListener('click', openSettingsModal);
settingsCloseBtn.addEventListener('click', closeSettingsModal);
settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettingsModal();
});

discordRpcToggle.addEventListener('change', (e) => {
    discordRpcEnabled = e.target.checked;
    config.saveSettings(volumeSlider.value, libraryFolder, repeatMode, discordRpcEnabled, currentTheme);
    if (!discordRpcEnabled) {
        ipcRenderer.send('update-presence', null);
    } else {
        if (isPlaying && tracks[currentTrackIndex]) {
            updateDiscordPresence();
        }
    }
});

themeToggle.addEventListener('change', (e) => {
    const newTheme = e.target.checked ? 'light' : 'dark';
    applyTheme(newTheme);
    config.saveSettings(volumeSlider.value, libraryFolder, repeatMode, discordRpcEnabled, newTheme);
});

// ========== ОБРАБОТЧИК КЛАВИШ С ПОДДЕРЖКОЙ CTRL+S ==========
document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.code === 'KeyW') {
        e.preventDefault();
        return;
    }
    if (e.ctrlKey && e.code === 'KeyQ') {
        e.preventDefault();
        return;
    }

    const isLyricsOpen = lyricsModal.style.display === 'flex';
    const isMetadataOpen = metadataModal.classList.contains('show');
    const isShortcutsOpen = shortcutsModal.classList.contains('show');
    const isSettingsOpen = settingsModal.classList.contains('show');

    // Escape закрывает любую открытую модалку
    if (e.key === 'Escape') {
        if (isSettingsOpen) closeSettingsModal();
        else if (isShortcutsOpen) closeShortcuts();
        else if (isLyricsOpen) closeLyrics();
        else if (isMetadataOpen) closeMetadataModal();
        return;
    }

    // Ctrl+S в метаданных: сохранить и закрыть
    if (e.ctrlKey && e.code === 'KeyS' && isMetadataOpen) {
        e.preventDefault();
        metadataSaveBtn.click();
        return;
    }

    // Ctrl+S в лирикс: сохранить (но не закрывать)
    if (e.ctrlKey && e.code === 'KeyS' && isLyricsOpen) {
        e.preventDefault();
        lyricsSaveBtn.click();
        return;
    }

    // Toggle для настроек (Ctrl+E)
    if (e.ctrlKey && e.code === 'KeyE') {
        e.preventDefault();
        if (isSettingsOpen) {
            closeSettingsModal();
        } else if (!isShortcutsOpen && !isLyricsOpen && !isMetadataOpen) {
            openSettingsModal();
        }
        return;
    }

    // Toggle для шорткатов (Ctrl+A)
    if (e.ctrlKey && e.code === 'KeyA') {
        e.preventDefault();
        if (isShortcutsOpen) {
            closeShortcuts();
        } else if (!isSettingsOpen && !isLyricsOpen && !isMetadataOpen) {
            openShortcuts();
        }
        return;
    }

    // Toggle для метаданных (Ctrl+X)
    if (e.ctrlKey && e.code === 'KeyX') {
        e.preventDefault();
        if (isMetadataOpen) {
            closeMetadataModal();
        } else if (!isSettingsOpen && !isShortcutsOpen && !isLyricsOpen && tracks[currentTrackIndex]) {
            openMetadataModal();
        }
        return;
    }

    // Toggle для лирикс (Ctrl+D)
    if (e.ctrlKey && e.code === 'KeyD') {
        e.preventDefault();
        if (isLyricsOpen) {
            closeLyrics();
        } else if (!isSettingsOpen && !isShortcutsOpen && !isMetadataOpen && tracks[currentTrackIndex]) {
            openLyrics(tracks[currentTrackIndex]);
        }
        return;
    }

    // Редактирование плейлиста (Ctrl+Shift+E)
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyE') {
        e.preventDefault();
        if (tracks.length) togglePlaylistEditMode();
        return;
    }

    // Пробел
    if (e.key === ' ' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        isPlaying ? pauseTrack() : playTrack();
        return;
    }

    // Стрелки
    if (e.key === 'ArrowRight') {
        e.preventDefault();
        nextTrack();
        return;
    }
    if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prevTrack();
        return;
    }
});
// ========== КОНЕЦ ОБРАБОТЧИКА ==========

playBtn.addEventListener('click', playTrack);
pauseBtn.addEventListener('click', pauseTrack);
nextBtn.addEventListener('click', nextTrack);
prevBtn.addEventListener('click', prevTrack);
repeatBtn.addEventListener('click', toggleRepeat);

audio.addEventListener('play', () => { if (!isExternalControl) { isPlaying = true; playBtn.style.display = 'none'; pauseBtn.style.display = 'flex'; } });
audio.addEventListener('pause', () => { if (!isExternalControl) { isPlaying = false; playBtn.style.display = 'flex'; pauseBtn.style.display = 'none'; } });
if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => { isExternalControl = true; playTrack(); });
    navigator.mediaSession.setActionHandler('pause', () => { isExternalControl = true; pauseTrack(); });
    navigator.mediaSession.setActionHandler('previoustrack', () => { isExternalControl = true; prevTrack(); });
    navigator.mediaSession.setActionHandler('nexttrack', () => { isExternalControl = true; nextTrack(); });
}
audio.addEventListener('timeupdate', () => {
    const p = (audio.currentTime / audio.duration) * 100 || 0;
    progressSlider.value = p;
    currentTimeEl.textContent = formatTime(audio.currentTime);
});
progressSlider.addEventListener('input', e => {
    audio.currentTime = (e.target.value / 100) * audio.duration;
    if (isPlaying) {
        presenceStartTimestamp = Date.now() - audio.currentTime;
        updateDiscordPresence();
    }
});
volumeSlider.addEventListener('input', e => { audio.volume = e.target.value / 100; config.saveSettings(volumeSlider.value, libraryFolder, repeatMode, discordRpcEnabled, currentTheme); });
audio.addEventListener('ended', () => {
    if (repeatMode === 'one') { audio.currentTime = 0; playTrack(); }
    else if (repeatMode === 'all') nextTrack();
    else { isPlaying = false; playBtn.style.display = 'flex'; pauseBtn.style.display = 'none'; }
});

function updateSizes() {
    const w = window.innerWidth;
    const art = document.getElementById('album-art-small');
    let size, fontSize;
    if (w > 550) { size = 180; fontSize = 44; }
    else { size = 140; fontSize = 36; }
    art.style.width = `${size}px`;
    art.style.height = `${size}px`;
    art.style.fontSize = `${fontSize}px`;
}

function openMetadataModal() {
    if (!tracks[currentTrackIndex]) { showNotification('No track selected'); return; }
    const track = tracks[currentTrackIndex];
    metadataTitle.value = track.name;
    metadataArtist.value = track.artist;
    metadataAlbum.value = track.album || '';
    updateCoverPreview(track.cover);
    currentCoverFile = null;
    metadataModal.style.display = 'block';
    setTimeout(() => metadataModal.classList.add('show'), 10);
}
function updateCoverPreview(coverUrl) {
    while (metadataCoverPreview.firstChild) metadataCoverPreview.firstChild.remove();
    if (coverUrl) {
        const img = document.createElement('img');
        img.src = coverUrl;
        img.alt = 'Cover';
        metadataCoverPreview.appendChild(img);
    } else {
        const icon = document.createElement('i');
        icon.className = 'fas fa-music';
        metadataCoverPreview.appendChild(icon);
    }
}
function closeMetadataModal() {
    metadataModal.classList.remove('show');
    metadataModal.classList.add('closing');
    setTimeout(() => { metadataModal.style.display = 'none'; metadataModal.classList.remove('closing'); }, 300);
}
function handleCoverInput(e) {
    const file = e.target.files[0];
    if (file) {
        currentCoverFile = file;
        updateCoverPreview(URL.createObjectURL(file));
        showNotification('Cover selected');
    }
}
async function saveMetadata() {
    if (!tracks[currentTrackIndex]) return;
    const track = tracks[currentTrackIndex];
    const newTitle = metadataTitle.value.trim();
    const newArtist = metadataArtist.value.trim();
    const newAlbum = metadataAlbum.value.trim();
    if (!newTitle) { showNotification('Title cannot be empty'); return; }
    try {
        const NodeID3 = require('node-id3');
        const tags = { title: newTitle, artist: newArtist, album: newAlbum };
        if (currentCoverFile) {
            const reader = new FileReader();
            reader.onload = ev => {
                tags.image = { mime: currentCoverFile.type, type: { id: 3 }, description: 'Cover', imageBuffer: Buffer.from(ev.target.result) };
                if (NodeID3.write(tags, track.path)) updateTrackAfterSave(track, newTitle, newArtist, newAlbum, true);
                else throw new Error('Failed to write tags');
            };
            reader.readAsArrayBuffer(currentCoverFile);
        } else {
            if (NodeID3.write(tags, track.path)) updateTrackAfterSave(track, newTitle, newArtist, newAlbum, false);
            else throw new Error('Failed to write tags');
        }
    } catch (e) { showNotification('Error saving metadata'); }
}
function updateTrackAfterSave(track, title, artist, album, coverChanged) {
    track.name = title; track.artist = artist; track.album = album;
    if (coverChanged && currentCoverFile) {
        if (track.cover?.startsWith('blob:')) URL.revokeObjectURL(track.cover);
        track.cover = URL.createObjectURL(currentCoverFile);
    }
    const cacheKey = track.path + fs.statSync(track.path).mtime.getTime();
    coverCache.set(cacheKey, track);
    const idx = originalTracks.findIndex(t => t.path === track.path);
    if (idx !== -1) originalTracks[idx] = { ...track };
    updateTrackInfo(currentTrackIndex);
    updateAlbumArt(track.cover, track.name);
    refreshTrackList();
    showNotification('Metadata saved successfully');
    closeMetadataModal();
}

document.addEventListener('DOMContentLoaded', () => {
    const saved = config.loadSettings();
    if (saved.volume >= 0 && saved.volume <= 100) { audio.volume = saved.volume / 100; volumeSlider.value = saved.volume; }
    if (saved.repeatMode && ['none', 'all', 'one'].includes(saved.repeatMode)) {
        repeatMode = saved.repeatMode;
        repeatBtn.classList.remove('repeat-one', 'repeat-all');
        if (repeatMode === 'one') repeatBtn.classList.add('repeat-one');
        else if (repeatMode === 'all') repeatBtn.classList.add('repeat-all');
        document.getElementById('repeat-status').textContent = repeatMode === 'one' ? 'repeat mode: one' : repeatMode === 'all' ? 'repeat mode: all' : 'repeat mode: none';
    }
    if (saved.discordRpcEnabled !== undefined) {
        discordRpcEnabled = saved.discordRpcEnabled;
        if (discordRpcToggle) discordRpcToggle.checked = discordRpcEnabled;
    } else {
        discordRpcEnabled = true;
        if (discordRpcToggle) discordRpcToggle.checked = true;
    }
    if (saved.theme) {
        currentTheme = saved.theme;
        applyTheme(currentTheme);
        if (themeToggle) themeToggle.checked = (currentTheme === 'light');
    } else {
        applyTheme('dark');
        if (themeToggle) themeToggle.checked = false;
    }
    if (saved.libraryPath && fs.existsSync(saved.libraryPath)) {
        libraryFolder = saved.libraryPath;
        libraryPath.textContent = path.basename(libraryFolder);
        coverCache.clear();
        loadTracksFromFolder(libraryFolder);
    } else if (saved.libraryPath) {
        libraryPath.textContent = 'Path not found';
    }
    initPlaylistEditing();
    updateSizes();
});

editMetadataBtn.addEventListener('click', openMetadataModal);
metadataModalClose.addEventListener('click', closeMetadataModal);
metadataCoverBtn.addEventListener('click', () => metadataCoverInput.click());
metadataCoverInput.addEventListener('change', handleCoverInput);
metadataSaveBtn.addEventListener('click', saveMetadata);
metadataCancelBtn.addEventListener('click', closeMetadataModal);
window.addEventListener('click', e => { if (e.target === metadataModal) closeMetadataModal(); });
window.addEventListener('resize', updateSizes);
window.addEventListener('beforeunload', () => {
    coverCache.forEach(t => { if (t.cover?.startsWith('blob:')) URL.revokeObjectURL(t.cover); });
    if (audio.src?.startsWith('blob:')) URL.revokeObjectURL(audio.src);
});