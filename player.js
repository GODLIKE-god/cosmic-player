// ===== Элементы DOM =====
const audio = document.getElementById('audioPlayer');
const fileInput = document.getElementById('fileInput');
const playBtn = document.getElementById('playBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const shuffleBtn = document.getElementById('shuffleBtn');
const repeatBtn = document.getElementById('repeatBtn');
const clearBtn = document.getElementById('clearBtn');
const progressBar = document.getElementById('progressBar');
const volumeBar = document.getElementById('volumeBar');
const volumeIcon = document.getElementById('volumeIcon');
const currentTimeEl = document.getElementById('currentTime');
const durationEl = document.getElementById('duration');
const trackTitle = document.getElementById('trackTitle');
const trackSubtitle = document.getElementById('trackSubtitle');
const libraryEl = document.getElementById('library');
const libraryCount = document.getElementById('libraryCount');
const toast = document.getElementById('toast');
const canvas = document.getElementById('visualizer');

const coverPanel = document.getElementById('coverPanel');
const coverLargeImg = document.getElementById('coverLargeImg');
const coverLargePlaceholder = document.getElementById('coverLargePlaceholder');

// ===== Настройка базы данных =====
localforage.config({ name: 'CosmicPlayer', storeName: 'tracks' });

// ===== Состояние =====
let tracks = [];
let currentIndex = -1;
let isPlaying = false;
let isShuffle = false;
let isRepeat = false;
let themeMode = 0;

// ===== Web Audio API =====
let audioCtx = null;
let analyser = null;
let sourceNode = null;
let freqData = null;
let timeData = null;

// ===== Обложка =====
let loadedCoverImg = null;
let coverOpacity = 0;
let coverTargetOpacity = 0;

// ===== Форматирование =====
function formatTime(sec) {
    if (!isFinite(sec) || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

// ===== Toast =====
let toastTimer = null;
function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

// ===== Аудио =====
function initAudioContext() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 4096; // Увеличили для большей детализации
    analyser.smoothingTimeConstant = 0.8;
    freqData = new Uint8Array(analyser.frequencyBinCount);
    timeData = new Uint8Array(analyser.fftSize);

    try {
        sourceNode = audioCtx.createMediaElementSource(audio);
        sourceNode.connect(analyser);
        analyser.connect(audioCtx.destination);
    } catch (e) { console.warn('Web Audio init:', e); }
}

// ===== Обложка =====
async function fetchCover(query) {
    if (!query) return null;
    let cleanQuery = query.replace(/_[0-9]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    try {
        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(cleanQuery)}&entity=song&limit=1`;
        const response = await fetch(url);
        if (!response.ok) return null;
        const data = await response.json();
        if (data.results && data.results.length > 0) {
            const artwork = data.results[0].artworkUrl100;
            if (artwork) return artwork.replace('100x100', '600x600');
        }
    } catch (err) { console.warn('Cover fetch error:', err); }
    return null;
}

function setCover(url) {
    if (!url) {
        coverPanel.classList.remove('visible', 'playing');
        coverLargeImg.style.display = 'none';
        coverLargePlaceholder.style.display = 'flex';
        loadedCoverImg = null;
        coverTargetOpacity = 0;
        return;
    }
    coverPanel.classList.add('visible');
    coverLargePlaceholder.style.display = 'none';
    coverLargeImg.style.display = 'block';
    coverLargeImg.src = url;
    
    coverLargeImg.classList.remove('cover-glitch');
    void coverLargeImg.offsetWidth;
    coverLargeImg.classList.add('cover-glitch');

    coverLargeImg.style.animation = 'none';
    void coverLargeImg.offsetWidth;
    coverLargeImg.style.animation = 'coverFadeIn 0.6s ease forwards';

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    img.onload = () => { loadedCoverImg = img; coverTargetOpacity = 0.2; }; // Чуть ярче на фоне
    img.onerror = () => { coverTargetOpacity = 0; };
}

// ===== Инициализация базы =====
async function loadSavedTracks() {
    try {
        const keys = await localforage.keys();
        const savedTracks = [];
        
        for (const key of keys) {
            const data = await localforage.getItem(key);
            if (data && data.name) {
                const url = URL.createObjectURL(data.blob);
                savedTracks.push({
                    id: key, name: data.name, url: url, duration: data.duration,
                    coverUrl: data.coverUrl, album: data.album || 'Загруженные треки'
                });
            }
        }
        
        savedTracks.sort((a, b) => a.album !== b.album ? a.album.localeCompare(b.album) : a.name.localeCompare(b.name));
        tracks = savedTracks;
        renderLibrary();
        if (tracks.length > 0) showToast(`Восстановлено треков: ${tracks.length}`);
    } catch (err) { console.error('Ошибка загрузки из БД:', err); }
}
loadSavedTracks();

// ===== Загрузка файлов =====
fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    let added = 0;
    fileInput.disabled = true;
    showToast(`Загрузка ${files.length} файлов...`);

    for (const file of files) {
        if (!file.type.startsWith('audio/')) continue;
        
        const url = URL.createObjectURL(file);
        const name = file.name.replace(/\.[^.]+$/, '');
        const duration = await getAudioDuration(url);
        
        let album = 'Загруженные треки';
        if (file.webkitRelativePath) {
            const parts = file.webkitRelativePath.split('/');
            if (parts.length > 1) album = parts[parts.length - 2];
        } else if (name.includes(' - ')) {
            const parts = name.split(' - ');
            if (parts.length >= 3) album = parts[1].trim();
        }

        const track = { name, url, duration, coverUrl: null, album };
        const id = 'track_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        track.id = id;

        try {
            await localforage.setItem(id, { name, blob: file, duration, album });
        } catch (err) {
            showToast('Не удалось сохранить файл (мало места)');
            continue;
        }

        tracks.push(track);
        added++;
        
        fetchCover(name).then(async coverUrl => {
            if (coverUrl) {
                track.coverUrl = coverUrl;
                const existing = await localforage.getItem(id);
                if (existing) { existing.coverUrl = coverUrl; await localforage.setItem(id, existing); }
                if (tracks[currentIndex] === track) setCover(coverUrl);
                renderLibrary();
            }
        });
        renderLibrary();
    }
    
    fileInput.disabled = false;
    fileInput.value = '';
    if (added > 0) showToast(`Добавлено треков: ${added}`);
});

clearBtn.addEventListener('click', async () => {
    if (confirm('Удалить все треки из библиотеки навсегда?')) {
        await localforage.clear();
        tracks = [];
        currentIndex = -1;
        audio.pause();
        isPlaying = false;
        updatePlayButton();
        setCover(null);
        renderLibrary();
        trackTitle.textContent = 'Трек не выбран';
        trackSubtitle.textContent = 'Загрузите музыку и выберите из библиотеки';
        progressBar.value = 0;
        currentTimeEl.textContent = '0:00';
        durationEl.textContent = '0:00';
        showToast('Библиотека очищена');
    }
});

function getAudioDuration(url) {
    return new Promise((resolve) => {
        const temp = new Audio();
        temp.preload = 'metadata';
        temp.src = url;
        temp.onloadedmetadata = () => resolve(temp.duration);
        temp.onerror = () => resolve(0);
    });
}

// ===== Рендер =====
function renderLibrary() {
    libraryEl.innerHTML = '';
    libraryCount.textContent = tracks.length;
    if (tracks.length === 0) { libraryEl.innerHTML = '<div class="empty-library">Здесь появятся загруженные треки</div>'; return; }

    let lastAlbum = null;
    tracks.forEach((track, i) => {
        if (track.album !== lastAlbum) {
            const header = document.createElement('div');
            header.className = 'album-divider';
            header.textContent = track.album;
            libraryEl.appendChild(header);
            lastAlbum = track.album;
        }
        const item = document.createElement('div');
        item.className = 'track-item' + (i === currentIndex ? ' active' : '');
        const coverHTML = track.coverUrl ? `<img class="track-item-cover" src="${track.coverUrl}" alt="">` : `<div class="track-item-cover placeholder">♪</div>`;
        item.innerHTML = `
            ${coverHTML}
            <div class="track-item-name">${i === currentIndex && isPlaying ? '▶ ' : ''}${escapeHtml(track.name)}</div>
            <div class="track-item-duration">${formatTime(track.duration)}</div>
            <button class="delete-btn" title="Удалить">✕</button>
        `;
        item.addEventListener('click', (ev) => { if (!ev.target.classList.contains('delete-btn')) loadTrack(i, true); });
        item.querySelector('.delete-btn').addEventListener('click', async (ev) => { ev.stopPropagation(); await removeTrack(i); });
        libraryEl.appendChild(item);
    });
}

function escapeHtml(str) {
    return str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function removeTrack(index) {
    const track = tracks[index];
    if (track.id) await localforage.removeItem(track.id);
    tracks.splice(index, 1);
    if (index === currentIndex) {
        audio.pause(); isPlaying = false; updatePlayButton(); currentIndex = -1;
        trackTitle.textContent = 'Трек не выбран'; trackSubtitle.textContent = 'Загрузите музыку и выберите из библиотеки';
        progressBar.value = 0; currentTimeEl.textContent = '0:00'; durationEl.textContent = '0:00';
        setCover(null);
    } else if (index < currentIndex) currentIndex--;
    renderLibrary();
    showToast('Трек удалён');
}

// ===== Управление =====
function loadTrack(index, autoplay = false) {
    if (index < 0 || index >= tracks.length) return;
    initAudioContext();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

    currentIndex = index;
    const track = tracks[index];
    audio.src = track.url;
    audio.load();
    trackTitle.textContent = track.name;
    trackSubtitle.textContent = `Трек ${index + 1} из ${tracks.length}`;
    progressBar.value = 0; currentTimeEl.textContent = '0:00';
    
    if (track.coverUrl) setCover(track.coverUrl);
    else {
        setCover(null); trackSubtitle.textContent = 'Поиск обложки...';
        fetchCover(track.name).then(coverUrl => {
            if (tracks[currentIndex] === track) {
                if (coverUrl) {
                    track.coverUrl = coverUrl; setCover(coverUrl); trackSubtitle.textContent = `Трек ${index + 1} из ${tracks.length}`;
                    if (track.id) localforage.getItem(track.id).then(existing => { if (existing) { existing.coverUrl = coverUrl; localforage.setItem(track.id, existing); } });
                    renderLibrary();
                } else trackSubtitle.textContent = `Трек ${index + 1} из ${tracks.length} · обложка не найдена`;
            }
        });
    }
    renderLibrary();

    if (autoplay) {
        audio.play().then(() => { isPlaying = true; updatePlayButton(); updateCoverPlaying(); renderLibrary(); }).catch(err => console.warn(err));
    }
}

function updateCoverPlaying() {
    if (isPlaying && coverPanel.classList.contains('visible')) coverPanel.classList.add('playing');
    else coverPanel.classList.remove('playing');
}

function togglePlay() {
    if (currentIndex === -1) { if (tracks.length === 0) { showToast('Сначала загрузите треки'); return; } loadTrack(0, true); return; }
    initAudioContext();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

    if (audio.paused) {
        audio.play().then(() => { isPlaying = true; updatePlayButton(); updateCoverPlaying(); renderLibrary(); }).catch(err => console.warn(err));
    } else {
        audio.pause(); isPlaying = false; updatePlayButton(); updateCoverPlaying(); renderLibrary();
    }
}
function updatePlayButton() { playBtn.textContent = isPlaying ? '⏸' : '▶'; }
playBtn.addEventListener('click', togglePlay);

function getNextIndex() {
    if (tracks.length === 0) return -1;
    if (isShuffle) { let idx; do { idx = Math.floor(Math.random() * tracks.length); } while (idx === currentIndex && tracks.length > 1); return idx; }
    return (currentIndex + 1) % tracks.length;
}

prevBtn.addEventListener('click', () => { if (tracks.length === 0) return; if (audio.currentTime > 3) { audio.currentTime = 0; return; } loadTrack(currentIndex <= 0 ? tracks.length - 1 : currentIndex - 1, true); });
nextBtn.addEventListener('click', () => { if (tracks.length === 0) return; loadTrack(getNextIndex(), true); });

shuffleBtn.addEventListener('click', () => { isShuffle = !isShuffle; shuffleBtn.classList.toggle('active', isShuffle); showToast(isShuffle ? 'Случайный порядок' : 'По порядку'); });
repeatBtn.addEventListener('click', () => { isRepeat = !isRepeat; repeatBtn.classList.toggle('active', isRepeat); showToast(isRepeat ? 'Повтор включен' : 'Повтор выключен'); });

// ===== Прогресс и громкость =====
audio.addEventListener('timeupdate', () => { if (audio.duration) { progressBar.value = (audio.currentTime / audio.duration) * 100; currentTimeEl.textContent = formatTime(audio.currentTime); } });
audio.addEventListener('loadedmetadata', () => { durationEl.textContent = formatTime(audio.duration); });
progressBar.addEventListener('input', () => { if (audio.duration) audio.currentTime = (progressBar.value / 100) * audio.duration; });
audio.addEventListener('ended', () => {
    if (isRepeat) { audio.currentTime = 0; audio.play(); }
    else if (tracks.length > 1) loadTrack(getNextIndex(), true);
    else { isPlaying = false; updatePlayButton(); updateCoverPlaying(); renderLibrary(); }
});

audio.volume = 0.7;
volumeBar.addEventListener('input', () => { audio.volume = volumeBar.value / 100; updateVolumeIcon(); });
function updateVolumeIcon() {
    const v = audio.volume;
    if (v === 0) volumeIcon.textContent = '🔇';
    else if (v < 0.4) volumeIcon.textContent = '🔈';
    else if (v < 0.7) volumeIcon.textContent = '🔉';
    else volumeIcon.textContent = '🔊';
}
volumeIcon.addEventListener('click', () => {
    if (audio.volume > 0) { audio.dataset.prevVolume = audio.volume; audio.volume = 0; volumeBar.value = 0; }
    else { const v = parseFloat(audio.dataset.prevVolume) || 0.7; audio.volume = v; volumeBar.value = v * 100; }
    updateVolumeIcon();
});

document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.code === 'ArrowRight') audio.currentTime += 5;
    else if (e.code === 'ArrowLeft') audio.currentTime -= 5;
    else if (e.code === 'ArrowUp') { audio.volume = Math.min(1, audio.volume + 0.05); volumeBar.value = audio.volume * 100; updateVolumeIcon(); }
    else if (e.code === 'ArrowDown') { audio.volume = Math.max(0, audio.volume - 0.05); volumeBar.value = audio.volume * 100; updateVolumeIcon(); }
});

const themes = [{ name: 'Монохром', hue: 0 }];
const themeBtn = document.getElementById('themeBtn');
themeBtn.addEventListener('click', () => {
    showToast('Монохромный режим');
});

// =====================================================
//  ВИЗУАЛИЗАЦИЯ (АКТИВНЫЙ ИНТЕРАКТИВНЫЙ ФОН)
// =====================================================
const ctx = canvas.getContext('2d');
let W, H;
const particles = [];
const pulseRings = []; // Кольца для реакции на вокал/слова

function resize() { 
    W = canvas.width = window.innerWidth; 
    H = canvas.height = window.innerHeight; 
}
window.addEventListener('resize', resize);
resize();

// Инициализация частиц для созвездий
function initParticles() {
    particles.length = 0;
    const count = 80; // Больше частиц для активности
    for (let i = 0; i < count; i++) {
        particles.push({
            x: Math.random() * W,
            y: Math.random() * H,
            vx: (Math.random() - 0.5) * 0.5,
            vy: (Math.random() - 0.5) * 0.5,
            baseSize: Math.random() * 2 + 0.5
        });
    }
}
initParticles();

let smoothedBass = 0, smoothedMid = 0, smoothedTreble = 0, smoothedVolume = 0;
let smoothedVocal = 0; // Для реакции на "слова"

function animate() {
    requestAnimationFrame(animate);

    let bass = 0, mid = 0, treble = 0, volume = 0, vocal = 0;
    if (analyser) {
        analyser.getByteFrequencyData(freqData);
        analyser.getByteTimeDomainData(timeData);
        const n = freqData.length;
        
        // Частотные диапазоны
        const bassEnd = Math.floor(n * 0.06);   // Басы (20-250 Гц)
        const midEnd = Math.floor(n * 0.25);    // Средние (250-2000 Гц)
        const vocalEnd = Math.floor(n * 0.5);   // Вокал/слова (2-4 кГц)
        // Высокие - остальное

        for (let i = 0; i < bassEnd; i++) bass += freqData[i];
        for (let i = bassEnd; i < midEnd; i++) mid += freqData[i];
        for (let i = midEnd; i < vocalEnd; i++) vocal += freqData[i];
        for (let i = vocalEnd; i < n; i++) treble += freqData[i];

        bass /= (bassEnd || 1); 
        mid /= ((midEnd - bassEnd) || 1); 
        vocal /= ((vocalEnd - midEnd) || 1);
        treble /= ((n - vocalEnd) || 1);
        
        let sumSq = 0;
        for (let i = 0; i < timeData.length; i++) { const v = (timeData[i] - 128) / 128; sumSq += v * v; }
        volume = Math.sqrt(sumSq / timeData.length) * 255;
    }

    // Сглаживание
    smoothedBass   += (bass   - smoothedBass)   * 0.2; // Быстрее реагирует
    smoothedMid    += (mid    - smoothedMid)    * 0.15;
    smoothedTreble += (treble - smoothedTreble) * 0.15;
    smoothedVolume += (volume - smoothedVolume) * 0.2;
    smoothedVocal  += (vocal  - smoothedVocal)  * 0.25; // Очень быстрая реакция на слова

    const bassNorm = smoothedBass / 255;
    const midNorm = smoothedMid / 255;
    const trebleNorm = smoothedTreble / 255;
    const vocalNorm = smoothedVocal / 255;
    const volumeNorm = smoothedVolume / 255;
    
    // Общая энергия
    const energyNorm = Math.min(1, (smoothedBass + smoothedMid + smoothedTreble) / 180);

    ctx.clearRect(0, 0, W, H);

    // 0. Обложка на фоне (реагирует на громкость)
    coverOpacity += (coverTargetOpacity - coverOpacity) * 0.05;
    if (loadedCoverImg && coverOpacity > 0.01) {
        ctx.save();
        // Обложка становится ярче при громкой музыке
        ctx.globalAlpha = coverOpacity * (0.5 + volumeNorm * 0.5); 
        const img = loadedCoverImg;
        // Масштаб обложки тоже "дышит"
        const scaleBoost = 1 + bassNorm * 0.1;
        const scale = Math.max(W / img.width, H / img.height) * scaleBoost;
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        const x = (W - drawW) / 2;
        const y = (H - drawH) / 2;
        ctx.filter = `blur(${80 + bassNorm * 40}px) grayscale(100%) brightness(${0.1 + volumeNorm * 0.2})`;
        ctx.drawImage(img, x, y, drawW, drawH);
        ctx.filter = 'none';
        ctx.restore();
    }

    const t = Date.now();
    const centerX = W / 2;
    const centerY = H / 2;

    // =====================================================
    // 1. АУДИО-ТЕРРЕЙН (Горный ландшафт внизу экрана)
    // =====================================================
    const layers = 4; // Больше слоёв для глубины
    for (let l = 0; l < layers; l++) {
        const yOffset = H * 0.65 + l * 25;
        const alpha = 0.03 + l * 0.04 + energyNorm * 0.15;
        // Амплитуда сильно зависит от басов и громкости
        const amp = (10 + smoothedBass * 0.8 + smoothedVolume * 0.5) * (1 + l * 0.4);
        const freq = 0.004 + l * 0.002;
        const speed = 0.001 + l * 0.0005;
        
        ctx.beginPath();
        ctx.moveTo(0, H);
        
        for (let x = 0; x <= W; x += 10) {
            // Горы двигаются вверх-вниз от басов и "трясутся" от вокала
            const vocalShake = Math.sin(x * 0.05 + t * 0.01) * vocalNorm * 15;
            const y = yOffset + 
                      Math.sin(x * freq + t * speed + l) * amp +
                      Math.cos(x * freq * 2.3 + t * speed * 0.8) * amp * 0.4 +
                      vocalShake;
            ctx.lineTo(x, y);
        }
        
        ctx.lineTo(W, H);
        ctx.closePath();
        
        const grad = ctx.createLinearGradient(0, yOffset - 100, 0, H);
        grad.addColorStop(0, `rgba(255, 255, 255, ${alpha * 0.8})`);
        grad.addColorStop(1, `rgba(0, 0, 0, ${0.9})`);
        ctx.fillStyle = grad;
        ctx.fill();
        
        ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 1.5})`;
        ctx.lineWidth = 1 + bassNorm * 2; // Линия становится толще на басах
        ctx.stroke();
    }

    // =====================================================
    // 2. 3D-КАРКАСНАЯ СФЕРА (Wireframe Sphere)
    // =====================================================
    // Сфера пульсирует и вращается быстрее
    const sphereRadius = 60 + smoothedBass * 1.2 + smoothedVolume * 0.5;
    const rotation = t * (0.0005 + volumeNorm * 0.001);

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(rotation);

    const rings = 5;
    for (let i = 0; i < rings; i++) {
        const angle = (i / rings) * Math.PI;
        const r = Math.sin(angle) * sphereRadius;
        const yOffset = Math.cos(angle) * sphereRadius;
        
        // Горизонтальные кольца
        ctx.beginPath();
        // Ширина искажается от средних частот
        ctx.ellipse(0, 0, sphereRadius * (1 + midNorm * 0.1), Math.abs(yOffset), 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.1 + midNorm * 0.4})`;
        ctx.lineWidth = 1 + midNorm * 2;
        ctx.stroke();

        // Вертикальные кольца
        ctx.beginPath();
        ctx.ellipse(0, 0, Math.abs(yOffset), sphereRadius * (1 + trebleNorm * 0.1), 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.1 + trebleNorm * 0.4})`;
        ctx.lineWidth = 1 + trebleNorm * 2;
        ctx.stroke();
    }
    
    // Ядро сферы (вспыхивает на басах)
    const glowGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, sphereRadius * 1.5);
    glowGrad.addColorStop(0, `rgba(255, 255, 255, ${0.1 + bassNorm * 0.4})`);
    glowGrad.addColorStop(0.5, `rgba(255, 255, 255, ${0.05 + bassNorm * 0.1})`);
    glowGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(0, 0, sphereRadius * 1.5, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();

    // =====================================================
    // 3. СПЕКТРАЛЬНЫЕ ЛУЧИ (Реагируют на всё, вращаются)
    // =====================================================
    if (analyser) {
        const bars = 128;
        const barRadius = sphereRadius + 20;
        for (let i = 0; i < bars; i++) {
            const idx = Math.floor((i / bars) * freqData.length);
            const v = freqData[idx] / 255;
            // Лучи вытягиваются от громкости и "дрожат"
            const barLen = 5 + v * 100 * (0.5 + volumeNorm * 1.5);
            const angle = (i / bars) * Math.PI * 2 + t * 0.0008;
            
            const x1 = centerX + Math.cos(angle) * barRadius;
            const y1 = centerY + Math.sin(angle) * barRadius;
            const x2 = centerX + Math.cos(angle) * (barRadius + barLen);
            const y2 = centerY + Math.sin(angle) * (barRadius + barLen);

            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.strokeStyle = `rgba(255, 255, 255, ${0.05 + v * 0.8})`;
            ctx.lineWidth = 1 + v * 2;
            ctx.stroke();
        }
    }

    // =====================================================
    // 4. ВОЛНЫ ОТ ВОКАЛА / СЛОВ (Pulse Rings)
    // =====================================================
    // Если вокал громкий, рождается кольцо
    if (vocalNorm > 0.4 && Math.random() < 0.1) {
        pulseRings.push({
            r: sphereRadius,
            alpha: 1,
            speed: 2 + vocalNorm * 5
        });
    }

    for (let i = pulseRings.length - 1; i >= 0; i--) {
        const ring = pulseRings[i];
        ring.r += ring.speed;
        ring.alpha -= 0.01;

        if (ring.alpha <= 0) {
            pulseRings.splice(i, 1);
            continue;
        }

        ctx.beginPath();
        ctx.arc(centerX, centerY, ring.r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 255, 255, ${ring.alpha})`;
        ctx.lineWidth = 2 + ring.alpha * 5;
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#fff';
        ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // =====================================================
    // 5. СОЗВЕЗДИЯ (Очень активные)
    // =====================================================
    particles.forEach(p => {
        // Частицы разлетаются от басов и вокала
        const speedMult = 1 + bassNorm * 3 + vocalNorm * 2;
        p.x += p.vx * speedMult;
        p.y += p.vy * speedMult;

        if (p.x < -20) p.x = W + 20;
        if (p.x > W + 20) p.x = -20;
        if (p.y < -20) p.y = H + 20;
        if (p.y > H + 20) p.y = -20;
    });

    // Соединяем частицы, если они близко (яркость зависит от басов)
    const connectDist = 100 + smoothedVolume * 0.8;
    for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
            const dx = particles[i].x - particles[j].x;
            const dy = particles[i].y - particles[j].y;
            const dist = Math.hypot(dx, dy);
            
            if (dist < connectDist) {
                const alpha = (1 - dist / connectDist) * (0.1 + bassNorm * 0.5);
                ctx.beginPath();
                ctx.moveTo(particles[i].x, particles[i].y);
                ctx.lineTo(particles[j].x, particles[j].y);
                ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
                ctx.lineWidth = 0.5;
                ctx.stroke();
            }
        }
    }

    // Сами частицы
    particles.forEach(p => {
        const size = p.baseSize + bassNorm * 4; // Частицы сильно увеличиваются на басах
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${0.4 + bassNorm * 0.6})`;
        ctx.shadowBlur = 5 + bassNorm * 20;
        ctx.shadowColor = 'rgba(255, 255, 255, 0.8)';
        ctx.fill();
    });
    ctx.shadowBlur = 0;

    if (!isPlaying) {
        ctx.font = '600 14px Montserrat, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.textAlign = 'center';
        ctx.fillText('НАЖМИТЕ ▶ ДЛЯ ЗАПУСКА', W / 2, H - 40);
    }
}
animate();

// =====================================================
//  A-WAVES (ИНТЕРАКТИВНЫЙ ФОН + КЛИКИ)
// =====================================================
class Noise {
    constructor(seed = 0) {
        this.grad3 = [
            new Grad(1, 1, 0), new Grad(-1, 1, 0), new Grad(1, -1, 0), new Grad(-1, -1, 0),
            new Grad(1, 0, 1), new Grad(-1, 0, 1), new Grad(1, 0, -1), new Grad(-1, 0, -1),
            new Grad(0, 1, 1), new Grad(0, -1, 1), new Grad(0, 1, -1), new Grad(0, -1, -1)
        ];
        this.p = [151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180];
        this.perm = new Array(512); this.gradP = new Array(512);
        this.seed(seed);
    }
    seed(seed) {
        if(seed > 0 && seed < 1) seed *= 65536;
        seed = Math.floor(seed); if(seed < 256) seed |= seed << 8;
        for(let i = 0; i < 256; i++) {
            let v; if(i & 1) v = this.p[i] ^ (seed & 255); else v = this.p[i] ^ ((seed>>8) & 255);
            this.perm[i] = this.perm[i + 256] = v;
            this.gradP[i] = this.gradP[i + 256] = this.grad3[v % 12];
        }
    }
    fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    lerp(a, b, t) { return (1 - t) * a + t * b; }
    perlin2(x, y) {
        let X = Math.floor(x), Y = Math.floor(y);
        x -= X; y -= Y; X = X & 255; Y = Y & 255;
        const n00 = this.gradP[X + this.perm[Y]].dot2(x, y);
        const n01 = this.gradP[X + this.perm[Y + 1]].dot2(x, y - 1);
        const n10 = this.gradP[X + 1 + this.perm[Y]].dot2(x - 1, y);
        const n11 = this.gradP[X + 1 + this.perm[Y + 1]].dot2(x - 1, y - 1);
        const u = this.fade(x);
        return this.lerp(this.lerp(n00, n10, u), this.lerp(n01, n11, u), this.fade(y));
    }
}
class Grad {
    constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
    dot2(x, y) { return this.x * x + this.y * y; }
    dot3(x, y, z) { return this.x * x + this.y * y + this.z * z; }
}

class AWaves extends HTMLElement {
    connectedCallback() {
        this.svg = this.querySelector('.js-svg');
        this.mouse = { x: -10, y: 0, lx: 0, ly: 0, sx: 0, sy: 0, v: 0, vs: 0, a: 0, set: false, click: false };
        this.lines = []; this.paths = [];
        this.noise = new Noise(Math.random());
        this.setSize(); this.setLines(); this.bindEvents();
        requestAnimationFrame(this.tick.bind(this));
    }
    bindEvents() {
        window.addEventListener('resize', this.onResize.bind(this));   
        this.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.addEventListener('touchmove', this.onTouchMove.bind(this));
        
        this.addEventListener('mousedown', (e) => {
            this.mouse.click = true;
            this.updateMousePosition(e.clientX, e.clientY);
        });
        this.addEventListener('touchstart', (e) => {
            this.mouse.click = true;
            const touch = e.touches[0];
            this.updateMousePosition(touch.clientX, touch.clientY);
        });
        this.addEventListener('mouseup', () => this.mouse.click = false);
        this.addEventListener('touchend', () => this.mouse.click = false);
    }
    onResize() { this.setSize(); this.setLines(); }
    onMouseMove(e) { this.updateMousePosition(e.clientX, e.clientY); }
    onTouchMove(e) { const touch = e.touches[0]; this.updateMousePosition(touch.clientX, touch.clientY); }
    updateMousePosition(x, y) {
        const { mouse } = this;
        mouse.x = x - this.getBoundingClientRect().left;
        mouse.y = y - this.getBoundingClientRect().top;
        if (!mouse.set) { mouse.sx = mouse.x; mouse.sy = mouse.y; mouse.lx = mouse.x; mouse.ly = mouse.y; mouse.set = true; }
    }
    setSize() { this.bounding = this.getBoundingClientRect(); this.svg.style.width = `${this.bounding.width}px`; this.svg.style.height = `${this.bounding.height}px`; }
    setLines() {
        const { width, height } = this.bounding;   
        this.lines = []; this.paths.forEach((path) => path.remove()); this.paths = [];
        const xGap = 20; const yGap = 40;
        const oWidth = width + 200; const oHeight = height + 30;
        const totalLines = Math.ceil(oWidth / xGap); const totalPoints = Math.ceil(oHeight / yGap);
        const xStart = (width - xGap * totalLines) / 2; const yStart = (height - yGap * totalPoints) / 2;
        for (let i = 0; i <= totalLines; i++) {
            const points = [];
            for (let j = 0; j <= totalPoints; j++) {
                points.push({ x: xStart + xGap * i, y: yStart + yGap * j, wave: { x: 0, y: 0 }, cursor: { x: 0, y: 0, vx: 0, vy: 0 } });
            }
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.classList.add('a__line', 'js-line');
            this.svg.appendChild(path); this.paths.push(path); this.lines.push(points);
        }
    }
    movePoints(time) {
        const { lines, mouse, noise } = this;
        lines.forEach((points) => {
            points.forEach((p) => {
                const move = noise.perlin2((p.x + time * 0.0125) * 0.002, (p.y + time * 0.005) * 0.0015) * 12;
                p.wave.x = Math.cos(move) * 32;
                p.wave.y = Math.sin(move) * 16;
                const dx = p.x - mouse.sx; const dy = p.y - mouse.sy;
                const d = Math.hypot(dx, dy); const l = Math.max(175, mouse.vs);
                
                if (d < l) {
                    const s = 1 - d / l;
                    const f = Math.cos(d * 0.001) * s;
                    const force = mouse.click ? 3 : 1; 
                    p.cursor.vx += Math.cos(mouse.a) * f * l * mouse.vs * 0.00065 * force;
                    p.cursor.vy += Math.sin(mouse.a) * f * l * mouse.vs * 0.00065 * force;
                }
                p.cursor.vx += (0 - p.cursor.x) * 0.005;
                p.cursor.vy += (0 - p.cursor.y) * 0.005;
                p.cursor.vx *= 0.925; p.cursor.vy *= 0.925;
                p.cursor.x += p.cursor.vx * 2; p.cursor.y += p.cursor.vy * 2;
                p.cursor.x = Math.min(100, Math.max(-100, p.cursor.x));
                p.cursor.y = Math.min(100, Math.max(-100, p.cursor.y));
            });
        });
    }
    moved(point, withCursorForce = true) {
        const coords = {
            x: point.x + point.wave.x + (withCursorForce ? point.cursor.x : 0),
            y: point.y + point.wave.y + (withCursorForce ? point.cursor.y : 0),
        };
        coords.x = Math.round(coords.x * 10) / 10; coords.y = Math.round(coords.y * 10) / 10;
        return coords;
    }
    drawLines() {
        const { lines, moved, paths } = this;   
        lines.forEach((points, lIndex) => {
            let p1 = moved(points[0], false);
            let d = `M ${p1.x} ${p1.y}`;
            points.forEach((p1, pIndex) => {
                const isLast = pIndex === points.length - 1;
                p1 = moved(p1, !isLast);
                const p2 = moved(points[pIndex + 1] || points[points.length - 1], !isLast);
                d += `L ${p1.x} ${p1.y}`;
            });
            paths[lIndex].setAttribute('d', d);
        });
    }
    tick(time) {
        const { mouse } = this;
        mouse.sx += (mouse.x - mouse.sx) * 0.1; mouse.sy += (mouse.y - mouse.sy) * 0.1;
        const dx = mouse.x - mouse.lx; const dy = mouse.y - mouse.ly; const d = Math.hypot(dx, dy);
        mouse.v = d; mouse.vs += (d - mouse.vs) * 0.1; mouse.vs = Math.min(100, mouse.vs);
        mouse.lx = mouse.x; mouse.ly = mouse.y; mouse.a = Math.atan2(dy, dx);
        this.style.setProperty('--x', `${mouse.sx}px`); this.style.setProperty('--y', `${mouse.sy}px`);
        this.movePoints(time); this.drawLines();   
        requestAnimationFrame(this.tick.bind(this));
    }
}
customElements.define('a-waves', AWaves);