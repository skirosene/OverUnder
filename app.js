/**
 * OverUnder MVP - Codice Client (WebSocket Real-time)
 * Gestisce l'interfaccia di rete, la lobby, il timer a 60fps con sfumatura HSL e gli effetti sonori.
 */

// Inizializza Socket.io client con autoConnect disabilitato per evitare timeout prima dell'autenticazione
const socket = io({
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 30000,
  transports: ['polling', 'websocket']
});

// Definizione Ambiente Simulata per il frontend
const isDev = location.hostname === 'localhost' || 
              location.hostname === '127.0.0.1' || 
              location.hostname.startsWith('192.168.') || 
              location.hostname === '::1';

const process = {
  env: {
    NODE_ENV: isDev ? 'development' : 'production'
  }
};

// Helper per la gestione sicura del localStorage/sessionStorage su Safari iOS e In-App Browsers (WhatsApp/Telegram/Instagram)
const memoryStorage = {};
const safeStorage = {
  getItem(key) {
    try { return localStorage.getItem(key); } catch (e) { return memoryStorage[key] || null; }
  },
  setItem(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { memoryStorage[key] = String(value); }
  },
  removeItem(key) {
    try { localStorage.removeItem(key); } catch (e) { delete memoryStorage[key]; }
  }
};

const safeSessionStorage = {
  getItem(key) {
    try { return sessionStorage.getItem(key); } catch (e) { return memoryStorage['session_' + key] || null; }
  },
  setItem(key, value) {
    try { sessionStorage.setItem(key, value); } catch (e) { memoryStorage['session_' + key] = String(value); }
  },
  removeItem(key) {
    try { sessionStorage.removeItem(key); } catch (e) { delete memoryStorage['session_' + key]; }
  }
};

// ==========================================================================
// 1. IDENTITÀ PERSISTENTE & LOCALSTORAGE (Client-Side)
// ==========================================================================
let sessionId = safeStorage.getItem('overunder_sessionId');
if (!sessionId) {
  sessionId = 'sess_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
  safeStorage.setItem('overunder_sessionId', sessionId);
}

// Dispositivo Unico (UUID permanente) per l'accesso esclusivo (1 solo dispositivo attivo)
function getStoredDeviceId() {
  let devId = safeStorage.getItem('overunder_deviceId') || (typeof localStorage !== 'undefined' ? localStorage.getItem('overunder_deviceId') : null);
  if (!devId || typeof devId !== 'string' || devId.trim().length < 8) {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      devId = crypto.randomUUID();
    } else {
      devId = 'dev_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    }
    safeStorage.setItem('overunder_deviceId', devId);
    try { localStorage.setItem('overunder_deviceId', devId); } catch (e) {}
  }
  return devId;
}

let deviceId = getStoredDeviceId();

// Helper parsing JWT token
function parseJwtPayload(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
}

// Recupera token salvato da safeStorage / localStorage / sessionStorage con validazione di scadenza
function getStoredAuthToken() {
  const token = safeStorage.getItem('overunder_token') || 
                safeSessionStorage.getItem('overunder_token') || 
                (typeof localStorage !== 'undefined' ? localStorage.getItem('overunder_token') : null) || 
                (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('overunder_token') : null) || 
                null;
  if (!token) return null;
  const decoded = parseJwtPayload(token);
  if (decoded && decoded.exp && (decoded.exp * 1000) < Date.now()) {
    console.warn('[AUTH] Token memorizzato scaduto.');
    return null;
  }
  return token;
}

// Salva stabilmente il token di autenticazione e i flag premium nel localStorage
function setStoredAuthToken(token, isPremium = null) {
  if (!token) return;
  safeStorage.setItem('overunder_token', token);
  safeSessionStorage.setItem('overunder_token', token);
  try { localStorage.setItem('overunder_token', token); } catch (e) {}
  try { sessionStorage.setItem('overunder_token', token); } catch (e) {}
  state.authenticatedToken = token;

  const decoded = parseJwtPayload(token);
  const premiumStatus = (isPremium === true) || (decoded && (decoded.isPremium || decoded.premiumStatus === 'PREMIUM_A_VITA'));

  if (premiumStatus) {
    safeStorage.setItem('overunder_premium_unlocked', 'true');
    safeStorage.setItem('overunder_judgement_purchased', 'true');
    try { localStorage.setItem('overunder_premium_unlocked', 'true'); } catch (e) {}
    try { localStorage.setItem('overunder_judgement_purchased', 'true'); } catch (e) {}
  }
}

// Genera o recupera un playerId univoco e persistente per il browser del giocatore
let playerId = safeStorage.getItem('overunder_playerId');
if (!playerId) {
  playerId = 'player_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now().toString(36);
  safeStorage.setItem('overunder_playerId', playerId);
}

// Salva la sessione di gioco attiva in localStorage per la riconnessione automatica
function saveRoomSession(roomCode, playerName, isHost, avatar) {
  const sessionData = {
    roomCode: (roomCode || '').toUpperCase().trim(),
    playerId,
    playerName,
    isHost: !!isHost,
    avatar: avatar || null,
    timestamp: Date.now()
  };
  safeStorage.setItem('overunder_saved_session', JSON.stringify(sessionData));
  safeSessionStorage.setItem('overunder_roomCode', roomCode);
  safeSessionStorage.setItem('overunder_playerName', playerName);
  safeSessionStorage.setItem('overunder_isHost', isHost ? 'true' : 'false');
}

function clearRoomSession() {
  safeStorage.removeItem('overunder_saved_session');
  safeSessionStorage.removeItem('overunder_roomCode');
  safeSessionStorage.removeItem('overunder_playerName');
  safeSessionStorage.removeItem('overunder_isHost');
}

// Pulisce ESCLUSIVAMENTE i dati della stanza corrente, PRESERVANDO l'autenticazione del dispositivo
function clearSession() {
  clearRoomSession();
  clearWatchdog();
  safeSessionStorage.removeItem('overunder_pendingRoom');
  try { localStorage.removeItem('overunder_pendingRoom'); } catch (e) {}
  state.roomCode = '';
  state.isHost = false;
  state.players = [];
  state.gameplayStarted = false;
  state.roomIsLocked = false;
  state.roomIsPremium = false;
  state.customCards = [];
  state.userHasVoted = false;
  state.votes = {};
  state.currentCardIndex = 0;
  // NOTA BENE: overunder_token, overunder_deviceId e lo stato premium rimangono intatti nel localStorage!
}

function resetToMenu() {
  clearWatchdog();
  state.soloCardIndex = 0;
  state.soloResponses = [];
  state.userHasVoted = false;
  state.soloStreakType = null;
  state.soloStreakCount = 0;
  state.currentCardIndex = 0;
  hideSoloPersonalityPopup();
  if (state.timerRequestId) {
    cancelAnimationFrame(state.timerRequestId);
    state.timerRequestId = null;
  }
  stopTimerLoop();
  if (el.screenGameplay) {
    el.screenGameplay.classList.remove('is-solo-mode');
  }
  const endScreen = document.getElementById('single-player-end-screen');
  if (endScreen) {
    endScreen.style.display = 'none';
  }
  clearSession();
  state.gameEnded = false;
  showScreen(el.screenWelcome);
  try { updatePremiumUI(); } catch (e) {}
}

function getSavedRoomSession() {
  try {
    const raw = safeStorage.getItem('overunder_saved_session');
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !data.roomCode || !data.playerId) return null;
    // La sessione salvata scade dopo 12 ore di inattività
    if (Date.now() - data.timestamp > 12 * 60 * 60 * 1000) {
      clearRoomSession();
      return null;
    }
    return data;
  } catch (e) {
    return null;
  }
}

// ==========================================================================
// SERVIZI DI AUTENTICAZIONE (JWT)
// ==========================================================================
async function authenticateHost(hostName) {
  const currentDevId = getStoredDeviceId();
  const existingToken = getStoredAuthToken();
  const headers = { 'Content-Type': 'application/json' };
  if (existingToken) {
    headers['Authorization'] = 'Bearer ' + existingToken;
  }

  const logRes = await fetch('/api/auth/host', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      username: hostName,
      deviceId: currentDevId,
      deviceUuid: currentDevId,
      sessionId,
      fingerprint: getDeviceFingerprint()
    })
  });

  if (!logRes.ok) {
    const errorData = await logRes.json().catch(() => ({}));
    throw new Error(errorData.error || "Login host fallito");
  }

  const data = await logRes.json();
  if (data.token) {
    setStoredAuthToken(data.token, data.isPremium);
  }
  if (data.deviceId) {
    deviceId = data.deviceId;
    safeStorage.setItem('overunder_deviceId', deviceId);
  }
  return data.token;
}

async function authenticateGuest(roomCode, playerName) {
  const devId = getStoredDeviceId();
  const logRes = await fetch('/api/auth/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomCode, playerName, sessionId, deviceId: devId, deviceUuid: devId })
  });

  if (!logRes.ok) {
    const errorData = await logRes.json().catch(() => ({}));
    throw new Error(errorData.error || "Login guest fallito");
  }

  const data = await logRes.json();
  if (data.deviceId) {
    safeStorage.setItem('overunder_deviceId', data.deviceId);
  }
  return data.token;
}

// ==========================================================================
// SINTETIZZATORE AUDIO (Web Audio API)
// ==========================================================================
const AudioSynth = {
  ctx: null,
  isMuted: localStorage.getItem('overunder_muted') === 'true',
  _unlocked: false,
  _victoryBuffer: null,

  init() {
    // Crea sempre l'AudioContext anche se l'utente è in mute.
    // Il mute viene gestito esclusivamente nelle funzioni play*.
    // Questo garantisce che iOS/Safari non blocchi l'audio al primo tap.
    try {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
      if (this.ctx) {
        if (this.ctx.state === 'suspended') {
          this.ctx.resume().catch(() => {});
        }
        if (this.ctx.state === 'running') {
          this._unlocked = true;
        }
        // Pre-carica e sintetizza il buffer di vittoria in memoria in background (ZERO LATENZA)
        if (!this._victoryBuffer) {
          this._buildVictoryBuffer(this.ctx);
        }
      }
    } catch (e) {
      console.warn("AudioSynth init error:", e);
    }
  },

  playTick(frequency = 800) {
    this.init();
    if (this.isMuted || !this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(frequency, this.ctx.currentTime);
      
      gain.gain.setValueAtTime(0.04, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.08);
      
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      
      osc.start();
      osc.stop(this.ctx.currentTime + 0.08);
    } catch (e) {
      console.warn("Audio error:", e);
    }
  },

  playConfirm(isUnder = true) {
    this.init();
    if (this.isMuted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const notes = isUnder ? [523.25, 659.25] : [523.25, 392.00];
      
      notes.forEach((freq, index) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + (index * 0.07));
        
        gain.gain.setValueAtTime(0.08, now + (index * 0.07));
        gain.gain.exponentialRampToValueAtTime(0.001, now + (index * 0.07) + 0.18);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.start(now + (index * 0.07));
        osc.stop(now + (index * 0.07) + 0.18);
      });
    } catch (e) {
      console.warn("Audio error:", e);
    }
  },

  playTimeout() {
    this.init();
    if (this.isMuted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(100, now);
      osc.frequency.linearRampToValueAtTime(70, now + 0.55);
      
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
      
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      
      osc.start();
      osc.stop(now + 0.55);
    } catch (e) {
      console.warn("Audio error:", e);
    }
  },

  playGong() {
    if (this.isMuted || !this.ctx) return;
    try {
      this.init();
      const now = this.ctx.currentTime;
      
      // 1. FILTRO BIQUAD (Low-Pass Risonante con inviluppo)
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.setValueAtTime(2.0, now); // Leggera risonanza sulla frequenza di taglio
      
      // Inviluppo del filtro: attacco morbido per far emergere lo shimmer (220ms), poi decadimento lungo
      filter.frequency.setValueAtTime(160, now); // Parte cupo all'impatto
      filter.frequency.exponentialRampToValueAtTime(2200, now + 0.22); // Si apre mostrando lo shimmer metallico
      filter.frequency.exponentialRampToValueAtTime(75, now + 9.5); // Si chiude lentamente lasciando solo i bassi
      
      // 2. MASTER GAIN (Previene distorsioni e clipping digitali)
      const masterGain = this.ctx.createGain();
      masterGain.gain.setValueAtTime(0.42, now);
      masterGain.connect(filter);
      
      // 3. EFFETTO SPAZIALE / RIVERBERO (Feedback Delay Network)
      const delay = this.ctx.createDelay(1.0);
      const delayGain = this.ctx.createGain();
      const feedback = this.ctx.createGain();
      
      delay.delayTime.setValueAtTime(0.22, now); // Delay di 220ms per spazialità cattedrale
      feedback.gain.setValueAtTime(0.42, now);   // Coda di feedback prolungata
      delayGain.gain.setValueAtTime(0.18, now);  // Mix wet al 18%
      
      filter.connect(this.ctx.destination);      // Uscita Dry diretta
      
      filter.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(delayGain);
      delayGain.connect(this.ctx.destination);   // Uscita Wet
      
      // 4. LFO (Low-Frequency Oscillator) per l'effetto Shimmer/Wobble vibrante sui parziali alti
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      lfo.frequency.setValueAtTime(5.8, now);    // Frequenza LFO rapida (5.8 Hz)
      lfoGain.gain.setValueAtTime(7.0, now);     // Modulazione di frequenza di +/- 7Hz
      lfo.connect(lfoGain);
      lfo.start(now);
      lfo.stop(now + 10.0);
      
      // 5. PARZIALI INARMONICI DEL GONG (Sintesi Additiva Disarmonica)
      // Fondamentale a 55Hz (G1) per un calore tellurico e ronzio pesante
      const fundamental = 55.0;
      const partials = [
        // Frequenze basse e armoniche (Corpo e profondità)
        { freq: fundamental,       vol: 0.50, decay: 10.0, hasLfo: false }, // Fondamentale 1 (G1)
        { freq: fundamental + 0.6, vol: 0.45, decay: 10.0, hasLfo: false }, // Detunata per wah-wah naturale
        { freq: fundamental * 2.0, vol: 0.35, decay: 8.5,  hasLfo: false }, // Ottava (G2)
        { freq: fundamental * 3.0, vol: 0.28, decay: 7.5,  hasLfo: false }, // Quinta (D3)
        
        // Parziali inarmonici (Shimmer metallico denso)
        { freq: fundamental * 2.57,  vol: 0.20, decay: 6.5, hasLfo: true },
        { freq: fundamental * 3.14,  vol: 0.18, decay: 6.0, hasLfo: true },  // Moltiplicatore Pi Greco
        { freq: fundamental * 4.87,  vol: 0.15, decay: 5.5, hasLfo: true },
        { freq: fundamental * 6.09,  vol: 0.12, decay: 5.0, hasLfo: true },
        { freq: fundamental * 8.43,  vol: 0.10, decay: 4.2, hasLfo: true },
        { freq: fundamental * 11.21, vol: 0.08, decay: 3.5, hasLfo: true },
        { freq: fundamental * 15.37, vol: 0.06, decay: 3.0, hasLfo: true },
        { freq: fundamental * 19.83, vol: 0.05, decay: 2.5, hasLfo: true },
        { freq: fundamental * 24.11, vol: 0.04, decay: 2.2, hasLfo: true },
        { freq: fundamental * 31.41, vol: 0.03, decay: 1.8, hasLfo: true },
        { freq: fundamental * 42.17, vol: 0.02, decay: 1.5, hasLfo: true },
        { freq: fundamental * 53.89, vol: 0.015, decay: 1.2, hasLfo: true }
      ];
      
      partials.forEach(p => {
        const osc = this.ctx.createOscillator();
        const gainNode = this.ctx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(p.freq, now);
        
        if (p.hasLfo) {
          lfoGain.connect(osc.frequency);
        }
        
        // Attacco smussato di 20ms (battente in feltro) e decadimento esponenziale differenziato
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(p.vol, now + 0.020);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + p.decay);
        
        osc.connect(gainNode);
        gainNode.connect(masterGain);
        
        osc.start(now);
        osc.stop(now + p.decay);
      });
      
      // 6. IMPATTO TRANSITORIO (Thump morbido a bassa frequenza del battente)
      const thump = this.ctx.createOscillator();
      const thumpGain = this.ctx.createGain();
      
      thump.type = 'triangle';
      thump.frequency.setValueAtTime(62.0, now); // Tono sordo e grave
      
      thumpGain.gain.setValueAtTime(0, now);
      thumpGain.gain.linearRampToValueAtTime(0.60, now + 0.012); // Attacco feltro morbido
      thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.180); // Decadimento rapidissimo
      
      thump.connect(thumpGain);
      thumpGain.connect(filter);
      
      thump.start(now);
      thump.stop(now + 0.20);
      
    } catch (e) {
      console.warn("Audio error:", e);
    }
  },

  // 7. PRE-LOADING / MEMORY BUFFER AUDIO DI VITTORIA (Web Audio API a Zero Latenza)
  _buildVictoryBuffer(ctx) {
    if (!ctx) return;
    try {
      const sampleRate = ctx.sampleRate || 44100;
      const duration = 2.4;
      const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OfflineCtx) return;

      const offline = new OfflineCtx(2, Math.floor(sampleRate * duration), sampleRate);

      // Master Gain
      const master = offline.createGain();
      master.gain.setValueAtTime(0.55, 0);
      master.connect(offline.destination);

      // Riverbero / Echo spaziale celebrativo a 120ms
      const delay = offline.createDelay();
      delay.delayTime.setValueAtTime(0.12, 0);
      const delayGain = offline.createGain();
      delayGain.gain.setValueAtTime(0.25, 0);
      master.connect(delay);
      delay.connect(delayGain);
      delayGain.connect(offline.destination);

      // Sequenza Fanfara Trionfale (C5 -> E5 -> G5 -> C6 -> E6)
      const sequence = [
        { freq: 523.25, time: 0.00, dur: 0.14, type: 'triangle', vol: 0.40 }, // C5
        { freq: 659.25, time: 0.12, dur: 0.14, type: 'triangle', vol: 0.45 }, // E5
        { freq: 783.99, time: 0.24, dur: 0.16, type: 'triangle', vol: 0.50 }, // G5
        { freq: 1046.50, time: 0.38, dur: 0.55, type: 'sine', vol: 0.60 },    // C6
        { freq: 1318.51, time: 0.55, dur: 1.60, type: 'sine', vol: 0.55 }     // E6
      ];

      sequence.forEach(note => {
        const osc = offline.createOscillator();
        const gain = offline.createGain();
        osc.type = note.type;
        osc.frequency.setValueAtTime(note.freq, note.time);

        gain.gain.setValueAtTime(0, note.time);
        gain.gain.linearRampToValueAtTime(note.vol, note.time + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, note.time + note.dur);

        osc.connect(gain);
        gain.connect(master);
        osc.start(note.time);
        osc.stop(note.time + note.dur);
      });

      // Accordo Trionfale Finale Splendente (C-Major Brillante con Armoniche)
      const finalChordTime = 0.55;
      const finalChord = [
        { freq: 261.63, vol: 0.45, dur: 1.8, type: 'triangle' }, // C4
        { freq: 523.25, vol: 0.35, dur: 1.8, type: 'sine' },     // C5
        { freq: 659.25, vol: 0.35, dur: 1.8, type: 'sine' },     // E5
        { freq: 783.99, vol: 0.35, dur: 1.8, type: 'sine' },     // G5
        { freq: 1046.50, vol: 0.40, dur: 1.8, type: 'sine' },    // C6
        { freq: 1567.98, vol: 0.25, dur: 1.6, type: 'sine' },    // G6 (scintille)
        { freq: 2093.00, vol: 0.18, dur: 1.2, type: 'sine' }     // C7 (cristallino)
      ];

      finalChord.forEach(chordNote => {
        const osc = offline.createOscillator();
        const gain = offline.createGain();
        osc.type = chordNote.type;
        osc.frequency.setValueAtTime(chordNote.freq, finalChordTime);

        gain.gain.setValueAtTime(0, finalChordTime);
        gain.gain.linearRampToValueAtTime(chordNote.vol, finalChordTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, finalChordTime + chordNote.dur);

        osc.connect(gain);
        gain.connect(master);
        osc.start(finalChordTime);
        osc.stop(finalChordTime + chordNote.dur);
      });

      // Campane/Sparkles ascendenti celebrativi
      const chimes = [1046.5, 1174.66, 1318.51, 1567.98, 1760.0, 2093.0];
      chimes.forEach((freq, idx) => {
        const osc = offline.createOscillator();
        const gain = offline.createGain();
        const t = 0.65 + (idx * 0.06);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);

        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.15, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);

        osc.connect(gain);
        gain.connect(master);
        osc.start(t);
        osc.stop(t + 0.5);
      });

      offline.startRendering().then(renderedBuffer => {
        this._victoryBuffer = renderedBuffer;
      }).catch(err => {
        console.warn("Victory buffer render fallback:", err);
      });
    } catch (e) {
      console.warn("Build victory buffer error:", e);
    }
  },

  _playVictoryRealtime() {
    if (this.isMuted || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const notes = [
        { freq: 523.25, time: 0.00, dur: 0.14 },
        { freq: 659.25, time: 0.12, dur: 0.14 },
        { freq: 783.99, time: 0.24, dur: 0.16 },
        { freq: 1046.50, time: 0.38, dur: 0.8 },
        { freq: 1318.51, time: 0.55, dur: 1.2 }
      ];
      notes.forEach(n => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(n.freq, now + n.time);
        gain.gain.setValueAtTime(0.08, now + n.time);
        gain.gain.exponentialRampToValueAtTime(0.001, now + n.time + n.dur);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now + n.time);
        osc.stop(now + n.time + n.dur);
      });
    } catch (e) {
      console.warn("Realtime victory synth error:", e);
    }
  },

  playVictory() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    try {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }

      if (this._victoryBuffer) {
        // Riproduzione sincrona a ZERO LATENZA del buffer pre-decodificato
        const source = this.ctx.createBufferSource();
        source.buffer = this._victoryBuffer;

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.75, this.ctx.currentTime);
        source.connect(gain);
        gain.connect(this.ctx.destination);

        source.start(0);
      } else {
        this._playVictoryRealtime();
      }
    } catch (e) {
      console.warn("playVictory error:", e);
    }
  }
};

// Sblocco automatico di AudioContext al primissimo tocco dell'utente (iOS / Android / Safari Autoplay Policy)
// Utilizza { once: false } perché iOS potrebbe richiedere più tentativi per sbloccare.
function _unlockAudioContext() {
  try {
    AudioSynth.init();
    if (AudioSynth.ctx && AudioSynth.ctx.state === 'suspended') {
      AudioSynth.ctx.resume().then(() => {
        AudioSynth._unlocked = true;
        console.log('[AUDIO] AudioContext sbloccato con successo.');
      }).catch(() => {});
    } else if (AudioSynth.ctx && AudioSynth.ctx.state === 'running') {
      AudioSynth._unlocked = true;
    }
  } catch (e) {}
}
['pointerdown', 'touchstart', 'click', 'keydown'].forEach(evtType => {
  window.addEventListener(evtType, _unlockAudioContext, { passive: true });
});

// Funzione Trigger Globale per Suono di Vittoria (Zero Latenza e Single-Play per sessione)
function triggerVictorySoundOnce() {
  if (state._victorySoundPlayed) return;
  state._victorySoundPlayed = true;
  try {
    AudioSynth.playVictory();
  } catch (e) {
    console.warn("[AUDIO TRIGGER] Victory sound error:", e);
  }
}

// ==========================================================================
// CONFIGURAZIONE STATO & ELEMENTI DOM
// ==========================================================================
const state = {
  isHost: false,
  isSoloMode: false,
  roomCode: '',
  playerName: '',
  players: [],             // Elenco oggetti player: { id, name, isHost }
  _victorySoundPlayed: false,
  
  // Timer e carte
  currentDeckName: '',
  totalCards: 0,
  userHasVoted: false,
  roundEndActive: false,
  
  timerStartTime: null,
  timerRequestId: null,
  timerDurationMs: 10000,
  lastTickElapsed: 0,
  timerPaused: false,
  pausedElapsed: 0,

  // Solo mode data
  soloDeck: null,
  soloCardIndex: 0,
  soloResponses: [],
  soloStreakType: null,
  soloStreakCount: 0,
  soloPersonalityTimer: null,
  pendingLengthStartMode: null,
  soloTimeoutId: null,
  isWorldStatsVisible: false,
  gameLength: 30,
  pendingRoomToJoin: null,

  isExitModalOpen: false,
  roomIsPremium: false,
  hasSubmittedPremiumCards: false,
  localPremiumCards: [],
  selectedCardIndex: null,
  currentCroppedImage: null, // Base64 image
  isInfoOpen: false,
  trialActivated: false,
  trialShown: false,
  isInputHelpOpen: false,
  currentRoundId: 0,
  playerAvatarUrl: null,
  cropperTarget: null, // 'avatar' | 'card'
  isPlayerListOpen: false,
  roomIsLocked: false,
  gameplayStarted: false,
  playerToKick: null,
  connectionLoadingActive: false,
  connectionTimeout: null,
  connectionStartTime: null,
  toastTimeout: null,
  currentRoundResultsVotes: [],
  activeResultsFilter: 'all',
  activeOverlayFilter: 'all',
  socketAuthenticated: false,
  authenticatedToken: null,
  pendingSocketAction: null,
  gameEnded: false
};

// ==========================================================================
// WATCHDOG TIMER (Auto-Avanzamento di Sicurezza & Anti-Deadlock Multiplayer)
// ==========================================================================
let watchdogTimer = null;
let watchdogTargetCardIndex = null;

function checkAndArmWatchdog(reason = '') {
  if (state.isSoloMode) return;
  if (!el.screenGameplay || !el.screenGameplay.classList.contains('active')) return;

  const activePlayers = (state.players || []).filter(p => p.connected !== false && p.isOnline !== false);
  const votedBadges = el.gameplayPlayersStatus ? el.gameplayPlayersStatus.querySelectorAll('.player-status-badge.has-voted') : [];
  const allVotedUI = activePlayers.length > 0 && votedBadges.length >= activePlayers.length;

  const elapsed = Date.now() - (state.timerStartTime || Date.now());
  const isZeroTimer = elapsed >= state.timerDurationMs || (el.timerCounter && (el.timerCounter.textContent === '0.0s' || el.timerCounter.textContent === '0s'));

  if (allVotedUI || isZeroTimer || reason === 'all_voted' || reason === 'time_up') {
    if (watchdogTimer && watchdogTargetCardIndex === state.currentCardIndex) {
      return;
    }

    clearWatchdog();
    watchdogTargetCardIndex = state.currentCardIndex;

    watchdogTimer = setTimeout(() => {
      if (state.currentCardIndex === watchdogTargetCardIndex &&
          el.screenGameplay && el.screenGameplay.classList.contains('active')) {
        console.log("Watchdog: forzato avanzamento carta per evitare freeze");
        if (socket && socket.connected) {
          socket.emit('next_card');
          socket.emit('nextCard');
          socket.emit('advanceTurn');
        }
      }
      watchdogTimer = null;
    }, 4000);
  }
}

function clearWatchdog() {
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
  watchdogTargetCardIndex = null;
}

let activeCropper = null;
let openInAppCamera = null;

function initCropper(imageElement) {
  if (activeCropper) {
    activeCropper.destroy();
    activeCropper = null;
  }

  activeCropper = new Cropper(imageElement, {
    aspectRatio: 1,
    viewMode: 1, // Vincolo di copertura: l'immagine non può mai diventare più piccola del riquadro 1:1 (nessun bordo vuoto o nero)
    dragMode: 'move', // Trascina per centrare e riposizionare l'immagine
    autoCropArea: 1,
    restore: false,
    guides: true,
    center: true,
    highlight: false,
    cropBoxMovable: false,
    cropBoxResizable: false,
    toggleDragModeOnDblclick: false,
    zoomable: true,
    zoomOnTouch: true,
    zoomOnWheel: true,
    wheelZoomRatio: 0.1
  });

  return activeCropper;
}

// Elementi DOM
const el = {
  // Schermate
  screenSplash: document.getElementById('screen-splash'),
  screenWelcome: document.getElementById('screen-welcome'),
  screenOnboarding: document.getElementById('screen-onboarding'),
  screenLobby: document.getElementById('screen-lobby'),
  screenGameplay: document.getElementById('screen-gameplay'),
  screenResults: document.getElementById('screen-results'),
  screenSummary: document.getElementById('screen-summary'),
  btnWelcomeStart: document.getElementById('btn-welcome-start'),
  btnBackOnboarding: document.getElementById('btn-back-onboarding'),
  btnBackLobby: document.getElementById('btn-back-lobby'),
  
  // Onboarding
  tabSolo: document.getElementById('tab-solo'),
  tabCreate: document.getElementById('tab-create'),
  formSoloPlay: document.getElementById('form-solo-play'),
  formCreateRoom: document.getElementById('form-create-room'),
  formJoinRoomLink: document.getElementById('form-join-room-link'),
  soloNameInput: document.getElementById('solo-name-input'),
  hostNameInput: document.getElementById('host-name-input'),
  createRoomCodeInput: document.getElementById('create-room-code-input'),
  joinNameInput: document.getElementById('join-name-input'),
  btnSoloPlay: document.getElementById('btn-solo-play'),
  btnCreateRoom: document.getElementById('btn-create-room'),
  btnJoinRoomLink: document.getElementById('btn-join-room-link'),
  btnCancelJoinLink: document.getElementById('btn-cancel-join-link'),
  joinRoomCodeDisplay: document.getElementById('join-room-code-display'),
  btnInfoGogna: document.getElementById('btn-info-gogna'),
  infoGognaModal: document.getElementById('info-gogna-modal'),
  btnInfoGognaClose: document.getElementById('btn-info-gogna-close'),
  judgementDayCard: document.getElementById('judgement-day-card'),
  createPremiumToggle: document.getElementById('create-premium-toggle'),
  paywallStandardModal: document.getElementById('paywall-standard-modal'),
  btnPaywallStandardBuy: document.getElementById('btn-paywall-standard-buy'),
  btnPaywallStandardClose: document.getElementById('btn-paywall-standard-close'),
  btnOpenRestoreModal: document.getElementById('btn-open-restore-modal'),
  restorePurchaseModal: document.getElementById('restore-purchase-modal'),
  restoreEmailInput: document.getElementById('restore-email-input'),
  btnSubmitRestore: document.getElementById('btn-submit-restore'),
  btnRestoreClose: document.getElementById('btn-restore-close'),
  modeTabs: document.querySelector('.mode-tabs'),
  nameErrorMsg: document.getElementById('name-error-msg'),
  
  // Lobby
  lobbyRoomCode: document.getElementById('lobby-room-code'),
  btnLobbyInvite: document.getElementById('btn-lobby-invite'),
  btnLobbyQr: document.getElementById('btn-lobby-qr'),
  qrModal: document.getElementById('qr-modal'),
  btnQrModalClose: document.getElementById('btn-qr-modal-close'),
  qrCodeImg: document.getElementById('qr-code-img'),
  qrModalRoomCode: document.getElementById('qr-modal-room-code'),
  btnLockRoom: document.getElementById('btn-lock-room'),
  lockRoomModal: document.getElementById('lock-room-modal'),
  lockModalTitle: document.getElementById('lock-modal-title'),
  lockModalDesc: document.getElementById('lock-modal-desc'),
  btnLockConfirm: document.getElementById('btn-lock-confirm'),
  btnLockCancel: document.getElementById('btn-lock-cancel'),
  lobbyPlayersCount: document.getElementById('lobby-players-count'),
  lobbyPlayersList: document.getElementById('lobby-players-list'),
  lobbyHostControls: document.getElementById('lobby-host-controls'),
  deckList: document.getElementById('deck-list'),
  btnHostStartGame: document.getElementById('btn-host-start-game'),
  lobbyPlayerWaiting: document.getElementById('lobby-player-waiting'),
  
  // Gameplay
  timerBar: document.getElementById('timer-bar'),
  timerCounter: document.getElementById('timer-counter'),
  deckProgress: document.getElementById('deck-progress'),
  currentDeckName: document.getElementById('current-deck-name'),
  currentPromptText: document.getElementById('current-prompt-text'),
  gameplayPlayersStatus: document.getElementById('gameplay-players-status'),
  btnUnderrated: document.getElementById('btn-underrated'),
  btnOverrated: document.getElementById('btn-overrated'),
  // Risultati
  // Risultati (Barre Bipolari Confluenti)
  resultsPromptSubject: document.getElementById('results-prompt-subject'),
  groupUnderPctText: document.getElementById('group-under-pct-text'),
  groupOverPctText: document.getElementById('group-over-pct-text'),
  groupUnderFill: document.getElementById('group-under-fill'),
  groupOverFill: document.getElementById('group-over-fill'),
  globalUnderPctText: document.getElementById('global-under-pct-text'),
  globalOverPctText: document.getElementById('global-over-pct-text'),
  globalUnderFill: document.getElementById('global-under-fill'),
  globalOverFill: document.getElementById('global-over-fill'),
  btnNextCardConfluent: document.getElementById('btn-next-card-confluent'),
  resultsPlayerWaitingConfluent: document.getElementById('results-player-waiting-confluent'),
  resultsVotesDetailCard: document.getElementById('results-votes-detail-card'),
  resultsVotesList: document.getElementById('results-votes-list'),
  globalStatsCard: document.getElementById('global-stats-card'),
  btnToggleWorldStats: document.getElementById('btn-toggle-world-stats'),
  worldToggleBridge: document.getElementById('world-toggle-bridge'),
  
  // Riepilogo & Premi
  groupAwardsContainer: document.getElementById('group-awards-container'),
  summaryCardsList: document.getElementById('summary-cards-list'),
  summaryHostControls: document.getElementById('summary-host-controls'),
  summaryPlayerWaiting: document.getElementById('summary-player-waiting'),
  btnRestart: document.getElementById('btn-restart'),
  btnReportCard: document.getElementById('btn-report-card'),
  btnCardInfo: document.getElementById('btn-card-info'),
  cardInfoModal: document.getElementById('card-info-modal'),
  cardInfoModalTitle: document.getElementById('card-info-modal-title'),
  cardInfoModalText: document.getElementById('card-info-modal-text'),
  btnCardInfoClose: document.getElementById('btn-card-info-close'),
  
  // Orologio barra di stato
  statusClock: document.getElementById('status-clock'),

  // Nuovi elementi per l'overlay di fine round e bot
  roundEndOverlay: document.getElementById('round-end-overlay'),
  roundEndVotesList: document.getElementById('round-end-votes-list'),
  btnNextOverlay: document.getElementById('btn-next-overlay'),
  roundEndPlayerWait: document.getElementById('round-end-player-wait'),
  btnAddBots: document.getElementById('btn-add-bots'),
  roundEndOverlayVoteActions: document.getElementById('round-end-overlay-vote-actions'),
  btnNextUnder: document.getElementById('btn-next-under'),
  btnNextOver: document.getElementById('btn-next-over'),
  roundEndStatsSummary: document.getElementById('round-end-stats-summary'),
  roundEndGroupPct: document.getElementById('round-end-group-pct'),
  roundEndGlobalPct: document.getElementById('round-end-global-pct'),

  // Lobby Header / Panels (for hiding in Solo)
  lobbyHeader: document.getElementById('lobby-header'),
  lobbyPlayersPanel: document.getElementById('lobby-players-panel'),
  gameplayStatusPanel: document.getElementById('gameplay-status-panel'),
  roundsSelectorGrid: document.getElementById('rounds-selector-grid'),

  // Navigation buttons
  btnBackLobby: document.getElementById('btn-back-lobby'),
  btnBackOnboarding: document.getElementById('btn-back-onboarding'),
  btnQuitGameplay: document.getElementById('btn-quit-gameplay'),
  btnQuitResults: document.getElementById('btn-quit-results'),
  btnToggleAudio: document.getElementById('btn-toggle-audio'),

  // Custom Exit Modal elements
  exitModal: document.getElementById('exit-modal'),
  exitModalDesc: document.getElementById('exit-modal-desc'),
  btnExitCancel: document.getElementById('btn-exit-cancel'),
  btnExitConfirm: document.getElementById('btn-exit-confirm'),
  createPremiumToggle: document.getElementById('create-premium-toggle'),
  lobbyPremiumCreator: document.getElementById('lobby-premium-creator'),
  lobbyPremiumWaiting: document.getElementById('lobby-premium-waiting'),
  premiumCardInput: document.getElementById('premium-card-input'),
  btnPremiumCardAdd: document.getElementById('btn-premium-card-add'),
  premiumCardsList: document.getElementById('premium-cards-list'),
  btnPremiumCardsSubmit: document.getElementById('btn-premium-cards-submit'),
  
  // Custom Premium Image elements
  premiumImageUpload: document.getElementById('premium-image-upload'),
  lblPremiumImageUpload: document.getElementById('lbl-premium-image-upload'),
  btnTriggerPremiumPhoto: document.getElementById('btn-trigger-premium-photo'),
  premiumPhotoPopover: document.getElementById('premium-photo-popover'),
  btnPremiumSelectCamera: document.getElementById('btn-premium-select-camera'),
  btnPremiumSelectUpload: document.getElementById('btn-premium-select-upload'),
  btnPremiumSelectWeb: document.getElementById('btn-premium-select-web'),
  webImageSearchModal: document.getElementById('web-image-search-modal'),
  btnCloseWebSearchModal: document.getElementById('btn-close-web-search-modal'),
  inputWebImageSearch: document.getElementById('input-web-image-search'),
  btnClearWebImageSearch: document.getElementById('btn-clear-web-image-search'),
  btnSubmitWebImageSearch: document.getElementById('btn-submit-web-image-search'),
  webSearchLoading: document.getElementById('web-search-loading'),
  webSearchImporting: document.getElementById('web-search-importing'),
  webSearchPlaceholder: document.getElementById('web-search-placeholder'),
  webSearchNoResults: document.getElementById('web-search-no-results'),
  webSearchResultsGrid: document.getElementById('web-search-results-grid'),
  inputPremiumCamera: document.getElementById('input-premium-camera'),
  premiumImagePreviewContainer: document.getElementById('premium-image-preview-container'),
  premiumImagePreview: document.getElementById('premium-image-preview'),
  btnClearImage: document.getElementById('btn-clear-image'),
  cropperModal: document.getElementById('cropper-modal'),
  cropperImageTarget: document.getElementById('cropper-image-target'),
  btnCropperCancel: document.getElementById('btn-cropper-cancel'),
  btnCropperConfirm: document.getElementById('btn-cropper-confirm'),
  btnCropperZoomIn: document.getElementById('btn-cropper-zoom-in'),
  btnCropperZoomOut: document.getElementById('btn-cropper-zoom-out'),
  infoGognaModal: document.getElementById('info-gogna-modal'),
  inputHelpModal: document.getElementById('input-help-modal'),
  
  // Card Actions Drawer Modal
  cardActionsDrawer: document.getElementById('card-actions-drawer'),
  btnEditCard: document.getElementById('btn-edit-card'),
  btnDeleteCard: document.getElementById('btn-delete-card'),
  drawerCloseBtn: document.querySelector('.drawer-close-btn'),
  drawerCardTitle: document.getElementById('drawer-card-title'),
  
  // Gameplay Prompt Image elements
  promptCard: document.getElementById('prompt-card'),
  gameplayPromptImageContainer: document.getElementById('gameplay-prompt-image-container'),
  gameplayPromptImage: document.getElementById('gameplay-prompt-image'),
  
  // Results Screen Image elements
  resultsPromptImageContainer: document.getElementById('results-prompt-image-container'),
  resultsPromptImage: document.getElementById('results-prompt-image'),
  
  // Card Image Zoom elements
  cardImageZoomModal: document.getElementById('card-image-zoom-modal'),
  cardImageZoomImage: document.getElementById('card-image-zoom-image'),
  cardImageZoomPrompt: document.getElementById('card-image-zoom-prompt'),
  btnCardImageZoomClose: document.getElementById('btn-card-image-zoom-close'),

  
  // Avatar setup elements
  avatarPreviewBox: document.getElementById('avatar-preview-box'),
  avatarPreviewImg: document.getElementById('avatar-preview-img'),
  avatarDefaultSvg: document.getElementById('avatar-default-svg'),
  btnTriggerAvatarOptions: document.getElementById('btn-trigger-avatar-options'),
  btnSelectCamera: document.getElementById('btn-select-camera'),
  btnSelectUpload: document.getElementById('btn-select-upload'),
  inputAvatarGallery: document.getElementById('input-avatar-gallery'),
  inputAvatarCamera: document.getElementById('input-avatar-camera'),
  avatarOptionsPopover: document.getElementById('avatar-options-popover'),
  
  // Camera modal elements
  cameraModal: document.getElementById('camera-modal'),
  cameraVideo: document.getElementById('camera-video'),
  btnCameraCapture: document.getElementById('btn-camera-capture'),
  btnCameraClose: document.getElementById('btn-camera-close'),
  btnCameraSwitch: document.getElementById('btn-camera-switch'),
  btnCameraSwitchFloating: document.getElementById('btn-camera-switch-floating'),
  cameraFacingLabel: document.getElementById('camera-facing-label'),
  
  // In-game avatars list
  gameplayAvatarsList: document.getElementById('gameplay-avatars-list'),
  gameplayAvatarsWrapper: document.getElementById('gameplay-avatars-wrapper'),
  playerListModal: document.getElementById('player-list-modal'),
  btnPlayerListClose: document.getElementById('btn-player-list-close'),
  playerListModalContent: document.getElementById('player-list-modal-content'),
  
  // Controllo accessi lobby (Lucchetto e Espulsione)
  btnLockRoom: document.getElementById('btn-lock-room'),
  kickContextMenu: document.getElementById('kick-context-menu'),
  btnKickPlayer: document.getElementById('btn-kick-player'),
  btnCancelKick: document.getElementById('btn-cancel-kick'),
  screenKicked: document.getElementById('screen-kicked'),
  btnKickedHome: document.getElementById('btn-kicked-home'),
  screenRoomFull: document.getElementById('screen-room-full'),
  btnRoomFullHome: document.getElementById('btn-room-full-home'),
  screenLoading: document.getElementById('screen-loading'),
  loadingSpinnerContainer: document.getElementById('loading-spinner-container'),
  loadingStatusText: document.getElementById('loading-status-text'),
  btnLoadingHome: document.getElementById('btn-loading-home'),
  
  // Paywall & Admin Reset
  btnPaywallBuy: document.getElementById('btn-paywall-buy'),
  btnPaywallClose: document.getElementById('btn-paywall-close'),
  btnResetNoPremium: document.getElementById('btn-reset-no-premium'),

  // Timer picker panel (solo host, nel gameplay)
  timerPickerPanel: document.getElementById('timer-picker-panel'),
  btnTimerPickerClose: document.getElementById('btn-timer-picker-close')
};

// ==========================================================================
// INIZIALIZZAZIONE & EVENTI DOM
// ==========================================================================
function forceHideSplash() {
  const splash = document.getElementById('screen-splash') || (el && el.screenSplash);
  if (splash) {
    splash.style.display = 'none';
    splash.classList.remove('active', 'fade-out');
  }
}

async function startApp() {
  // Pulizia dati legacy di prova/trial dal localStorage
  localStorage.removeItem('overunder_trial_redeemed');
  localStorage.removeItem('overunder_trial_start');
  localStorage.removeItem('overunder_trial_end');
  localStorage.removeItem('overunder_has_redeemed_trial');
  localStorage.removeItem('overunder_trial_activated');
  localStorage.removeItem('overunder_trial_shown');

  // Sincronizza stato e token salvato nel localStorage all'avvio
  const savedToken = getStoredAuthToken();
  if (savedToken) {
    const decoded = parseJwtPayload(savedToken);
    if (decoded && (decoded.isPremium || decoded.premiumStatus === 'PREMIUM_A_VITA')) {
      safeStorage.setItem('overunder_premium_unlocked', 'true');
      safeStorage.setItem('overunder_judgement_purchased', 'true');
      try { localStorage.setItem('overunder_premium_unlocked', 'true'); } catch (e) {}
      try { localStorage.setItem('overunder_judgement_purchased', 'true'); } catch (e) {}
    }
    state.authenticatedToken = savedToken;
  }

  try { initClock(); } catch (e) { console.warn("initClock error:", e); }
  try { setupOnboardingTabs(); } catch (e) { console.warn("setupOnboardingTabs error:", e); }
  try { setupEventListeners(); } catch (e) { console.warn("setupEventListeners error:", e); }
  try { AudioSynth.init(); } catch (e) { console.warn("AudioSynth init error:", e); }
  try { setupSocketListeners(); } catch (e) { console.warn("setupSocketListeners error:", e); }
  try { setupPremiumCreatorEvents(); } catch (e) { console.warn("setupPremiumCreatorEvents error:", e); }
  try { setupAvatarEvents(); } catch (e) { console.warn("setupAvatarEvents error:", e); }
  try { setupJoinRulesModalEvents(); } catch (e) { console.warn("setupJoinRulesModalEvents error:", e); }
  try { setupCaptionTapListeners(); } catch (e) { console.warn("setupCaptionTapListeners error:", e); }
  
  let hasRoomParam = false;
  try {
    hasRoomParam = await checkUrlParams();
  } catch (e) {
    console.warn("checkUrlParams error:", e);
  }
  
  try { updateAudioButtonUI(); } catch (e) { console.warn("updateAudioButtonUI error:", e); }
  try { initSettingsSidebar(); } catch (e) { console.warn("initSettingsSidebar error:", e); }
  try { runSplashScreen(hasRoomParam); } catch (e) { console.warn("runSplashScreen error:", e); }
  try { updatePremiumUI(); } catch (e) { console.warn("updatePremiumUI error:", e); }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}

// Safety net: Garantisce che lo splash screen venga rimosso entro 7s se un errore imprevisto ne blocca l'esecuzione
setTimeout(() => {
  const splash = document.getElementById('screen-splash');
  if (splash && (splash.style.display !== 'none' || splash.classList.contains('active'))) {
    console.warn('[SAFETY] Force hiding splash screen due to timeout');
    forceHideSplash();
    const welcome = document.getElementById('screen-welcome');
    if (welcome && !document.querySelector('.screen.active')) {
      welcome.classList.add('active');
    }
  }
}, 7000);

function initClock() {
  if (!el || !el.statusClock) return;
  const updateClock = () => {
    const now = new Date();
    const hrs = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    if (el.statusClock) el.statusClock.textContent = `${hrs}:${mins}`;
  };
  updateClock();
  setInterval(updateClock, 30000);
}

function runSplashScreen(hasRoomParam = false) {
  // Assicurati che lo splash screen sia visibile all'avvio
  if (el.screenSplash) {
    el.screenSplash.style.display = 'flex';
    el.screenSplash.classList.add('active');
    el.screenSplash.classList.remove('fade-out');
  }

  // Micro fade-out prima dei 5 secondi
  setTimeout(() => {
    if (el.screenSplash) {
      el.screenSplash.classList.add('fade-out');
    }
  }, 4700);

  // Nascondi lo splash screen esattamente a 5 secondi e mostra la vista corretta
  setTimeout(() => {
    forceHideSplash();
    
    if (hasRoomParam) {
      console.log('[INVITE] Fine splash screen 5s. Mostra form onboarding e subito le regole della stanza.');
      showScreen(el.screenOnboarding);
      if (el.screenOnboarding) {
        try { el.screenOnboarding.scrollTop = 0; } catch (e) {}
      }
      // Mostra SUBITO la schermata con le REGOLE della stanza relativa
      openJoinRulesModal(state.joinRulesIsPremium);
    } else {
      const screens = [
        el.screenWelcome,
        el.screenOnboarding,
        el.screenLobby,
        el.screenGameplay,
        el.screenResults,
        el.screenSummary
      ];
      const anyActive = screens.some(s => s && s.classList.contains('active'));
      
      if (!anyActive) {
        showScreen(el.screenWelcome);
      }
    }
  }, 5000);
}

function showScreen(targetScreen) {
  forceHideSplash();
  [el.screenWelcome, el.screenOnboarding, el.screenLobby, el.screenGameplay, el.screenResults, el.screenSummary, el.screenKicked, el.screenRoomFull, el.screenLoading].forEach(screen => {
    if (screen) {
      screen.classList.remove('active');
      screen.style.removeProperty('display');
    }
  });
  if (targetScreen) {
    targetScreen.classList.add('active');
    targetScreen.style.removeProperty('display');
    targetScreen.style.display = '';
    try { targetScreen.scrollTop = 0; } catch (e) {}
  }

  if (targetScreen !== el.screenGameplay) {
    closeCardInfoModal();
  }
  if (typeof closeCardImageZoom === 'function') closeCardImageZoom();
  if (typeof closeAvatarZoom === 'function') closeAvatarZoom();

  // Configura il timer counter cliccabile solo in gameplay per l'host
  if (targetScreen === el.screenGameplay) {
    setupTimerCounterClickable();
    if (state.isSoloMode) {
      el.screenGameplay.classList.add('is-solo-mode');
    } else {
      el.screenGameplay.classList.remove('is-solo-mode');
      hideSoloPersonalityPopup();
    }
  } else {
    stopTimerLoop();
    closeTimerPicker();
    if (el.screenGameplay) {
      el.screenGameplay.classList.remove('is-solo-mode');
    }
    hideSoloPersonalityPopup();
  }
}

// Configurazione Tab dell'Onboarding (2 tab: Solo, Crea)
function setupOnboardingTabs() {
  const allTabs = [el.tabSolo, el.tabCreate];
  const allForms = [el.formSoloPlay, el.formCreateRoom];

  function activateTab(index) {
    allTabs.forEach((t, i) => {
      t.classList.toggle('active', i === index);
    });
    allForms.forEach((f, i) => {
      f.style.display = i === index ? 'block' : 'none';
    });
    el.nameErrorMsg.style.display = 'none';
  }

  el.tabSolo.addEventListener('click', () => activateTab(0));
  el.tabCreate.addEventListener('click', () => activateTab(1));
}

function updateAudioButtonUI() {
  const sidebarToggle = document.getElementById('sidebar-audio-toggle');
  const sidebarStatusText = document.getElementById('sidebar-audio-status-text');
  if (sidebarToggle) sidebarToggle.checked = !AudioSynth.isMuted;
  if (sidebarStatusText) sidebarStatusText.textContent = AudioSynth.isMuted ? 'Audio disattivato' : 'Audio attivo';

  const btn = el.btnToggleAudio;
  if (!btn) return;
  if (AudioSynth.isMuted) {
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;">
        <path d="M11 5L6 9H2v6h4l5 4V5z"/>
        <line x1="23" y1="9" x2="17" y2="15"/>
        <line x1="17" y1="9" x2="23" y2="15"/>
      </svg>
    `;
    btn.setAttribute('title', 'Attiva Audio');
  } else {
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;">
        <path d="M11 5L6 9H2v6h4l5 4V5z"/>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
      </svg>
    `;
    btn.setAttribute('title', 'Disattiva Audio');
  }
}

/**
 * Gestione del Pannello Laterale Impostazioni (Sidebar Menu)
 */
function initSettingsSidebar() {
  const backdrop = document.getElementById('settings-sidebar-backdrop');
  const btnClose = document.getElementById('btn-close-settings');
  const openBtns = document.querySelectorAll('.btn-open-settings');
  const audioToggle = document.getElementById('sidebar-audio-toggle');
  const audioStatusText = document.getElementById('sidebar-audio-status-text');
  const btnShare = document.getElementById('btn-sidebar-share');

  function openSidebar() {
    if (backdrop) backdrop.classList.add('active');
    syncAudioUI();
  }

  function closeSidebar() {
    if (backdrop) backdrop.classList.remove('active');
  }

  openBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSidebar();
    });
  });

  if (btnClose) {
    btnClose.addEventListener('click', closeSidebar);
  }

  if (backdrop) {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        closeSidebar();
      }
    });
  }

  function syncAudioUI() {
    const isMuted = AudioSynth.isMuted;
    if (audioToggle) audioToggle.checked = !isMuted;
    if (audioStatusText) {
      audioStatusText.textContent = isMuted ? 'Audio disattivato' : 'Audio attivo';
    }
  }

  if (audioToggle) {
    syncAudioUI();
    audioToggle.addEventListener('change', (e) => {
      const isMuted = !e.target.checked;
      AudioSynth.isMuted = isMuted;
      localStorage.setItem('overunder_muted', isMuted);
      syncAudioUI();
      updateAudioButtonUI();
      if (!isMuted) {
        try {
          AudioSynth.init();
          AudioSynth.playConfirm(true);
        } catch (err) {}
      }
    });
  }

  if (btnShare) {
    btnShare.addEventListener('click', async () => {
      const shareData = {
        title: 'Over Under - Party Game',
        text: 'Unisciti alla mia stanza e gioca a Over Under! 🔥',
        url: window.location.origin
      };

      if (navigator.share) {
        try {
          await navigator.share(shareData);
          console.log('[SHARE] Condivisione nativa completata con successo');
        } catch (err) {
          if (err.name !== 'AbortError') {
            console.warn('[SHARE] Web Share API fallita, eseguiamo il fallback negli appunti:', err);
            copyToClipboardFallback(shareData.url);
          }
        }
      } else {
        copyToClipboardFallback(shareData.url);
      }
    });
  }

  // --- Handling Legal Modal (Privacy Policy & Termini di Servizio) ---
  const linkPrivacy = document.getElementById('link-privacy-policy');
  const linkTerms = document.getElementById('link-terms-service');
  const legalModal = document.getElementById('legal-modal-backdrop');
  const legalTitle = document.getElementById('legal-modal-title');
  const legalBody = document.getElementById('legal-modal-body');
  const btnCloseLegal = document.getElementById('btn-close-legal-modal');

  const privacyText = `
    <p><strong>Over Under</strong> rispetta la tua privacy e si impegna a proteggere i dati degli utenti.</p>
    <p><strong>Dati Raccolti:</strong> Non raccogliamo dati personali identificabili. I dati temporanei di sessione (es. nickname e risposte di gioco) vengono utilizzati esclusivamente per consentire il corretto funzionamento delle partite multiplayer in tempo reale e cancellati al termine della sessione.</p>
    <p><strong>Storage Locale:</strong> Utilizziamo unicamente la memoria locale del browser (localStorage) per salvare preferenze di gioco (audio, preferenze grafiche) senza tracciare la tua navigazione.</p>
    <p><strong>Contatti e Supporto:</strong> Per qualsiasi domanda riguardante la privacy o il servizio, puoi scriverci a <a href="mailto:support@overunder-game.com" style="color: #00f0ff; text-decoration: underline;">support@overunder-game.com</a>.</p>
  `;

  const termsText = `
    <p><strong>Termini di Servizio - Over Under</strong></p>
    <p><strong>1. Accettazione dei Termini:</strong> Accedendo e utilizzando Over Under, l'utente accetta di rispettare le regole della community e i presenti Termini di Servizio.</p>
    <p><strong>2. Condotta dell'Utente:</strong> È vietato utilizzare nickname o contenuti offensivi, diffamatori o discriminatori, nonché tentare di manomettere il servizio o i server di gioco.</p>
    <p><strong>3. Limitazione di Responsabilità:</strong> Il servizio viene fornito "così com'è". Ci riserviamo il diritto di sospendere l'accesso agli utenti che violano i termini della community.</p>
    <p><strong>4. Contatti:</strong> Per maggiori informazioni o assistenza: <a href="mailto:support@overunder-game.com" style="color: #00f0ff; text-decoration: underline;">support@overunder-game.com</a>.</p>
  `;

  function openLegalModal(title, content) {
    if (legalTitle) legalTitle.textContent = title;
    if (legalBody) legalBody.innerHTML = content;
    if (legalModal) {
      legalModal.classList.remove('hidden');
      legalModal.classList.add('active');
    }
  }

  function closeLegalModal() {
    if (legalModal) {
      legalModal.classList.add('hidden');
      legalModal.classList.remove('active');
    }
  }

  if (linkPrivacy) {
    linkPrivacy.addEventListener('click', (e) => {
      e.preventDefault();
      openLegalModal('Privacy Policy', privacyText);
    });
  }

  if (linkTerms) {
    linkTerms.addEventListener('click', (e) => {
      e.preventDefault();
      openLegalModal('Termini di Servizio', termsText);
    });
  }

  if (btnCloseLegal) {
    btnCloseLegal.addEventListener('click', closeLegalModal);
  }

  if (legalModal) {
    legalModal.addEventListener('click', (e) => {
      if (e.target === legalModal) {
        closeLegalModal();
      }
    });
  }

  async function copyToClipboardFallback(textToCopy) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = textToCopy;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      showToast("Link copiato negli appunti! 🚀");
    } catch (err) {
      console.error("Errore copia link:", err);
      showToast("Impossibile copiare il link");
    }
  }
}

// ---- Timer Picker Panel (cliccando sui secondi che scorrono) ----

function openTimerPicker() {
  const panel = el.timerPickerPanel;
  if (!panel) return;
  updateTimerPickerSelection();
  panel.style.display = '';
}

function closeTimerPicker() {
  const panel = el.timerPickerPanel;
  if (!panel) return;
  panel.style.display = 'none';
}

function updateTimerPickerSelection() {
  const panel = el.timerPickerPanel;
  if (!panel) return;
  const options = panel.querySelectorAll('.timer-picker-option');
  options.forEach(opt => {
    const dur = parseInt(opt.dataset.duration, 10);
    opt.classList.toggle('selected', dur === state.timerDurationMs);
  });
}

function applyTimerDuration(newDuration) {
  state.timerDurationMs = newDuration;
  updateTimerPickerSelection();
  closeTimerPicker();

  if (state.isSoloMode) {
    showToast(`Timer: ${newDuration / 1000}s dalla prossima carta ⏱`);
  } else {
    socket.emit('set_timer_duration', { durationMs: newDuration });
  }
}

// Aggiunge/rimuove la classe host-clickable sul timer counter
function setupTimerCounterClickable() {
  if (!el.timerCounter) return;
  if (state.isHost) {
    el.timerCounter.classList.add('host-clickable');
  } else {
    el.timerCounter.classList.remove('host-clickable');
  }
}

// ==========================================================================
// FUNZIONI E LOGICA DEL REGALO DI BENVENUTO (TRIAL 30 GIORNI)
// ==========================================================================

function getDeviceFingerprint() {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.textBaseline = "top";
      ctx.font = "14px 'Arial'";
      ctx.fillStyle = "#f60";
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = "#069";
      ctx.fillText("OverUnderFingerprint", 2, 15);
      ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
      ctx.fillText("OverUnderFingerprint", 4, 17);
      const canvasData = canvas.toDataURL();
      return canvasData.substring(0, 50);
    }
  } catch (e) {
    console.warn("Canvas fingerprinting non disponibile:", e);
  }
  return (navigator.userAgent || '') + '_' + (screen ? (screen.width + 'x' + screen.height) : '');
}

function triggerParticleExplosion() {
  const canvas = document.getElementById('trial-particles-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  
  const particles = [];
  const colors = ['#ff007f', '#bd33ff', '#FFD700', '#00f0ff', '#ff3333'];
  
  for (let i = 0; i < 80; i++) {
    particles.push({
      x: canvas.width / 2,
      y: canvas.height / 2 + 30,
      vx: (Math.random() - 0.5) * 10,
      vy: (Math.random() - 0.7) * 14,
      size: Math.random() * 4 + 2,
      color: colors[Math.floor(Math.random() * colors.length)],
      alpha: 1,
      decay: Math.random() * 0.02 + 0.015,
      gravity: 0.25
    });
  }
  
  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let active = false;
    
    particles.forEach(p => {
      if (p.alpha > 0) {
        active = true;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.alpha -= p.decay;
        
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.shadowBlur = 10;
        ctx.shadowColor = p.color;
        ctx.fill();
        ctx.restore();
      }
    });
    
    if (active) {
      requestAnimationFrame(animate);
    }
  }
  
  animate();
}

function getDecodedToken() {
  const token = getStoredAuthToken();
  if (!token) return null;
  return parseJwtPayload(token);
}

function checkPremiumStatusFromToken() {
  const decoded = getDecodedToken();
  if (!decoded) return false;
  if (decoded.isPremium || decoded.premiumStatus === 'PREMIUM_A_VITA') {
    return true;
  }
  return false;
}

function checkJudgementDayAccess() {
  const decoded = getDecodedToken();
  const tokenIsPremium = !!(decoded && (decoded.isPremium || decoded.premiumStatus === 'PREMIUM_A_VITA'));
  const isPurchased = tokenIsPremium || 
                      safeStorage.getItem('overunder_judgement_purchased') === 'true' || 
                      safeStorage.getItem('overunder_premium_unlocked') === 'true' ||
                      (typeof localStorage !== 'undefined' && localStorage.getItem('overunder_premium_unlocked') === 'true') ||
                      (typeof localStorage !== 'undefined' && localStorage.getItem('overunder_judgement_purchased') === 'true');
  return {
    hasAccess: isPurchased,
    isPurchased: isPurchased,
    isExpired: false
  };
}

function hasPremiumAccess() {
  return checkJudgementDayAccess().hasAccess;
}

function updatePremiumUI() {
  const isPremium = checkJudgementDayAccess().hasAccess;
  const crown = document.getElementById('premium-crown-icon');
  if (crown) {
    crown.style.display = isPremium ? 'none' : 'inline';
  }

  const priceLabel = document.getElementById('premium-price-label');
  const descLabel = document.getElementById('premium-desc-label');
  if (priceLabel && descLabel) {
    if (isPremium) {
      priceLabel.style.display = 'none';
    } else {
      priceLabel.style.display = 'block';
    }
    descLabel.style.textAlign = 'left';
  }
}

// Helper globale per apertura modale Trasferimento / Accesso Esclusivo con messaggio dinamico
function openTransferModal(reason = null) {
  const restoreModal = el.restorePurchaseModal || document.getElementById('restore-purchase-modal');
  const titleEl = restoreModal ? restoreModal.querySelector('.title-floating') : null;
  const descEl = document.getElementById('transfer-modal-desc');

  if (typeof resetTransferModalState === 'function') {
    resetTransferModalState();
  }

  if (reason === 'transferred') {
    if (titleEl) titleEl.innerHTML = '<span style="display: block; font-size: 2rem; margin-bottom: 4px;">📱</span>LICENZA TRASFERITA';
    if (descEl) descEl.textContent = "La tua licenza è stata presa da un altro dispositivo. Inserisci la tua email per ricevere il codice OTP e trasferirla su questo dispositivo.";
  } else {
    if (titleEl) titleEl.innerHTML = '<span style="display: block; font-size: 2rem; margin-bottom: 4px;">📲</span>ACCEDI / TRASFERISCI';
    if (descEl) descEl.textContent = "La licenza Judgement Day è ad accesso esclusivo (1 solo dispositivo attivo). Inserisci la tua email per ricevere il codice OTP e attivare questo dispositivo.";
  }

  if (restoreModal) {
    restoreModal.style.display = 'flex';
    restoreModal.offsetHeight; // trigger reflow
    restoreModal.classList.add('active');
  }
}

function setupEventListeners() {
  // Nascondi errore su input
  [el.soloNameInput, el.hostNameInput, el.createRoomCodeInput, el.joinNameInput].forEach(input => {
    if (input) {
      input.addEventListener('input', () => {
        el.nameErrorMsg.style.display = 'none';
      });
    }
  });

  // === TASTI INDIETRO (NAVIGAZIONE FRECCETTA) ===
  if (el.btnBackOnboarding) {
    el.btnBackOnboarding.addEventListener('click', () => {
      AudioSynth.playConfirm(false);
      showScreen(el.screenWelcome);
    });
  }

  if (el.btnBackLobby) {
    el.btnBackLobby.addEventListener('click', () => {
      AudioSynth.playConfirm(false);
      // Disconnessione pulita dalla stanza attuale
      if (socket && socket.connected) {
        socket.emit('leave_room');
        socket.disconnect();
        socket.connect();
      }
      clearSession();
      resetToMenu();
      showScreen(el.screenWelcome);
    });
  }

  // === WELCOME START ===
  if (el.btnWelcomeStart) {
    el.btnWelcomeStart.addEventListener('click', () => {
      try { AudioSynth.init(); } catch (e) {}
      try { AudioSynth.playConfirm(true); } catch (e) {}
      showScreen(el.screenOnboarding);
    });
  }

/**
 * Verifica se l'utente si trova attualmente dentro una stanza attiva (lobby, gioco, risultati).
 * Se true, qualsiasi pop-up di acquisto/paywall deve essere SEVERAMENTE BLOCCATO.
 */
function isUserInActiveRoom() {
  return !!(state.roomCode && (
    (el.screenLobby && el.screenLobby.classList.contains('active')) ||
    (el.screenGameplay && el.screenGameplay.classList.contains('active')) ||
    (el.screenResults && el.screenResults.classList.contains('active')) ||
    state.gameplayStarted
  ));
}

function showPurchaseModal() {
  // BLOCK CRITICO: Non mostrare MAI il pop-up di acquisto se l'utente è in una stanza attiva.
  if (isUserInActiveRoom()) {
    console.warn('[PAYWALL BLOCK] Modale di acquisto bloccata: utente in stanza attiva.');
    return;
  }
  const standardModal = el.paywallStandardModal || document.getElementById('paywall-standard-modal');
  if (standardModal) {
    standardModal.style.display = 'flex';
    standardModal.classList.add('active');
  }
}

  // === GESTIONE IMMEDIATA SWITCH JUDGEMENT DAY (PAYWALL ON FIRST TAP) ===
  const handleJudgementToggleAttempt = (e) => {
    const access = checkJudgementDayAccess();
    console.log("--> CLICK/TAP SWITCH JUDGEMENT DAY:", access);

    if (!access.hasAccess) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (el.createPremiumToggle) {
        el.createPremiumToggle.checked = false;
      }
      showPurchaseModal();
      return false;
    }
    return true;
  };

  if (el.createPremiumToggle) {
    el.createPremiumToggle.addEventListener('click', (e) => {
      handleJudgementToggleAttempt(e);
    });

    el.createPremiumToggle.addEventListener('change', (e) => {
      handleJudgementToggleAttempt(e);
    });
  }

  const switchContainerEl = document.querySelector('.switch-container');
  if (switchContainerEl) {
    ['click', 'touchend'].forEach(evtType => {
      switchContainerEl.addEventListener(evtType, (e) => {
        const access = checkJudgementDayAccess();
        if (!access.hasAccess) {
          e.preventDefault();
          e.stopPropagation();
          if (el.createPremiumToggle) el.createPremiumToggle.checked = false;
          showPurchaseModal();
        }
      }, { passive: false });
    });
  }

  // === RESET TO NO-PREMIUM ===
  if (el.btnResetNoPremium) {
    el.btnResetNoPremium.addEventListener('click', () => {
      sessionStorage.removeItem('overunder_token');
      localStorage.removeItem('overunder_judgement_purchased');
      localStorage.removeItem('overunder_premium_unlocked');
      state.roomIsPremium = false;
      if (el.createPremiumToggle) {
        el.createPremiumToggle.checked = false;
      }
      const crown = document.getElementById('premium-crown-icon');
      if (crown) {
        crown.style.display = 'inline';
      }
      updatePremiumUI();
      showError("Stato Premium resettato a NON ACQUISTATO!");
    });
  }

  // Helper per acquisto Stripe Checkout
  async function handleStripePurchase(buttonEl) {
    try {
      buttonEl.disabled = true;
      buttonEl.innerText = "REINDIRIZZAMENTO...";
      
      let token = sessionStorage.getItem('overunder_token');
      if (!token) {
        const defaultName = (el.hostNameInput && el.hostNameInput.value.trim()) || "host_" + Math.floor(Math.random() * 1000);
        token = await authenticateHost(defaultName);
        sessionStorage.setItem('overunder_token', token);
      }
      
      const res = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        }
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Impossibile avviare il pagamento.");
      }

      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
        return;
      }

      if (data.directSuccess && data.token) {
        sessionStorage.setItem('overunder_token', data.token);
        state.roomIsPremium = true;
        if (socket.connected) {
          socket.disconnect();
          socket.connect();
        }
        showError("Acquisto completato! Modalità \"Judgement Day\" sbloccata per sempre! 👑");
        updatePremiumUI();
        if (el.trialExpiredModal) el.trialExpiredModal.style.display = 'none';
        const standardModal = document.getElementById('paywall-standard-modal');
        if (standardModal) standardModal.style.display = 'none';
      }
    } catch (err) {
      showError(err.message || "Errore durante l'acquisto.");
    } finally {
      buttonEl.disabled = false;
      buttonEl.innerText = "SBLOCCA PER SEMPRE";
    }
  }

  // === JUDGEMENT DAY INFO MODAL (Solo Info) ===
  const openInfoModal = () => {
    const targetModal = el.infoGognaModal || document.getElementById('info-gogna-modal');
    if (targetModal) {
      targetModal.style.display = 'flex';
      targetModal.classList.add('active');
    }
  };

  const closeInfoModal = () => {
    const targetModal = el.infoGognaModal || document.getElementById('info-gogna-modal');
    if (targetModal) {
      targetModal.style.display = 'none';
      targetModal.classList.remove('active');
    }
  };

  if (el.btnInfoGogna) {
    ['click', 'touchend'].forEach(evtType => {
      el.btnInfoGogna.addEventListener(evtType, (e) => {
        e.preventDefault();
        e.stopPropagation();
        openInfoModal();
      });
    });
  }

  if (el.btnInfoGognaClose) {
    el.btnInfoGognaClose.addEventListener('click', () => {
      closeInfoModal();
    });
  }

  // === JUDGEMENT DAY CARD TAP & INFO ===
  if (el.judgementDayCard) {
    el.judgementDayCard.addEventListener('click', (e) => {
      // Evita intercettazione se l'utente clicca sul pulsante 'i' o sullo switch stesso
      if (e.target && (e.target.id === 'btn-info-gogna' || e.target.closest('#btn-info-gogna') || e.target.id === 'create-premium-toggle' || e.target.closest('.switch-container'))) return;
      
      const access = checkJudgementDayAccess();
      if (!access.hasAccess) {
        e.preventDefault();
        e.stopPropagation();
        if (el.createPremiumToggle) el.createPremiumToggle.checked = false;
        showPurchaseModal();
        return;
      }

      if (el.createPremiumToggle) {
        el.createPremiumToggle.checked = !el.createPremiumToggle.checked;
      }
    });
  }

  // === PAYWALL BLOCKER ACQUISTA (Stripe / IAP) ===
  if (el.btnPaywallBuy) {
    el.btnPaywallBuy.addEventListener('click', () => handleStripePurchase(el.btnPaywallBuy));
  }

  // === PAYWALL STANDARD BUY (Stripe / IAP) ===
  const btnPaywallStandardBuy = el.btnPaywallStandardBuy || document.getElementById('btn-paywall-standard-buy');
  if (btnPaywallStandardBuy) {
    btnPaywallStandardBuy.addEventListener('click', () => handleStripePurchase(btnPaywallStandardBuy));
  }

  // === PAYWALL STANDARD CLOSE ===
  const btnPaywallStandardClose = el.btnPaywallStandardClose || document.getElementById('btn-paywall-standard-close');
  if (btnPaywallStandardClose) {
    btnPaywallStandardClose.addEventListener('click', () => {
      const standardModal = el.paywallStandardModal || document.getElementById('paywall-standard-modal');
      if (standardModal) {
        standardModal.style.display = 'none';
        standardModal.classList.remove('active');
      }
    });
  }

  // === TRASFERIMENTO DIRETTO LICENZA (EMAIL + DEVICE ID) ===
  const inputDirectTransferEmail = document.getElementById('transfer-license-email');
  const btnDirectTransferLicense = document.getElementById('btn-transfer-license');
  const directTransferError = document.getElementById('transfer-license-error');

  function showDirectTransferError(msg) {
    if (directTransferError) {
      directTransferError.textContent = msg;
      directTransferError.style.display = 'block';
    }
  }

  function hideDirectTransferError() {
    if (directTransferError) {
      directTransferError.textContent = '';
      directTransferError.style.display = 'none';
    }
  }

  async function handleDirectLicenseTransfer() {
    hideDirectTransferError();
    const rawEmail = inputDirectTransferEmail ? inputDirectTransferEmail.value : '';
    const email = rawEmail.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '').replace(/\s+/g, '').toLowerCase().trim();

    if (!email) {
      showDirectTransferError("Inserisci l'email usata per l'acquisto!");
      return;
    }

    try {
      if (btnDirectTransferLicense) {
        btnDirectTransferLicense.disabled = true;
        btnDirectTransferLicense.innerText = "TRASFERIMENTO IN CORSO...";
      }

      const currentDeviceId = (typeof getStoredDeviceId === 'function') ? getStoredDeviceId() : (safeStorage.getItem('overunder_device_id') || 'dev_' + Date.now());

      const res = await fetch('/api/license/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          deviceId: currentDeviceId,
          deviceUuid: currentDeviceId,
          sessionId: safeSessionStorage.getItem('overunder_sessionId') || null
        })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "Nessun acquisto trovato per questa email.");
      }

      if (data.token) {
        if (typeof setStoredAuthToken === 'function') {
          setStoredAuthToken(data.token, true);
        }
        safeSessionStorage.setItem('overunder_token', data.token);
        safeStorage.setItem('overunder_token', data.token);
        safeStorage.setItem('overunder_premium_unlocked', 'true');
        safeStorage.setItem('overunder_judgement_purchased', 'true');
        try { localStorage.setItem('overunder_premium_unlocked', 'true'); } catch (e) {}
        try { localStorage.setItem('overunder_judgement_purchased', 'true'); } catch (e) {}
      }

      state.roomIsPremium = true;
      if (el.createPremiumToggle) {
        el.createPremiumToggle.checked = true;
      }
      updatePremiumUI();

      if (socket && socket.connected && state.roomCode && state.isHost) {
        socket.emit('set_room_mode', { isPremium: true });
      }

      const standardModal = el.paywallStandardModal || document.getElementById('paywall-standard-modal');
      if (standardModal) {
        standardModal.style.display = 'none';
        standardModal.classList.remove('active');
      }

      showToast("Licenza trasferita con successo! 👑", 5000);

    } catch (err) {
      showDirectTransferError(err.message || "Errore durante il trasferimento.");
    } finally {
      if (btnDirectTransferLicense) {
        btnDirectTransferLicense.disabled = false;
        btnDirectTransferLicense.innerText = "TRASFERISCI LICENZA";
      }
    }
  }

  if (btnDirectTransferLicense) {
    btnDirectTransferLicense.addEventListener('click', handleDirectLicenseTransfer);
  }
  if (inputDirectTransferEmail) {
    inputDirectTransferEmail.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleDirectLicenseTransfer();
      }
    });
  }

  // === TRASFERIMENTO LICENZA PREMIUM (2FA OTP) ===
  const inputTransferEmail = document.getElementById('input-transfer-email');
  const inputTransferOtp = document.getElementById('input-transfer-otp');
  const btnRequestTransferOtp = document.getElementById('btn-request-transfer-otp');
  const btnVerifyTransferOtp = document.getElementById('btn-verify-transfer-otp');
  const btnResendTransferOtp = document.getElementById('btn-resend-transfer-otp');
  const transferStepEmail = document.getElementById('transfer-step-email');
  const transferStepOtp = document.getElementById('transfer-step-otp');
  const transferEmailDisplay = document.getElementById('transfer-email-display');
  const transferOtpTimer = document.getElementById('transfer-otp-timer');
  const transferOtpTimerBox = document.getElementById('transfer-otp-timer-box');
  const transferErrorMsg = document.getElementById('transfer-error-msg');
  const restoreModal = document.getElementById('restore-purchase-modal');

  let otpTimerInterval = null;
  let otpCountdownSeconds = 60;

  function showTransferError(msg) {
    if (!transferErrorMsg) return;
    transferErrorMsg.textContent = msg;
    transferErrorMsg.style.display = 'block';
  }

  function hideTransferError() {
    if (!transferErrorMsg) return;
    transferErrorMsg.textContent = '';
    transferErrorMsg.style.display = 'none';
  }

  function openTransferModal() {
    resetTransferModalState();
    if (restoreModal) {
      restoreModal.style.display = 'flex';
      restoreModal.classList.add('active');
    }
  }

  function resetTransferModalState() {
    if (otpTimerInterval) {
      clearInterval(otpTimerInterval);
      otpTimerInterval = null;
    }
    hideTransferError();
    if (transferStepEmail) transferStepEmail.style.display = 'flex';
    if (transferStepOtp) transferStepOtp.style.display = 'none';
    if (inputTransferEmail) {
      inputTransferEmail.disabled = false;
      inputTransferEmail.value = '';
    }
    if (inputTransferOtp) {
      inputTransferOtp.value = '';
    }
    if (btnRequestTransferOtp) {
      btnRequestTransferOtp.disabled = false;
      btnRequestTransferOtp.innerText = "INVIA CODICE";
    }
    if (btnVerifyTransferOtp) {
      btnVerifyTransferOtp.disabled = false;
      btnVerifyTransferOtp.innerText = "CONFERMA";
    }
    if (btnResendTransferOtp) {
      btnResendTransferOtp.style.display = 'none';
    }
  }

  function startOtpCountdown() {
    if (otpTimerInterval) clearInterval(otpTimerInterval);
    otpCountdownSeconds = 60;
    if (transferOtpTimer) transferOtpTimer.textContent = otpCountdownSeconds;
    if (transferOtpTimerBox) transferOtpTimerBox.style.display = 'flex';
    if (btnResendTransferOtp) btnResendTransferOtp.style.display = 'none';

    otpTimerInterval = setInterval(() => {
      otpCountdownSeconds--;
      if (transferOtpTimer) transferOtpTimer.textContent = otpCountdownSeconds;

      if (otpCountdownSeconds <= 0) {
        clearInterval(otpTimerInterval);
        otpTimerInterval = null;
        if (transferOtpTimerBox) transferOtpTimerBox.style.display = 'none';
        showTransferError("Codice scaduto. Richiedi un nuovo codice.");
        if (btnResendTransferOtp) btnResendTransferOtp.style.display = 'inline-block';
      }
    }, 1000);
  }

  // Apri Modal Trasferimento
  const btnOpenRestoreModal = el.btnOpenRestoreModal || document.getElementById('btn-open-restore-modal');
  if (btnOpenRestoreModal) {
    btnOpenRestoreModal.addEventListener('click', () => {
      const standardModal = el.paywallStandardModal || document.getElementById('paywall-standard-modal');
      if (standardModal) {
        standardModal.style.display = 'none';
        standardModal.classList.remove('active');
      }
      openTransferModal();
    });
  }

  // Chiudi Modal Trasferimento
  const btnRestoreClose = el.btnRestoreClose || document.getElementById('btn-restore-close');
  if (btnRestoreClose) {
    btnRestoreClose.addEventListener('click', () => {
      resetTransferModalState();
      if (restoreModal) {
        restoreModal.style.display = 'none';
        restoreModal.classList.remove('active');
      }
    });
  }

  // FASE 1: Richiesta OTP (POST /api/premium/request-transfer)
  const handleRequestOTP = async () => {
    hideTransferError();
    const rawEmail = inputTransferEmail ? inputTransferEmail.value : '';
    const email = rawEmail.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '').replace(/\s+/g, '').toLowerCase().trim();
    if (!email) {
      showTransferError("Inserisci la tua email!");
      return;
    }

    try {
      if (btnRequestTransferOtp) {
        btnRequestTransferOtp.disabled = true;
        btnRequestTransferOtp.innerText = "INVIO IN CORSO...";
      }

      const res = await fetch('/api/premium/request-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || "Nessun acquisto trovato per questa email.");
      }

      if (inputTransferEmail) inputTransferEmail.disabled = true;
      if (transferEmailDisplay) transferEmailDisplay.textContent = email;
      if (transferStepEmail) transferStepEmail.style.display = 'none';
      if (transferStepOtp) transferStepOtp.style.display = 'flex';
      if (inputTransferOtp) {
        inputTransferOtp.value = '';
        setTimeout(() => { try { inputTransferOtp.focus(); } catch (e) {} }, 200);
      }

      startOtpCountdown();
      showToast("Codice OTP generato ed inviato alla mail! ⏱️", 4000);

    } catch (err) {
      showTransferError(err.message || "Impossibile inviare il codice OTP.");
    } finally {
      if (btnRequestTransferOtp) {
        btnRequestTransferOtp.disabled = false;
        btnRequestTransferOtp.innerText = "INVIA CODICE";
      }
    }
  };

  if (btnRequestTransferOtp) {
    btnRequestTransferOtp.addEventListener('click', handleRequestOTP);
  }
  if (btnResendTransferOtp) {
    btnResendTransferOtp.addEventListener('click', handleRequestOTP);
  }
  if (inputTransferEmail) {
    inputTransferEmail.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleRequestOTP();
      }
    });
  }

  // FASE 3: Verifica OTP (POST /api/premium/verify-transfer)
  const handleVerifyOTP = async () => {
    hideTransferError();
    const rawEmail = inputTransferEmail ? inputTransferEmail.value : '';
    const email = rawEmail.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '').replace(/\s+/g, '').toLowerCase().trim();
    const otpCode = inputTransferOtp ? inputTransferOtp.value.replace(/\s+/g, '').trim() : '';

    if (!otpCode) {
      showTransferError("Inserisci il codice OTP di 6 cifre.");
      return;
    }

    try {
      if (btnVerifyTransferOtp) {
        btnVerifyTransferOtp.disabled = true;
        btnVerifyTransferOtp.innerText = "VERIFICA IN CORSO...";
      }

      const currentDeviceId = (typeof getStoredDeviceId === 'function') ? getStoredDeviceId() : (safeStorage.getItem('overunder_device_id') || 'dev_' + Date.now());

      const res = await fetch('/api/premium/verify-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          otpCode: otpCode,
          deviceId: currentDeviceId,
          deviceUuid: currentDeviceId,
          sessionId: safeSessionStorage.getItem('overunder_sessionId') || null
        })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data.error && data.error.includes("scaduto")) {
          if (btnResendTransferOtp) btnResendTransferOtp.style.display = 'inline-block';
        }
        throw new Error(data.error || "Codice errato, riprova.");
      }

      if (data.token) {
        if (typeof setStoredAuthToken === 'function') {
          setStoredAuthToken(data.token, true);
        }
        safeSessionStorage.setItem('overunder_token', data.token);
        safeStorage.setItem('overunder_token', data.token);
        safeStorage.setItem('overunder_premium_unlocked', 'true');
        safeStorage.setItem('overunder_judgement_purchased', 'true');
        try { localStorage.setItem('overunder_premium_unlocked', 'true'); } catch (e) {}
        try { localStorage.setItem('overunder_judgement_purchased', 'true'); } catch (e) {}
      }

      state.roomIsPremium = true;
      if (el.createPremiumToggle) {
        el.createPremiumToggle.checked = true;
      }
      showToast("Licenza trasferita con successo! 👑", 5000);
      updatePremiumUI();

      if (socket && socket.connected && state.roomCode && state.isHost) {
        socket.emit('set_room_mode', { isPremium: true });
      }

      resetTransferModalState();
      if (restoreModal) {
        restoreModal.style.display = 'none';
        restoreModal.classList.remove('active');
      }
      const standardModal = el.paywallStandardModal || document.getElementById('paywall-standard-modal');
      if (standardModal) {
        standardModal.style.display = 'none';
        standardModal.classList.remove('active');
      }

    } catch (err) {
      showTransferError(err.message || "Errore durante la verifica del codice.");
    } finally {
      if (btnVerifyTransferOtp) {
        btnVerifyTransferOtp.disabled = false;
        btnVerifyTransferOtp.innerText = "CONFERMA";
      }
    }
  };

  if (btnVerifyTransferOtp) {
    btnVerifyTransferOtp.addEventListener('click', handleVerifyOTP);
  }
  if (inputTransferOtp) {
    inputTransferOtp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleVerifyOTP();
      }
    });
  }

  // === LUCCHETTO BLOCCA STANZA (1 TOUCH DIRECT TOGGLE) ===
  if (el.btnLockRoom) {
    el.btnLockRoom.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (!state.isHost) {
        showToast("Solo l'Host può bloccare o sbloccare la stanza.");
        return;
      }

      AudioSynth.playConfirm(true);
      socket.emit('toggle_lock_room');
    });
  }

  // === SOLO PLAY ===
  const handleSoloPlaySubmit = () => {
    const inputName = el.soloNameInput ? el.soloNameInput.value.trim() : '';
    const name = inputName || 'Giocatore';
    if (!inputName && el.soloNameInput) {
      el.soloNameInput.value = name;
    }
    try { AudioSynth.init(); } catch (e) {}
    startSoloMode(name);
  };

  // Selettore della durata per la modalità Solo
  document.querySelectorAll('.btn-solo-round-select').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-solo-round-select').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.soloGameLength = parseInt(btn.dataset.length) || 30;
      try { AudioSynth.playConfirm(true); } catch (e) {}
    });
  });

  if (el.btnSoloPlay) {
    el.btnSoloPlay.addEventListener('click', handleSoloPlaySubmit);
  }
  if (el.soloNameInput) {
    el.soloNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSoloPlaySubmit();
      }
    });
  }

  // Crea Stanza
  el.btnCreateRoom.addEventListener('click', async () => {
    const name = el.hostNameInput.value.trim();
    const code = el.createRoomCodeInput.value.trim().toUpperCase();
    if (!name) {
      showError("Inserisci il tuo nome!");
      return;
    }
    if (!code) {
      showError("Inserisci un codice per la stanza!");
      return;
    }
    if (code.length > 10) {
      showError("Il codice stanza può contenere al massimo 10 caratteri!");
      return;
    }
    try {
      AudioSynth.init();
    } catch (e) {
      console.warn("AudioSynth init non riuscito:", e);
    }

    const isPremiumToggleOn = el.createPremiumToggle ? el.createPremiumToggle.checked : false;

    // 1. INTERCETTAZIONE PREVENTIVA CLIENT-SIDE:
    if (isPremiumToggleOn) {
      const access = checkJudgementDayAccess();
      if (!access.hasAccess) {
        console.warn("[PREVENT] Creazione stanza Premium bloccata: dispositivo privo di licenza attiva.");
        if (el.createPremiumToggle) {
          el.createPremiumToggle.checked = false;
        }
        updatePremiumUI();
        showPurchaseModal();
        return;
      }
    }

    console.log("--> Tentativo creazione Stanza...", { roomCode: code, isPremium: isPremiumToggleOn, name });

    sessionStorage.setItem('overunder_playerName', name);
    sessionStorage.setItem('overunder_roomCode', code);
    sessionStorage.setItem('overunder_isHost', 'true');
    state.isSoloMode = false;
    state.gameMode = 'multiplayer';

    startConnectionLoading('create');

    state.pendingSocketAction = {
      type: 'create_room',
      data: { roomCode: code, avatar: state.playerAvatarUrl, isPremium: isPremiumToggleOn, deviceId: getStoredDeviceId() }
    };

    // Timeout Fallback di 1.5s: se l'autenticazione HTTP impiega più di 1.5s, fai proseguire subito la socket
    let authPromiseDone = false;
    const authTimeoutTimer = setTimeout(() => {
      if (!authPromiseDone) {
        console.warn("--> [TIMEOUT FALLBACK] AuthenticateHost impiega più di 1.5s. Esecuzione diretta socket...");
        executePendingSocketAction();
      }
    }, 1500);

    try {
      const token = await authenticateHost(name);
      authPromiseDone = true;
      clearTimeout(authTimeoutTimer);
      sessionStorage.setItem('overunder_token', token);
      localStorage.setItem('overunder_token', token);
      executePendingSocketAction();
    } catch (err) {
      authPromiseDone = true;
      clearTimeout(authTimeoutTimer);
      console.warn("--> [CATCH FALLBACK] Errore in authenticateHost, procedo con invio socket:", err.message);
      executePendingSocketAction();
    }
  });

  // Pulsante invita in lobby con supporto Web Share API & fallback appunti
  el.btnLobbyInvite.addEventListener('click', async () => {
    if (!state.roomCode) return;
    const inviteLink = window.location.origin + '/?room=' + encodeURIComponent(state.roomCode);
    const shareTitle = 'Over Under - Party Game';
    const shareText = `Unisciti alla mia stanza e gioca a Over Under! 🔥`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: inviteLink
        });
        console.log('[SHARE] Condivisione nativa stanza completata con successo');
        return;
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.warn('[SHARE] Web Share API fallita, fallback negli appunti:', err);
        } else {
          return;
        }
      }
    }

    navigator.clipboard.writeText(inviteLink).then(() => {
      showToast("Invito copiato!");
    }).catch(err => {
      console.error("Errore nella copia dell'invito: ", err);
      const textArea = document.createElement("textarea");
      textArea.value = inviteLink;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        showToast("Invito copiato!");
      } catch (e) {
        showError("Impossibile copiare il link automaticamente.");
      }
      document.body.removeChild(textArea);
    });
  });

  // === QR CODE MODAL LOBBY ===
  const btnLobbyQr = el.btnLobbyQr || document.getElementById('btn-lobby-qr');
  const qrModal = el.qrModal || document.getElementById('qr-modal');
  const btnQrModalClose = el.btnQrModalClose || document.getElementById('btn-qr-modal-close');
  const qrCodeImg = el.qrCodeImg || document.getElementById('qr-code-img');
  const qrModalRoomCode = el.qrModalRoomCode || document.getElementById('qr-modal-room-code');

  const openQrModal = () => {
    const roomCode = state.roomCode || (el.lobbyRoomCode ? el.lobbyRoomCode.textContent.trim() : '');
    if (!roomCode) return;

    const joinUrl = `${window.location.origin}/join?room=${encodeURIComponent(roomCode)}`;
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(joinUrl)}`;

    if (qrCodeImg) qrCodeImg.src = qrApiUrl;
    if (qrModalRoomCode) qrModalRoomCode.textContent = roomCode;

    if (qrModal) {
      qrModal.style.display = 'flex';
      qrModal.classList.remove('hidden');
    }
    try { AudioSynth.playConfirm(true); } catch (e) {}
  };

  const closeQrModal = () => {
    if (qrModal) {
      qrModal.classList.add('hidden');
      qrModal.style.display = 'none';
    }
    try { AudioSynth.playConfirm(false); } catch (e) {}
  };

  if (btnLobbyQr) {
    btnLobbyQr.addEventListener('click', openQrModal);
  }
  if (btnQrModalClose) {
    btnQrModalClose.addEventListener('click', closeQrModal);
  }
  if (qrModal) {
    qrModal.addEventListener('click', (e) => {
      if (e.target === qrModal) {
        closeQrModal();
      }
    });
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && qrModal && (qrModal.style.display === 'flex' || !qrModal.classList.contains('hidden'))) {
      closeQrModal();
    }
  });

  // Host: Avvio del Gioco (Avvia direttamente con la durata selezionata)
  if (el.btnHostStartGame) {
    el.btnHostStartGame.addEventListener('click', () => {
      if (!state.isHost) return;
      
      state.isSoloMode = false;
      state.gameMode = 'multiplayer';

      if (!state.players || state.players.length < 2) {
        showToast("Servono almeno 2 giocatori in stanza per avviare la partita! Fai scansionare il QR Code 📱", 4000);
        return;
      }

      if (state.roomIsPremium) {
        // Se l'host ha carte create in locale non ancora inviate, inviale subito
        if (state.localPremiumCards && state.localPremiumCards.length > 0 && !state.hasSubmittedPremiumCards) {
          socket.emit('submit_premium_cards', { cards: state.localPremiumCards });
          state.hasSubmittedPremiumCards = true;
        }
        socket.emit('start_game', { gameLength: state.gameLength });
      } else {
        socket.emit('start_game', { gameLength: state.gameLength });
      }
    });
  }

  // Selettore della durata partita nella lobby
  document.querySelectorAll('.btn-round-select').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-round-select').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.gameLength = parseInt(btn.dataset.length) || 30;
      AudioSynth.playConfirm(true);
    });
  });

  // Voto pulsanti
  if (el.btnUnderrated) el.btnUnderrated.addEventListener('click', () => submitVote('underrated'));
  if (el.btnOverrated) el.btnOverrated.addEventListener('click', () => submitVote('overrated'));

  // Host: Aggiunta Bot
  if (el.btnAddBots) {
    el.btnAddBots.addEventListener('click', () => {
      if (!state.isHost) return;
      socket.emit('add_bots');
    });
  }

  // Host: click per avanzare (PROSSIMA CARTA dall'overlay)
  if (el.btnNextOverlay) {
    el.btnNextOverlay.addEventListener('click', () => {
      if (!state.isHost) return;
      socket.emit('next_card');
    });
  }

  // Voto tardivo dall'overlay
  if (el.btnNextUnder) el.btnNextUnder.addEventListener('click', () => submitLateVote('underrated'));
  if (el.btnNextOver) el.btnNextOver.addEventListener('click', () => submitLateVote('overrated'));

  // Filtri dei voti nei risultati e overlay
  document.querySelectorAll('#results-votes-detail-card .votes-filter-container .filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#results-votes-detail-card .votes-filter-container .filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeResultsFilter = btn.dataset.filter;
      renderFilteredResultsList();
    });
  });

  document.querySelectorAll('#round-end-overlay .votes-filter-container .filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#round-end-overlay .votes-filter-container .filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeOverlayFilter = btn.dataset.filter;
      renderFilteredOverlayList();
    });
  });

  // Toggle Statistiche Mondiali (Toggle Bridge)
  if (el.btnToggleWorldStats) {
    el.btnToggleWorldStats.addEventListener('click', () => {
      state.isWorldStatsVisible = !state.isWorldStatsVisible;
      if (state.isWorldStatsVisible) {
        el.btnToggleWorldStats.classList.add('active');
        if (el.globalStatsCard) el.globalStatsCard.classList.add('active');
        AudioSynth.playConfirm(true);
        setTimeout(() => {
          if (el.globalStatsCard) el.globalStatsCard.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }, 100);
      } else {
        el.btnToggleWorldStats.classList.remove('active');
        if (el.globalStatsCard) el.globalStatsCard.classList.remove('active');
        AudioSynth.playConfirm(false);
      }
    });
  }

  // Host o Solo: Passa alla prossima carta
  if (el.btnNextCardConfluent) {
    el.btnNextCardConfluent.addEventListener('click', () => {
      if (state.roomCode && state.isHost) {
        socket.emit('next_card');
      } else if (state.isSoloMode && !state.roomCode) {
        if (state.soloTimeoutId) {
          clearTimeout(state.soloTimeoutId);
          state.soloTimeoutId = null;
        }
        advanceSoloGame();
      } else if (state.isHost) {
        socket.emit('next_card');
      }
    });
  }

  // Host / Solo: Riavvio o Torna al Menu
  if (el.btnRestart) {
    el.btnRestart.addEventListener('click', () => {
      if (state.roomCode && state.isHost) {
        socket.emit('restart_game');
      } else if (state.isSoloMode && !state.roomCode) {
        resetToMenu();
        return;
      } else if (state.isHost) {
        socket.emit('restart_game');
      }
    });
  }

  const handleExitToMainMenu = (e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    try { AudioSynth.playConfirm(false); } catch (err) {}
    // Pulisci la sessione della stanza PRIMA di disconnettersi per evitare che il ciclo
    // disconnect→connect→AUTH_SUCCESS→reconnect_room trovi una stanza scaduta e mostri errori
    state.gameEnded = true;
    clearRoomSession();
    if (!state.isSoloMode && typeof socket !== 'undefined' && socket && socket.connected) {
      try {
        socket.emit('leave_room');
        socket.disconnect();
        socket.connect();
      } catch (err) {}
    }
    resetToMenu();
  };

  const btnSoloMenu = document.getElementById('btn-solo-menu');
  if (btnSoloMenu) {
    btnSoloMenu.addEventListener('click', handleExitToMainMenu);
  }

  const btnSingleCancel = document.getElementById('btn-single-player-cancel-home');
  if (btnSingleCancel) {
    bindFastClick(btnSingleCancel, handleExitToMainMenu);
  }

  const btnSummaryCancelHost = document.getElementById('btn-summary-cancel-host');
  if (btnSummaryCancelHost) {
    bindFastClick(btnSummaryCancelHost, handleExitToMainMenu);
  }

  const btnSummaryCancelPlayer = document.getElementById('btn-summary-cancel-player');
  if (btnSummaryCancelPlayer) {
    bindFastClick(btnSummaryCancelPlayer, handleExitToMainMenu);
  }

  // Tasto Segnala (Bandierina Silente)
  if (el.btnReportCard) {
    el.btnReportCard.addEventListener('click', (e) => {
      e.stopPropagation();
      el.btnReportCard.style.color = '#F59E0B'; // feedback visivo arancione
      setTimeout(() => {
        el.btnReportCard.style.color = 'rgba(255, 255, 255, 0.15)';
      }, 1000);
      socket.emit('report_current_card');
    });
  }

  // Tasto Info Carta (i) - Solo Single Player e Stanza Standard
  if (el.btnCardInfo) {
    el.btnCardInfo.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      try { AudioSynth.playConfirm(false); } catch (err) {}
      openCardInfoModal(state.currentPromptText, state.currentCardDescription);
    });
  }

  if (el.btnCardInfoClose) {
    el.btnCardInfoClose.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      closeCardInfoModal();
    });
  }

  if (el.cardInfoModal) {
    el.cardInfoModal.addEventListener('click', (e) => {
      if (e.target === el.cardInfoModal) {
        closeCardInfoModal();
      }
    });
  }

  // Disabilitati i click sulle immagini (Visualizzazione Full-Card diretta)
  if (el.gameplayPromptImage) {
    el.gameplayPromptImage.style.pointerEvents = 'none';
    el.gameplayPromptImage.style.cursor = 'default';
  }
  if (el.resultsPromptImage) {
    el.resultsPromptImage.style.pointerEvents = 'none';
    el.resultsPromptImage.style.cursor = 'default';
  }

  // Gestione tap su didascalie/frasi lunghe delle carte (espansione al tap/click)
  setupCaptionTapListeners();

  // Pulsante indietro nella lobby
  if (el.btnBackLobby) {
    el.btnBackLobby.addEventListener('click', () => {
      AudioSynth.playConfirm(false);
      if (!state.isSoloMode && socket && socket.connected) {
        socket.emit('leave_room');
        socket.disconnect();
        socket.connect();
      }
      clearSession();
      resetToMenu();
      showScreen(el.screenWelcome);
    });
  }

  // Modal Custom Exit Actions
  const openExitModal = () => {
    state.isExitModalOpen = true;
    el.exitModal.style.display = 'flex';
    // Trigger paint reflow before adding class for smooth transition
    el.exitModal.offsetHeight;
    el.exitModal.classList.add('active');

    // Condizionale testo sottotitolo in base a Solo vs Gruppo
    if (state.isSoloMode) {
      el.exitModalDesc.style.display = 'none';
    } else {
      el.exitModalDesc.style.display = 'block';
      el.exitModalDesc.textContent = "La partita continuerà anche senza di te";
    }

    if (state.isSoloMode) {
      pauseTimer();
    }
  };

  const closeExitModal = () => {
    state.isExitModalOpen = false;
    el.exitModal.classList.remove('active');
    setTimeout(() => {
      if (!state.isExitModalOpen) {
        el.exitModal.style.display = 'none';
      }
    }, 300);
    if (state.isSoloMode) {
      resumeTimer();
    }
  };

  if (el.btnExitCancel) {
    el.btnExitCancel.addEventListener('click', () => {
      AudioSynth.playConfirm(true);
      closeExitModal();
    });
  }

  if (el.btnExitConfirm) {
    el.btnExitConfirm.addEventListener('click', () => {
      AudioSynth.playConfirm(false);
      state.isExitModalOpen = false;
      if (el.exitModal) {
        el.exitModal.classList.remove('active');
        el.exitModal.style.display = 'none';
      }
      if (!state.isSoloMode && socket && socket.connected) {
        socket.emit('leave_room');
        socket.disconnect();
        socket.connect();
      }
      resetToMenu();
    });
  }

  // Pulsante esci (X) durante gameplay
  if (el.btnQuitGameplay) {
    el.btnQuitGameplay.addEventListener('click', () => {
      AudioSynth.playConfirm(false);
      openExitModal();
    });
  }

  // Pulsante esci (X) durante i risultati del round
  if (el.btnQuitResults) {
    el.btnQuitResults.addEventListener('click', () => {
      AudioSynth.playConfirm(false);
      openExitModal();
    });
  }

  // Modal Come Funziona (Modalità Gogna Info)
  const setIsInfoOpen = (isOpen) => {
    state.isInfoOpen = isOpen;
    if (isOpen) {
      el.infoGognaModal.style.display = 'flex';
      el.infoGognaModal.offsetHeight; // force reflow
      el.infoGognaModal.classList.add('active');
    } else {
      el.infoGognaModal.classList.remove('active');
      setTimeout(() => {
        if (!state.isInfoOpen) {
          el.infoGognaModal.style.display = 'none';
        }
      }, 300);
    }
  };

  const btnInfoGogna = document.getElementById('btn-info-gogna');
  const btnInfoGognaClose = document.getElementById('btn-info-gogna-close');

  if (btnInfoGogna) {
    btnInfoGogna.addEventListener('click', () => {
      AudioSynth.playConfirm(true);
      setIsInfoOpen(true);
    });
  }

  if (btnInfoGognaClose) {
    btnInfoGognaClose.addEventListener('click', () => {
      AudioSynth.playConfirm(false);
      setIsInfoOpen(false);
    });
  }

  // Modal Guida Inserimento Carte
  const setIsInputHelpOpen = (isOpen) => {
    state.isInputHelpOpen = isOpen;
    if (isOpen) {
      el.inputHelpModal.style.display = 'flex';
      el.inputHelpModal.offsetHeight; // force reflow
      el.inputHelpModal.classList.add('active');
    } else {
      el.inputHelpModal.classList.remove('active');
      setTimeout(() => {
        if (!state.isInputHelpOpen) {
          el.inputHelpModal.style.display = 'none';
        }
      }, 300);
    }
  };

  const btnInputHelp = document.getElementById('btn-input-help');
  const btnInputHelpClose = document.getElementById('btn-input-help-close');

  if (btnInputHelp) {
    btnInputHelp.addEventListener('click', () => {
      AudioSynth.playConfirm(true);
      setIsInputHelpOpen(true);
    });
  }

  if (btnInputHelpClose) {
    btnInputHelpClose.addEventListener('click', () => {
      AudioSynth.playConfirm(false);
      setIsInputHelpOpen(false);
    });
  }

  // Toggle audio
  if (el.btnToggleAudio) {
    el.btnToggleAudio.addEventListener('click', () => {
      AudioSynth.isMuted = !AudioSynth.isMuted;
      localStorage.setItem('overunder_muted', AudioSynth.isMuted);
      updateAudioButtonUI();
      if (!AudioSynth.isMuted) {
        AudioSynth.init();
        AudioSynth.playConfirm(true);
      }
    });
  }

  // Click sul timer counter per aprire il pannello selezione durata (solo host)
  if (el.timerCounter) {
    el.timerCounter.addEventListener('click', () => {
      if (!state.isHost) return;
      const panel = el.timerPickerPanel;
      if (!panel) return;
      // Toggle: se è già aperto, chiudilo
      if (panel.style.display !== 'none') {
        closeTimerPicker();
      } else {
        openTimerPicker();
      }
    });
  }

  // Click sulle opzioni del timer picker
  if (el.timerPickerPanel) {
    el.timerPickerPanel.querySelectorAll('.timer-picker-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const dur = parseInt(opt.dataset.duration, 10);
        if (dur && dur !== state.timerDurationMs) {
          applyTimerDuration(dur);
        } else {
          closeTimerPicker();
        }
      });
    });
  }

  // Chiudi pannello timer picker
  if (el.btnTimerPickerClose) {
    el.btnTimerPickerClose.addEventListener('click', () => {
      closeTimerPicker();
    });
  }

  // Entra in Stanza via Link
  const handleJoinRoomLinkSubmit = async () => {
    const name = el.joinNameInput ? el.joinNameInput.value.trim() : '';
    const displayCode = el.joinRoomCodeDisplay ? el.joinRoomCodeDisplay.textContent.trim() : '';
    const code = (state.pendingRoomToJoin || safeSessionStorage.getItem('overunder_pendingRoom') || (displayCode !== '-' ? displayCode : '') || safeSessionStorage.getItem('overunder_roomCode') || '').toUpperCase().trim();
    
    console.log('[INVITE] handleJoinRoomLinkSubmit - name:', name, 'code:', code, 'pendingRoom:', state.pendingRoomToJoin, 'displayCode:', displayCode);
    
    if (!name) {
      showError("Inserisci il tuo nome!");
      return;
    }
    if (!code || code === '-') {
      console.error('[INVITE] Codice stanza non valido! code:', code);
      showError("Codice stanza non valido!");
      return;
    }

    try {
      AudioSynth.init();
    } catch (e) {
      console.warn("AudioSynth init non riuscito:", e);
    }
    
    safeSessionStorage.setItem('overunder_playerName', name);
    safeSessionStorage.setItem('overunder_roomCode', code);
    safeSessionStorage.setItem('overunder_isHost', 'false');
    
    startConnectionLoading('join');

    state.pendingSocketAction = {
      type: 'join_room',
      data: { avatar: state.playerAvatarUrl, deviceId: getStoredDeviceId() }
    };

    try {
      console.log('[INVITE] Chiamata authenticateGuest per room:', code, 'player:', name);
      const token = await authenticateGuest(code, name);
      console.log('[INVITE] authenticateGuest OK, token ricevuto');
      safeSessionStorage.setItem('overunder_token', token);
      safeStorage.setItem('overunder_token', token);
      executePendingSocketAction();
    } catch (err) {
      console.error('[INVITE] Errore join:', err.message, err);
      if (state.connectionTimeout) {
        clearTimeout(state.connectionTimeout);
        state.connectionTimeout = null;
      }
      state.connectionLoadingActive = false;
      handleConnectionError('not_found');
      showError(err.message || "Impossibile accedere alla stanza.");
      state.pendingSocketAction = null;
    }
  };

  if (el.btnJoinRoomLink) {
    el.btnJoinRoomLink.addEventListener('click', handleJoinRoomLinkSubmit);
  }
  if (el.joinNameInput) {
    el.joinNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleJoinRoomLinkSubmit();
      }
    });
  }

  // Annulla ingresso via Link
  if (el.btnCancelJoinLink) {
    el.btnCancelJoinLink.addEventListener('click', () => {
      try { AudioSynth.playConfirm(false); } catch (e) {}
      resetFromJoinLink();
      showScreen(el.screenWelcome);
    });
  }

  // Torna a Benvenuto da Onboarding
  if (el.btnBackOnboarding) {
    el.btnBackOnboarding.addEventListener('click', () => {
      AudioSynth.playConfirm(false);
      showScreen(el.screenWelcome);
    });
  }

  // Home buttons per schermate kicked/room full/loading
  // FIX: Reset totale dello stato per evitare loop infiniti sulla schermata di errore
  const fullResetAndGoHome = () => {
    AudioSynth.playConfirm(false);
    // 1. Disattiva lo stato di connessione attivo e cancella i timer pendenti
    state.connectionLoadingActive = false;
    if (state.connectionTimeout) {
      clearTimeout(state.connectionTimeout);
      state.connectionTimeout = null;
    }
    state.connectionStartTime = null;
    // 2. Pulisce pendingRoom da stato e storage
    state.pendingRoomToJoin = null;
    safeSessionStorage.removeItem('overunder_pendingRoom');
    try { localStorage.removeItem('overunder_pendingRoom'); } catch (e) {}
    // 3. Pulisce parametri URL residui (?room=..., /join/...)
    try {
      if (window.history && window.history.replaceState) {
        const cleanUrl = window.location.protocol + '//' + window.location.host + '/';
        window.history.replaceState({}, document.title, cleanUrl);
      }
    } catch (e) {}
    // 4. Disconnette e riconnette il socket per evitare eventi pendenti
    if (socket && socket.connected) {
      try { socket.emit('leave_room'); } catch (e) {}
      try { socket.disconnect(); socket.connect(); } catch (e) {}
    }
    // 5. Reset completo della sessione e ritorno al menu
    clearSession();
    resetToMenu();
  };

  if (el.btnKickedHome) {
    el.btnKickedHome.addEventListener('click', fullResetAndGoHome);
  }

  if (el.btnRoomFullHome) {
    el.btnRoomFullHome.addEventListener('click', fullResetAndGoHome);
  }

  if (el.btnLoadingHome) {
    el.btnLoadingHome.addEventListener('click', fullResetAndGoHome);
  }

  // Chiusura del menu contestuale cliccando fuori
  document.addEventListener('click', (e) => {
    if (el.kickContextMenu && !el.kickContextMenu.contains(e.target)) {
      el.kickContextMenu.style.display = 'none';
    }
  });

  // Azioni del Context Menu per Espulsione Giocatore
  if (el.btnKickPlayer) {
    el.btnKickPlayer.addEventListener('click', () => {
      if (state.playerToKick) {
        AudioSynth.playConfirm(false);
        socket.emit('kick_player', { playerId: state.playerToKick.id, sessionId: state.playerToKick.sessionId, name: state.playerToKick.name });
        state.playerToKick = null;
      }
      if (el.kickContextMenu) el.kickContextMenu.style.display = 'none';
    });
  }

  if (el.btnCancelKick) {
    el.btnCancelKick.addEventListener('click', () => {
      AudioSynth.playConfirm(true);
      state.playerToKick = null;
      if (el.kickContextMenu) el.kickContextMenu.style.display = 'none';
    });
  }
}

function showError(msg) {
  el.nameErrorMsg.textContent = msg;
  el.nameErrorMsg.style.display = 'block';
}

/**
 * Gestione Coda Azioni Socket (Socket Ready Queue).
 * Esegue tempestivamente la richiesta di creazione/ingresso stanza non appena il socket
 * è connesso ed autenticato, prevenendo blocchi o tempi morti.
 */
function executePendingSocketAction() {
  if (!state.pendingSocketAction) return;

  if (!socket.connected) {
    console.log("[SOCKET QUEUE] Socket non ancora connesso. Avvio socket.connect()...");
    socket.connect();
    return;
  }

  const token = safeSessionStorage.getItem('overunder_token');
  if (token && (!state.socketAuthenticated || state.authenticatedToken !== token)) {
    console.log("[SOCKET QUEUE] Socket connesso: invio token AUTH e attendo AUTH_SUCCESS...");
    state.socketAuthenticated = false;
    socket.emit('AUTH', { token });
    return;
  }

  const action = state.pendingSocketAction;
  console.log("[SOCKET QUEUE] Esecuzione immediata dell'azione in coda:", action.type);
  state.pendingSocketAction = null;

  if (action.type === 'create_room') {
    socket.emit('create_room', action.data);
  } else if (action.type === 'join_room') {
    socket.emit('join_room', action.data);
  }
}

// ==========================================================================
// RICEZIONE DEGLI EVENTI DI RETE (SOCKET.IO LISTENERS)
// ==========================================================================
function setupSocketListeners() {
  socket.on('connect', () => {
    console.log("Connesso al server. ID Socket:", socket.id);
    state.socketAuthenticated = false;

    const savedToken = getStoredAuthToken();
    if (savedToken) {
      console.log('[SOCKET] connect: invio AUTH con token salvato');
      state.authenticatedToken = savedToken;
      socket.emit('AUTH', { token: savedToken });
    } else if (state.pendingSocketAction) {
      executePendingSocketAction();
    }
  });

  socket.on('connect_error', (err) => {
    console.warn("[SOCKET] Errore di connessione:", err.message);
  });

  socket.on('disconnect', (reason) => {
    console.warn("[SOCKET] Socket disconnesso:", reason);
    state.socketAuthenticated = false;
    // NOTA: NON azzerare authenticatedToken, il token è persistente nel localStorage
  });

  socket.on('AUTH_SUCCESS', () => {
    state.socketAuthenticated = true;
    const savedToken = getStoredAuthToken();
    if (savedToken) {
      state.authenticatedToken = savedToken;
    }
    console.log("Socket autenticato con successo!");
    updatePremiumUI();

    if (state.pendingSocketAction) {
      executePendingSocketAction();
      return;
    }

    // Se il gioco è già terminato (schermata finale visibile), non tentare la riconnessione alla stanza
    if (state.gameEnded) {
      console.log('[AUTH_SUCCESS] Game already ended, skipping room reconnection.');
      return;
    }

    // 1. Identità Persistente (Client-Side): Controlla localStorage per la riconnessione automatica prima di chiedere nome o PIN
    const savedSession = getSavedRoomSession();
    const savedRoom = savedSession ? savedSession.roomCode : safeSessionStorage.getItem('overunder_roomCode');
    const savedName = savedSession ? savedSession.playerName : safeSessionStorage.getItem('overunder_playerName');
    const savedHost = savedSession ? savedSession.isHost : (safeSessionStorage.getItem('overunder_isHost') === 'true');

    if (savedRoom && (savedSession || savedName)) {
      console.log("[RECONNECT] Trovata sessione recente nel localStorage, invio payload di riconnessione:", { savedRoom, savedName });
      const isInActiveGame = el.screenLobby.classList.contains('active') || 
                             el.screenGameplay.classList.contains('active') || 
                             el.screenResults.classList.contains('active');
      if (!isInActiveGame) {
        startConnectionLoading('restore');
      }
      socket.emit('reconnect_room', {
        type: 'reconnect',
        roomCode: savedRoom,
        playerId: (savedSession && savedSession.playerId) || playerId,
        playerName: savedName,
        isHost: savedHost,
        sessionId: sessionId,
        deviceId: getStoredDeviceId()
      });
    }
  });

  socket.on('AUTH_ERROR', ({ error }) => {
    console.error("Autenticazione socket fallita:", error);
    state.socketAuthenticated = false;
    state.pendingSocketAction = null;
    clearSession();
    resetToMenu();
    showError("Errore di sessione: " + error);
  });

  // Evento di riconnessione fallita
  socket.on('reconnect_failed', ({ message }) => {
    console.warn("Riconnessione fallita:", message);
    if (state.connectionTimeout) {
      clearTimeout(state.connectionTimeout);
      state.connectionTimeout = null;
    }
    state.connectionLoadingActive = false;
    // Se il gioco è già terminato, pulisci silenziosamente senza messaggi bloccanti
    if (state.gameEnded) {
      console.log('[RECONNECT_FAILED] Game already ended, silent cleanup.');
      clearSession();
      // Non chiamare resetToMenu() se siamo sulla schermata di summary/risultati
      const isOnSummary = el.screenSummary && el.screenSummary.classList.contains('active');
      if (!isOnSummary) resetToMenu();
      return;
    }
    clearSession();
    resetToMenu();
  });

  // Sessione non ripristinabile (stanza chiusa o server riavviato)
  socket.on('session_failed', (message) => {
    console.log("Ripristino sessione fallito:", message);
    if (state.connectionTimeout) {
      clearTimeout(state.connectionTimeout);
      state.connectionTimeout = null;
    }
    state.connectionLoadingActive = false;
    // Se il gioco è già terminato, non mostrare avvisi bloccanti
    if (state.gameEnded) {
      console.log('[SESSION_FAILED] Game already ended, silent cleanup.');
      clearSession();
      const isOnSummary = el.screenSummary && el.screenSummary.classList.contains('active');
      if (!isOnSummary) resetToMenu();
      return;
    }
    clearSession();
    resetToMenu();
  });

  // ==========================================================================
  // 3. STATE RECOVERY (Sincronizzazione dello Stato Client-Side)
  // ==========================================================================
  const handleStateSyncPayload = (payload) => {
    if (state.connectionTimeout) {
      clearTimeout(state.connectionTimeout);
      state.connectionTimeout = null;
    }
    state.connectionLoadingActive = false;

    // Se lo splash screen è ancora visibile, nascondilo subito
    if (el.screenSplash && el.screenSplash.style.display !== 'none') {
      el.screenSplash.style.display = 'none';
      el.screenSplash.classList.remove('active', 'fade-out');
    }

    const roomState = payload.status || payload.state || payload.currentScreen;
    const roomCode = payload.roomCode;
    const players = payload.players || [];
    const isHost = payload.isHost;
    const isPremium = payload.isPremium;
    const isLocked = payload.isLocked;
    const gameData = payload.gameData || {};
    const assignedName = payload.assignedName || safeSessionStorage.getItem('overunder_playerName');

    console.log("[STATE RECOVERY] Sincronizzazione stato della stanza:", { roomState, roomCode, assignedName });

    state.isHost = !!isHost;
    state.roomCode = roomCode;
    state.players = players;
    state.playerName = assignedName || state.playerName;
    state.roomIsPremium = !!isPremium;
    state.roomIsLocked = !!isLocked;
    state.currentRoundId = gameData.roundId || 0;
    state.gameplayStarted = (roomState === 'playing' || roomState === 'results' || roomState === 'summary');
    
    // Aggiorna sessione persistente nel localStorage
    saveRoomSession(roomCode, state.playerName, state.isHost, state.playerAvatarUrl);
    updateLockIcon();

    const myPlayer = players.find(p => p.name === state.playerName);
    state.hasSubmittedPremiumCards = myPlayer ? !!myPlayer.premiumReady : false;
    if (!Array.isArray(state.localPremiumCards)) {
      state.localPremiumCards = [];
    }

    // Forzatura rendering della schermata corretta in base al tipo di stato
    if (roomState === 'lobby' || roomState === 'card_submission') {
      setupLobbyUI();
    } else if (roomState === 'playing') {
      state.currentDeckName = gameData.deckName || 'OVER / UNDER';
      state.totalCards = gameData.totalCards || 0;
      state.currentPromptText = gameData.prompt || '';
      state.currentCardDescription = gameData.description || null;
      
      const isNewCardIndex = (state.currentCardIndex !== gameData.cardIndex);
      state.currentCardIndex = gameData.cardIndex || 0;
      
      if (isNewCardIndex) {
        clearWatchdog();
        state.userHasVoted = false;
        state.roundEndActive = false;
        if (el.roundEndOverlay) el.roundEndOverlay.classList.remove('active');
        if (el.roundEndOverlayVoteActions) el.roundEndOverlayVoteActions.style.display = 'none';
      } else {
        state.userHasVoted = !!gameData.userHasVoted;
      }

      if (el.currentDeckName) el.currentDeckName.textContent = state.currentDeckName;
      updateGameplayCardMedia(gameData.prompt, gameData.image);
      
      const totalDisplay = (state.totalCards == 9999 || state.totalCards === '∞') ? '∞' : state.totalCards;
      if (el.deckProgress) el.deckProgress.textContent = `Carta ${state.currentCardIndex + 1} / ${totalDisplay}`;
      
      renderGameplayPlayersStatus(gameData.votedPlayers || []);
      
      if (state.userHasVoted) {
        if (el.btnUnderrated) el.btnUnderrated.classList.add('disabled');
        if (el.btnOverrated) el.btnOverrated.classList.add('disabled');
      } else {
        if (el.btnUnderrated) el.btnUnderrated.classList.remove('disabled', 'pulse-active');
        if (el.btnOverrated) el.btnOverrated.classList.remove('disabled', 'pulse-active');
      }

      // Sincronizza timer locale
      const elapsed = Date.now() - (gameData.roundStartTime || Date.now());
      state.lastTickElapsed = elapsed;
      state.timerStartTime = Date.now() - elapsed;
      state.timerDurationMs = gameData.timerDurationMs || 10000;
      
      if (state.timerRequestId) {
        cancelAnimationFrame(state.timerRequestId);
      }
      state.timerRequestId = requestAnimationFrame(gameLoop);
      
      showScreen(el.screenGameplay);
    } else if (roomState === 'results') {
      if (gameData.results) renderRoundResults(gameData.results);
      else showScreen(el.screenResults);
    } else if (roomState === 'summary') {
      if (gameData.summary) renderGameOver(gameData.summary);
      else showScreen(el.screenSummary);
    }
  };

  socket.on('sync_state', handleStateSyncPayload);
  socket.on('session_restored', handleStateSyncPayload);

  socket.on('room_lock_status', ({ isLocked }) => {
    state.roomIsLocked = !!isLocked;
    updateLockIcon();
    showToast(isLocked ? "Stanza bloccata dall'Host 🔒" : "Stanza sbloccata 🔓");
  });

  // 1. Stanza creata con successo (Host)
  socket.on('room_created', ({ roomCode, players, isPremium, assignedName }) => {
    if (state.connectionTimeout) {
      clearTimeout(state.connectionTimeout);
      state.connectionTimeout = null;
    }
    state.connectionLoadingActive = false;

    state.isHost = true;
    state.isSoloMode = false;
    state.gameMode = 'multiplayer';
    state.roomCode = roomCode;
    state.players = players;
    state.playerName = assignedName || players[0].name;
    state.roomIsPremium = !!isPremium;
    state.roomIsLocked = false;
    state.gameplayStarted = false;
    state.gameEnded = false;
    state.hasSubmittedPremiumCards = false;
    state.localPremiumCards = [];

    saveRoomSession(roomCode, state.playerName, true, state.playerAvatarUrl);

    setupLobbyUI();
    updateLockIcon();
  });

  // 2. Ingresso in Stanza riuscito (Player o Host riconnesso)
  socket.on('room_joined', ({ roomCode, players, isPremium, isHost, assignedName, isLocked }) => {
    if (state.connectionTimeout) {
      clearTimeout(state.connectionTimeout);
      state.connectionTimeout = null;
    }
    state.connectionLoadingActive = false;

    if (Array.isArray(players)) {
      sanitizeClientHostUnicity(players);
      state.players = players;
    }

    const me = players ? players.find(p => p.id === socket.id || (p.name && p.name.toLowerCase() === (assignedName || state.playerName || '').toLowerCase())) : null;
    state.isHost = (typeof isHost === 'boolean') ? isHost : (me ? !!me.isHost : false);
    state.isSoloMode = false;
    state.gameMode = 'multiplayer';
    state.roomCode = roomCode;
    state.playerName = assignedName || (me ? me.name : safeSessionStorage.getItem('overunder_playerName')) || 'Giocatore';
    state.roomIsPremium = !!isPremium;
    state.roomIsLocked = !!isLocked;
    state.gameplayStarted = false;
    state.gameEnded = false;
    state.hasSubmittedPremiumCards = false;
    state.localPremiumCards = [];

    saveRoomSession(roomCode, state.playerName, state.isHost, state.playerAvatarUrl);

    setupLobbyUI();
    updateLockIcon();
  });

  // 3. Errore durante onboarding (Richiede acquisto o ripristino Premium)
  socket.on('trial_expired_error', ({ message }) => {
    // BLOCK CRITICO: Se l'utente è GIÀ in una stanza Premium (come partecipante),
    // ignora completamente l'evento. I partecipanti ereditano lo sblocco dall'Host.
    if (isUserInActiveRoom()) {
      console.warn('[PAYWALL BLOCK] trial_expired_error ignorato: utente in stanza attiva.');
      return;
    }
    if (state.connectionLoadingActive) {
      if (state.connectionTimeout) {
        clearTimeout(state.connectionTimeout);
        state.connectionTimeout = null;
      }
      state.connectionLoadingActive = false;
    }
    showScreen(el.screenWelcome);
    state.roomIsPremium = false;
    if (el.createPremiumToggle) {
      el.createPremiumToggle.checked = false;
    }
    if (el.nameErrorMsg) {
      el.nameErrorMsg.style.display = 'none';
      el.nameErrorMsg.textContent = '';
    }
    showPurchaseModal();
  });

  // Gestione Errore Licenza Inattiva / Non Trovata (NO_LICENSE_FOUND / LICENSE_INACTIVE)
  socket.on('license_error', (data) => {
    console.warn('[LICENSE] Errore licenza dal server:', data);
    state.connectionLoadingActive = false;
    if (state.connectionTimeout) {
      clearTimeout(state.connectionTimeout);
      state.connectionTimeout = null;
    }
    state.pendingSocketAction = null;
    state.roomCode = '';
    state.roomIsPremium = false;
    safeStorage.removeItem('overunder_premium_unlocked');
    safeStorage.removeItem('overunder_judgement_purchased');
    if (el.createPremiumToggle) {
      el.createPremiumToggle.checked = false;
    }
    updatePremiumUI();

    if (el.screenLoading && el.screenLoading.classList.contains('active')) {
      showScreen(el.screenOnboarding);
    }

    const msg = (data && data.message) ? data.message : "Nessuna licenza Judgement Day attiva trovata per questo dispositivo.";
    showToast(`👑 ${msg}`, 5000);
    showPurchaseModal();
  });

  // Gestione Errore Licenza Trasferita su altro dispositivo (Accesso Esclusivo)
  socket.on('license_transferred_error', (data) => {
    console.warn('[LICENSE] Licenza trasferita su un altro dispositivo:', data);
    state.connectionLoadingActive = false;
    if (state.connectionTimeout) {
      clearTimeout(state.connectionTimeout);
      state.connectionTimeout = null;
    }
    state.pendingSocketAction = null;
    state.roomCode = '';
    state.roomIsPremium = false;
    safeStorage.removeItem('overunder_premium_unlocked');
    safeStorage.removeItem('overunder_judgement_purchased');
    if (el.createPremiumToggle) {
      el.createPremiumToggle.checked = false;
    }
    updatePremiumUI();

    if (el.screenLoading && el.screenLoading.classList.contains('active')) {
      showScreen(el.screenOnboarding);
    }

    const msg = data && data.message ? data.message : "Licenza trasferita su un altro dispositivo. Effettua nuovamente l'accesso con la tua email.";
    showToast(`⚠️ ${msg}`, 6000);
    openTransferModal('transferred');
  });

  socket.on('room_error', (message) => {
    const isLicenseMsg = typeof message === 'string' && (
      message.toLowerCase().includes('licenza') ||
      message.toLowerCase().includes('judgement') ||
      message.toLowerCase().includes('gogna')
    );

    if (isLicenseMsg) {
      console.warn('[ROOM_ERROR INTERCEPT] Errore relativo a licenza:', message);
      state.connectionLoadingActive = false;
      if (state.connectionTimeout) {
        clearTimeout(state.connectionTimeout);
        state.connectionTimeout = null;
      }
      state.pendingSocketAction = null;
      state.roomIsPremium = false;
      if (el.createPremiumToggle) {
        el.createPremiumToggle.checked = false;
      }
      updatePremiumUI();
      if (el.screenLoading && el.screenLoading.classList.contains('active')) {
        showScreen(el.screenOnboarding);
      }
      showToast(`👑 ${message}`, 5000);
      showPurchaseModal();
      return;
    }

    if (state.connectionLoadingActive) {
      clearTimeout(state.connectionTimeout);
      state.connectionLoadingActive = false;
      
      let reason = 'not_found';
      if (message.includes("bloccata")) {
        reason = 'locked';
      } else if (message.includes("piena") || message.includes("completo")) {
        reason = 'full';
      } else if (message.includes("esistente") || message.includes("trovata")) {
        reason = 'not_found';
      }
      handleConnectionError(reason);
    }
    showError(message);
    showToast(message, 5000);
  });

  // 4. Aggiornamento lista partecipanti lobby e stato host dinamico con Unicità Host
  socket.on('player_list_update', ({ players }) => {
    if (!Array.isArray(players)) return;
    
    // Controllo client-side dell'unicità dell'Host
    sanitizeClientHostUnicity(players);
    state.players = players;
    
    // Rileva dinamicamente se siamo diventati Host
    const me = players.find(p => p.id === socket.id || (state.playerName && p.name.toLowerCase() === state.playerName.toLowerCase()));
    if (me) {
      const wasHost = state.isHost;
      state.isHost = !!me.isHost;
      safeSessionStorage.setItem('overunder_isHost', state.isHost ? 'true' : 'false');
      
      if (state.isHost && !wasHost) {
        showToast("👑 Sei diventato l'Host della stanza!");
        if (el.screenLobby.classList.contains('active')) {
          setupLobbyUI();
        } else if (el.screenGameplay.classList.contains('active')) {
          if (state.roundEndActive) {
            if (el.btnNextOverlay) el.btnNextOverlay.style.display = 'block';
            if (el.roundEndPlayerWait) el.roundEndPlayerWait.style.display = 'none';
          }
        }
      } else if (!state.isHost && wasHost) {
        if (el.screenLobby.classList.contains('active')) {
          setupLobbyUI();
        }
      }
    }
    
    renderLobbyPlayers();
    renderGameplayAvatars();
    if (state.isPlayerListOpen) {
      renderPlayerListModalContent();
    }
  });

  // 4a-bis. Alias room_players_update (doppio canale server per sicurezza anti-desync)
  socket.on('room_players_update', ({ players }) => {
    if (!Array.isArray(players)) return;
    sanitizeClientHostUnicity(players);
    state.players = players;

    const me = players.find(p => p.id === socket.id || (state.playerName && p.name.toLowerCase() === state.playerName.toLowerCase()));
    if (me) {
      state.isHost = !!me.isHost;
      safeSessionStorage.setItem('overunder_isHost', state.isHost ? 'true' : 'false');
      // Se il server ha confermato il nostro premiumReady, aggiorna lo stato locale
      if (me.premiumReady && !state.hasSubmittedPremiumCards) {
        state.hasSubmittedPremiumCards = true;
        console.log('[ROOM_PLAYERS_UPDATE] premiumReady confermato dal server per il giocatore locale.');
        if (el.screenLobby && el.screenLobby.classList.contains('active')) {
          setupLobbyUI();
        }
      }
    }

    renderLobbyPlayers();
    renderGameplayAvatars();
    if (state.isPlayerListOpen) {
      renderPlayerListModalContent();
    }
  });

  // 4a-ter. ACK esplicito ricezione carte dal server (Judgement Day)
  const handleCardsAcknowledged = ({ cardsCount, premiumReady, playerName }) => {
    console.log(`[CARDS ACK] Server ha confermato ricezione carte. Totale mazzo: ${cardsCount}, premiumReady: ${premiumReady}, player: ${playerName}`);
    state.hasSubmittedPremiumCards = true;
    if (state._premiumCardsAckTimeout) {
      clearTimeout(state._premiumCardsAckTimeout);
      state._premiumCardsAckTimeout = null;
    }
    const count = cardsCount || (state.localPremiumCards ? state.localPremiumCards.length : 1);
    showToast(`✅ ${count} ${count === 1 ? 'carta inviata' : 'carte inviate'}!`, 2000);
    if (el.screenLobby && el.screenLobby.classList.contains('active')) {
      setupLobbyUI();
    }
    renderLobbyPlayers();
  };

  socket.on('cards_received_success', handleCardsAcknowledged);
  socket.on('premium_cards_acknowledged', handleCardsAcknowledged);

  // 4a. Sincronizzazione Rigorosa dello Stato Stanza (Validazione Server-Client)
  socket.on('room_state_update', ({ roomCode, state: roomState, players, hostId, hostName, isLocked, isPremium }) => {
    if (!Array.isArray(players)) return;
    sanitizeClientHostUnicity(players, hostId);
    state.players = players;
    if (typeof isLocked === 'boolean') state.roomIsLocked = isLocked;
    if (typeof isPremium === 'boolean') state.roomIsPremium = isPremium;

    const me = players.find(p => p.id === socket.id || (state.playerName && p.name.toLowerCase() === state.playerName.toLowerCase()));
    if (me) {
      state.isHost = !!me.isHost;
      safeSessionStorage.setItem('overunder_isHost', state.isHost ? 'true' : 'false');
    }

    renderLobbyPlayers();
    renderGameplayAvatars();
    updateLockIcon();
  });

  // 4b. Evento cambio Host
  socket.on('host_changed', ({ newHostId, newHostName }) => {
    console.log(`[HOST CHANGED] Nuovo Host nella stanza: ${newHostName} (${newHostId})`);
    if (newHostId === socket.id || (state.playerName && state.playerName.toLowerCase() === (newHostName || '').toLowerCase())) {
      state.isHost = true;
      safeSessionStorage.setItem('overunder_isHost', 'true');
      showToast("👑 Sei il nuovo Host della stanza!");
    } else {
      state.isHost = false;
      safeSessionStorage.setItem('overunder_isHost', 'false');
      showToast(`👑 ${newHostName} è il nuovo Host della stanza.`);
    }
    if (el.screenLobby && el.screenLobby.classList.contains('active')) {
      setupLobbyUI();
    }
  });

  // 4c. Notifiche Grace Period Host
  socket.on('host_reconnecting', ({ hostName, timeoutSeconds }) => {
    showToast(`⏳ ${hostName} (Host) in riconnessione (${timeoutSeconds}s)...`, 4000);
  });

  // 5. Partita Avviata
  socket.on('game_started', ({ deckName, totalCards, imageUrls }) => {
    state.isSoloMode = false;
    state.gameMode = 'multiplayer';
    state.currentDeckName = deckName;
    state.totalCards = totalCards;
    state.gameplayStarted = true;
    state._victorySoundPlayed = false;
    updateLockIcon();
    
    // Suono chime iniziale
    AudioSynth.playConfirm(true);

    if (state.roomIsPremium) {
      showToast(`${totalCards} carte aggiunte`);
    }

    // PRELOADING: Pre-carica tutte le immagini del mazzo prima dell'inizio del round
    if (imageUrls && Array.isArray(imageUrls)) {
      preloadDeckImages(imageUrls);
    }

    showScreen(el.screenGameplay);
  });

  // 6. Nuova Carta Inviata dal Server (con validazione anti-corruzione e buffer Base64)
  socket.on('new_card', ({ prompt, text, image, ownerId, description, cardIndex, totalCards, roundId, timerDurationMs }) => {
    clearWatchdog();

    state.isSoloMode = false;
    state.gameMode = 'multiplayer';

    const safePrompt = prompt || text || '';
    const safeImage = isValidImageString(image) ? image : null;

    // GUARD CHECK SU UNDEFINED
    if (!safePrompt && !safeImage && cardIndex === undefined) {
      console.warn("[GUARD CHECK UNDEFINED] Carta ricevuta undefined in multiplayer. Avvio richiesta recupero al server.");
      requestCardRecoveryFromServer();
      return;
    }

    state.currentPromptText = safePrompt;
    state.currentCardDescription = description || null;
    state.currentCardIndex = cardIndex;
    state.currentCardOwnerId = ownerId || null;
    state.userHasVoted = false;
    state.roundEndActive = false;
    state.currentRoundId = roundId || 0;

    // Aggiorna la durata timer se il server la specifica (supporto cambio timer mid-game)
    if (timerDurationMs) {
      state.timerDurationMs = timerDurationMs;
      updateTimerPickerSelection();
    }

    // Reset overlay
    if (el.roundEndOverlay) el.roundEndOverlay.classList.remove('active');
    if (el.roundEndOverlayVoteActions) el.roundEndOverlayVoteActions.style.display = 'none';
    
    // Auto-Recovery IMMEDIATO dei bottoni OVER e UNDER per la nuova carta
    if (el.btnUnderrated) el.btnUnderrated.classList.remove('disabled', 'pulse-active');
    if (el.btnOverrated) el.btnOverrated.classList.remove('disabled', 'pulse-active');
    
    // Reset interfaccia gameplay
    if (el.currentDeckName) el.currentDeckName.textContent = state.currentDeckName;
    updateGameplayCardMedia(safePrompt, image);
    const totalDisplay = (totalCards == 9999 || totalCards === '∞') ? '∞' : totalCards;
    if (el.deckProgress) el.deckProgress.textContent = `Carta ${cardIndex + 1} / ${totalDisplay}`;
    
    // Reset colore e ombra
    if (el.timerBar) {
      el.timerBar.style.background = 'hsl(145, 80%, 50%)';
      el.timerBar.style.boxShadow = '0 0 12px hsl(145, 80%, 50%)';
    }
    
    // Mostra il pannello votazioni gruppo in multiplayer
    if (el.gameplayStatusPanel) el.gameplayStatusPanel.style.display = 'block';
    if (el.gameplayAvatarsWrapper) {
      el.gameplayAvatarsWrapper.style.display = 'flex';
    }

    // Inizializza stato votazione gruppo (tutti a "sta pensando")
    renderGameplayPlayersStatus([]);

    // Transizione alla schermata di gioco
    showScreen(el.screenGameplay);

    // Avvia Timer Locale sincronizzato
    state.lastTickElapsed = 0;
    state.timerStartTime = Date.now();
    
    if (state.timerRequestId) {
      cancelAnimationFrame(state.timerRequestId);
    }
    state.timerRequestId = requestAnimationFrame(gameLoop);
  });

  // 6b. Ripristino carta da Server (Fallback Recovery trasparente)
  socket.on('current_card_recovery', ({ prompt, text, image, ownerId, description, cardIndex, totalCards, timerDurationMs }) => {
    console.log('[CARD RECOVERY RECV] Ricevuti dati carta dal server:', { prompt, hasImage: !!image, cardIndex });
    if (cardIndex !== state.currentCardIndex) return; // non nello stesso round
    const promptToUse = prompt || text || '';
    state.currentPromptText = promptToUse;
    if (description) state.currentCardDescription = description;
    if (ownerId) state.currentCardOwnerId = ownerId;
    updateGameplayCardMedia(promptToUse, image);
  });

  // 7. Notifica Voto di un altro utente
  socket.on('player_voted_update', ({ votedPlayers }) => {
    renderGameplayPlayersStatus(votedPlayers);
  });

  // 7c. Cambio durata timer notificato dal server (per tutti i client)
  socket.on('timer_duration_changed', ({ durationMs }) => {
    state.timerDurationMs = durationMs;
    updateTimerPickerSelection();
    showToast(`Timer: ${durationMs / 1000}s dalla prossima carta ⏱`);
  });

  // 7b. Ricezione Fine Tempo (Compare l'Overlay "PROSSIMA CARTA...")
  socket.on('time_up', ({ votes }) => {
    if (!state.roundEndActive) {
      AudioSynth.playGong();
      state.roundEndActive = true;
    }
    renderRoundEndOverlay(votes);
    checkAndArmWatchdog('time_up');
  });

  // 7c. Aggiornamento Voti in tempo reale nell'Overlay
  socket.on('verdict_update', ({ votes }) => {
    if (state.roundEndActive) {
      renderRoundEndOverlay(votes);
    }
  });

  // 9. Ricezione Risultati del Round
  socket.on('round_results', (data) => {
    state.isSoloMode = false;
    state.gameMode = 'multiplayer';
    renderRoundResults(data);
  });

  // 10. Fine Partita (Riepilogo e Premi del Gruppo)
  socket.on('game_over', (data) => {
    triggerVictorySoundOnce();
    state.isSoloMode = false;
    state.gameMode = 'multiplayer';
    state.gameEnded = true;
    // Pulisci la sessione della stanza ora: la partita è terminata, non serve più la riconnessione
    clearRoomSession();
    renderGameOver(data);
  });

  // 11. Reset del gioco (Host torna in Lobby)
  socket.on('lobby_reset', ({ players }) => {
    state.players = players;
    state._victorySoundPlayed = false;

    if (state.roomIsPremium) {
      state.hasSubmittedPremiumCards = false;
      state.localPremiumCards = [];
      resetPremiumCardInputState();
      renderCapsules();
    }

    state.gameplayStarted = false;
    updateLockIcon();
    setupLobbyUI();
  });

  // Reset Stanza Normale / Torna alla Lobby Classica (anche a seguito di licenza scaduta)
  socket.on('game_reset_default', (data) => {
    // Wipe della chat real-time o commenti
    const chatContainer = document.getElementById('chat-messages');
    if (chatContainer) chatContainer.innerHTML = '';
    
    // Ripristino stati locali
    if (data && data.players) {
      state.players = data.players;
    }
    if (data && data.isPremium !== undefined) {
      state.roomIsPremium = !!data.isPremium;
    } else {
      state.roomIsPremium = false;
    }
    state.currentCardIndex = 0;
    state.userHasVoted = false;
    state.localPremiumCards = [];
    resetPremiumCardInputState();
    state.hasSubmittedPremiumCards = false;

    if (!state.roomIsPremium) {
      if (el.createPremiumToggle) {
        el.createPremiumToggle.checked = false;
      }
    }
    updatePremiumUI();

    // Reset overlay round precedente
    if (el.roundEndOverlay) el.roundEndOverlay.classList.remove('active');
    if (el.roundEndOverlayVoteActions) el.roundEndOverlayVoteActions.style.display = 'none';

    state.gameplayStarted = false;
    updateLockIcon();
    setupLobbyUI();
  });

  // Notifica cambio modalità stanza in tempo reale
  socket.on('room_mode_changed', ({ isPremium }) => {
    state.roomIsPremium = !!isPremium;
    if (el.createPremiumToggle) {
      el.createPremiumToggle.checked = state.roomIsPremium;
    }
    updatePremiumUI();
    setupLobbyUI();
    if (state.roomIsPremium) {
      showToast("👑 Modalità Judgement Day attivata per la stanza!");
    } else {
      showToast("🎮 Modalità Classica attivata per la stanza.");
    }
  });

  // Reset Modalità Gogna
  socket.on('game_reset_gogna', ({ players }) => {
    state.players = players;
    state.hasSubmittedPremiumCards = false;
    state.localPremiumCards = [];

    // Wipe della chat real-time o commenti
    const chatContainer = document.getElementById('chat-messages');
    if (chatContainer) chatContainer.innerHTML = '';

    // Ripristina input mazzo
    resetPremiumCardInputState();
    renderCapsules();

    // Reset overlay round precedente
    el.roundEndOverlay.classList.remove('active');
    el.roundEndOverlayVoteActions.style.display = 'none';

    state.gameplayStarted = false;
    updateLockIcon();
    setupLobbyUI();
  });

  // 11b. Ricezione Notifiche di Sistema (Toast)
  socket.on('toast_message', ({ message }) => {
    showToast(message);
  });

  // 12. Host riassegnato o disconnesso
  socket.on('host_assigned', ({ isHost }) => {
    state.isHost = !!isHost;
    safeSessionStorage.setItem('overunder_isHost', isHost ? 'true' : 'false');
    showToast("👑 Ora sei tu il nuovo Host della stanza!", 5000);
    if (!state.gameplayStarted) {
      setupLobbyUI();
    }
  });

  socket.on('room_closed', (message) => {
    // Se il gioco è già terminato (siamo sulla schermata dei risultati), non interrompere il flusso
    if (state.gameEnded) {
      console.log('[ROOM_CLOSED] Game already ended, silent cleanup only.');
      clearSession();
      // Mostra un toast leggero e non bloccante
      showToast("La stanza è stata chiusa. Tornerai al menù.", 3000);
      return;
    }
    showToast(message || "L'Host si è disconnesso. Partita terminata.", 6000);
    setTimeout(() => {
      clearSession();
      resetToMenu();
    }, 2000);
  });

  socket.on('auth_completed', () => {
    if (state.connectionLoadingActive) {
      updateLoadingText("Quasi pronto...");
    }
  });

  socket.on('room_lock_update', ({ isLocked }) => {
    state.roomIsLocked = !!isLocked;
    updateLockIcon();
  });

  socket.on('global_toast', ({ message }) => {
    showToast(message);
  });

  socket.on('room_full', () => {
    showToast("🔥 Stanza al completo! (30/30 giocatori)");
  });

  socket.on('room_full_error', () => {
    if (state.connectionLoadingActive) {
      clearTimeout(state.connectionTimeout);
      state.connectionLoadingActive = false;
      handleConnectionError('full');
    } else {
      showScreen(el.screenRoomFull);
    }
  });

  socket.on('kicked_from_room', (data) => {
    if (state.connectionTimeout) {
      clearTimeout(state.connectionTimeout);
      state.connectionTimeout = null;
    }
    state.connectionLoadingActive = false;
    clearSession();

    const kickMsg = (data && data.message) || "Non fai più parte della sessione";
    const kickedTitleEl = document.getElementById('kicked-title-text');
    const kickedDescEl = document.getElementById('kicked-reason-text');
    if (kickedTitleEl) kickedTitleEl.textContent = "Non fai più parte della sessione";
    if (kickedDescEl) kickedDescEl.textContent = kickMsg;

    showToast(kickMsg, 5000);
    showScreen(el.screenKicked);
  });

  // Se abbiamo già un token salvato in sessione, connettiamo il socket per il ripristino
  const savedToken = sessionStorage.getItem('overunder_token');
  if (savedToken) {
    socket.connect();
  }
}

/**
 * Helper client-side di sicurezza: Valida l'unicità dell'Host nell'array dei giocatori.
 * Garantisce che esattamente un solo elemento abbia isHost: true.
 */
function sanitizeClientHostUnicity(players, officialHostId = null) {
  if (!Array.isArray(players) || players.length === 0) return;
  
  let hostIdx = -1;
  if (officialHostId) {
    hostIdx = players.findIndex(p => p.id === officialHostId);
  }
  if (hostIdx === -1) {
    hostIdx = players.findIndex(p => p.isHost);
  }
  if (hostIdx === -1) {
    hostIdx = 0;
  }
  
  players.forEach((p, idx) => {
    p.isHost = (idx === hostIdx);
  });
}

/**
 * Pre-carica tutte le immagini del mazzo in memoria prima dell'inizio del gioco.
 * Questo garantisce visualizzazione istantanea e zero schermate nere su qualsiasi dispositivo (iOS/Safari inclusi).
 */
function preloadDeckImages(imageUrls) {
  if (!Array.isArray(imageUrls)) return;
  let loaded = 0;
  const total = imageUrls.filter(u => u && typeof u === 'string' && u.length > 5).length;
  imageUrls.forEach(url => {
    if (url && typeof url === 'string' && url.length > 5) {
      const img = new Image();
      img.onload = () => {
        loaded++;
        if (loaded === total) {
          console.log(`[PRELOAD] Tutte le ${total} immagini del mazzo pre-caricate con successo.`);
        }
      };
      img.onerror = () => {
        loaded++;
        console.warn(`[PRELOAD] Errore nel pre-caricamento dell'immagine: ${url.substring(0, 80)}...`);
      };
      img.src = url;
    }
  });
  if (total > 0) {
    console.log(`[PRELOAD] Avviato pre-caricamento di ${total} immagini del mazzo.`);
  }
}

/**
 * Validatore di sicurezza per stringhe immagine (URL HTTP/HTTPS, endpoint /uploads/, Blob o Base64).
 */
function isValidImageString(str) {
  if (!str || typeof str !== 'string') return false;
  const trimmed = str.trim();
  if (trimmed.length < 5) return false;
  if (trimmed.startsWith('data:image/')) {
    return trimmed.includes(';base64,') && trimmed.split(';base64,')[1].length > 10;
  }
  if (trimmed.startsWith('/uploads/') || trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('blob:')) {
    return true;
  }
  return false;
}

let _cardRecoveryRequestedForRound = -1;

/**
 * Meccanismo di recupero carta dal server (Richiesta una tantum per round in caso di errore)
 */
function requestCardRecoveryFromServer() {
  if (!socket || !socket.connected || state.isSoloMode) return;
  const roundKey = state.currentCardIndex !== undefined ? state.currentCardIndex : -1;
  if (_cardRecoveryRequestedForRound === roundKey) return;
  _cardRecoveryRequestedForRound = roundKey;
  console.log(`[CARD RECOVERY] Richiesta ri-sincronizzazione carta al server (indice: ${roundKey})`);
  socket.emit('request_current_card');
}

/**
 * Gestione dinamica dei media delle carte (Premium & Standard).
 * PULIZIA TOTALE PREVENTIVA DEL DOM + LOGICA STRICT:
 * - Se la carta ha un'immagine: mostra ESCLUSIVAMENTE l'immagine a tutto schermo (nascondendo/azzerando qualsiasi testo).
 * - Se la carta ha solo testo: mostra ESCLUSIVAMENTE il testo (nascondendo/azzerando qualsiasi elemento immagine).
 */
function updateGameplayCardMedia(prompt, image) {
  // GUARD CHECK SU UNDEFINED
  if (prompt === undefined && image === undefined) {
    console.warn("[GUARD CHECK UNDEFINED] Carta undefined in updateGameplayCardMedia.");
    if (state.isSoloMode && !state.roomCode) {
      showSinglePlayerResults();
    } else {
      requestCardRecoveryFromServer();
    }
    return;
  }

  const isInfinite = !!state.isInfiniteMode;
  const totalCards = state.isSoloMode ? ((state.soloDeck && state.soloDeck.cards) ? state.soloDeck.cards.length : (state.totalCards || 0)) : (state.totalCards || 0);
  if (state.isSoloMode && state.soloCardIndex >= totalCards && !isInfinite) {
    const promptCard = el.promptCard || document.getElementById('prompt-card');
    if (promptCard) promptCard.innerHTML = '';
    return;
  }

  const promptCard = el.promptCard || document.getElementById('prompt-card');
  const imgContainer = el.gameplayPromptImageContainer || document.getElementById('gameplay-prompt-image-container');
  const imgElement = el.gameplayPromptImage || document.getElementById('gameplay-prompt-image');
  const textElement = el.currentPromptText || document.getElementById('current-prompt-text');
  const deckNameElement = el.currentDeckName || document.getElementById('current-deck-name');

  // =========================================================================
  // 1. RESET TOTALE IMMEDIATO DEL DOM DELLA CARTA (Anti-sovrapposizione & pulizia)
  // =========================================================================
  if (promptCard) {
    promptCard.classList.remove('is-full-image');
    promptCard.style.padding = '';
  }
  if (textElement) {
    textElement.textContent = '';
    textElement.style.display = 'none';
  }
  if (imgElement) {
    imgElement.onerror = null;
    imgElement.onload = null;
    imgElement.src = '';
    imgElement.style.display = 'none';
  }
  if (imgContainer) {
    imgContainer.style.display = 'none';
    imgContainer.style.position = 'relative';
    imgContainer.style.inset = 'auto';
  }
  if (deckNameElement) {
    deckNameElement.style.display = '';
  }

  // Sanitizzazione input
  const validImage = isValidImageString(image) ? image.trim() : null;
  const hasImage = !!validImage;
  const cleanPrompt = (prompt && typeof prompt === 'string') ? prompt.trim() : '';
  const isGenericPrompt = !cleanPrompt || 
                          cleanPrompt === 'Carta Immagine' || 
                          cleanPrompt.startsWith('Immagine (') || 
                          cleanPrompt === 'immagine caricata' ||
                          cleanPrompt.startsWith('image_') ||
                          cleanPrompt.startsWith('Carta Judgement Day');

  // Fallback testuale di sicurezza se l'immagine non è reperibile dopo tutti i tentativi
  const applyTextFallback = () => {
    if (promptCard) {
      promptCard.classList.remove('is-full-image');
      promptCard.style.padding = '';
    }
    if (deckNameElement) {
      deckNameElement.style.display = '';
    }
    if (imgContainer) {
      imgContainer.style.position = 'relative';
      imgContainer.style.inset = 'auto';
      imgContainer.style.display = 'none';
    }
    if (imgElement) {
      imgElement.src = '';
      imgElement.style.display = 'none';
    }
    if (textElement) {
      textElement.style.display = 'block';
      const fallbackLabel = (cleanPrompt && !isGenericPrompt)
        ? cleanPrompt
        : 'Carta Immagine';
      textElement.textContent = fallbackLabel;
    }
  };

  // =========================================================================
  // 2. LOGICA STRICT: SE IMMAGINE -> SOLO IMMAGINE, SE TESTO -> SOLO TESTO
  // =========================================================================
  if (hasImage) {
    // -----------------------------------------------------------------------
    // CASO A: LA CARTA HA UN'IMMAGINE -> MOSTRA ESCLUSIVAMENTE L'IMMAGINE
    // -----------------------------------------------------------------------
    if (promptCard) {
      promptCard.classList.add('is-full-image');
      promptCard.style.padding = '0';
    }
    if (deckNameElement) {
      deckNameElement.style.display = 'none';
    }
    if (textElement) {
      textElement.style.display = 'none';
      textElement.textContent = '';
    }

    if (imgContainer) {
      imgContainer.style.display = 'block';
      imgContainer.style.width = '100%';
      imgContainer.style.height = '100%';
      imgContainer.style.maxWidth = '100%';
      imgContainer.style.maxHeight = '100%';
      imgContainer.style.margin = '0';
      imgContainer.style.padding = '0';
      imgContainer.style.border = 'none';
      imgContainer.style.boxShadow = 'none';
      imgContainer.style.position = 'absolute';
      imgContainer.style.inset = '0';
    }

    if (imgElement) {
      imgElement.style.display = 'block';
      imgElement.style.width = '100%';
      imgElement.style.height = '100%';
      imgElement.style.objectFit = 'cover';
      imgElement.style.pointerEvents = 'none';
      imgElement.style.cursor = 'default';

      let imgRetryCount = 0;
      const baseSourceUrl = validImage.split('?t=')[0];

      imgElement.onerror = () => {
        if (imgRetryCount < 2 && (baseSourceUrl.startsWith('/uploads/') || baseSourceUrl.startsWith('http'))) {
          imgRetryCount++;
          const separator = baseSourceUrl.includes('?') ? '&' : '?';
          const retryUrl = `${baseSourceUrl}${separator}t=${Date.now()}`;
          console.warn(`[IMAGE RETRY #${imgRetryCount}] Riprovo caricamento immagine: ${retryUrl}`);
          imgElement.src = retryUrl;
          return;
        }

        console.warn(`[IMAGE LOAD FAIL] Impossibile caricare immagine carta dopo i tentativi, attivo fallback testuale:`, baseSourceUrl.substring(0, 50));
        applyTextFallback();
        requestCardRecoveryFromServer();
      };

      imgElement.onload = () => {
        if (imgContainer) {
          imgContainer.style.display = 'block';
        }
      };

      imgElement.src = validImage;
    }

  } else {
    // -----------------------------------------------------------------------
    // CASO B: LA CARTA HA UN TESTO -> MOSTRA ESCLUSIVAMENTE IL TESTO
    // -----------------------------------------------------------------------
    if (promptCard) {
      promptCard.classList.remove('is-full-image');
      promptCard.style.padding = '';
    }
    if (deckNameElement) {
      deckNameElement.style.display = '';
    }
    if (imgContainer) {
      imgContainer.style.display = 'none';
    }
    if (imgElement) {
      imgElement.src = '';
      imgElement.style.display = 'none';
    }
    if (textElement) {
      textElement.style.display = 'block';
      textElement.textContent = cleanPrompt || 'Carta Gioco';
    }
  }

  // Gestione visibilità Tasto Info (i): ESCLUSO in Judgement Day, VISIBILE in Solo e Stanza Standard
  const btnCardInfo = el.btnCardInfo || document.getElementById('btn-card-info');
  if (btnCardInfo) {
    const isJudgementDay = !!state.roomIsPremium;
    btnCardInfo.style.display = isJudgementDay ? 'none' : 'inline-flex';
  }
}

// ==========================================================================
// FUNZIONI INFO CARTA (SINGLE PLAYER & STANZA STANDARD)
// ==========================================================================
function openCardInfoModal(cardTitle, cardDesc) {
  const modal = el.cardInfoModal || document.getElementById('card-info-modal');
  const titleEl = el.cardInfoModalTitle || document.getElementById('card-info-modal-title');
  const textEl = el.cardInfoModalText || document.getElementById('card-info-modal-text');

  let title = (cardTitle && typeof cardTitle === 'string' && cardTitle.trim().length > 0)
    ? cardTitle.trim()
    : (state.currentPromptText || 'Carta Attuale');

  if (title === 'Caricamento domanda...' || title === 'Carta Immagine') {
    title = 'Carta Attuale';
  }

  const desc = (cardDesc !== undefined && cardDesc !== null) ? cardDesc : state.currentCardDescription;

  if (titleEl) titleEl.textContent = title;
  if (textEl) {
    if (desc && typeof desc === 'string' && desc.trim().length > 0) {
      textEl.textContent = desc.trim();
    } else {
      textEl.textContent = `Info: Stiamo preparando la descrizione per "${title}".`;
    }
  }

  if (modal) {
    modal.style.display = 'flex';
    modal.offsetHeight; // trigger reflow
    modal.classList.add('active');
  }
}

function closeCardInfoModal() {
  const modal = el.cardInfoModal || document.getElementById('card-info-modal');
  if (modal) {
    modal.classList.remove('active');
    modal.style.display = 'none';
  }
}

// ==========================================================================
// FUNZIONI DI SUPPORTO UI LOBBY & GAMEPLAY
// ==========================================================================
function setupLobbyUI() {
  if (el.nameErrorMsg) el.nameErrorMsg.style.display = 'none';
  if (el.lobbyRoomCode) el.lobbyRoomCode.textContent = state.roomCode;
  
  // Mostra elementi lobby per multiplayer e resetta layout round
  if (el.lobbyHeader) el.lobbyHeader.style.display = 'block';
  if (el.lobbyPlayersPanel) el.lobbyPlayersPanel.style.display = 'block';
  if (el.btnAddBots) el.btnAddBots.style.display = 'block';
  if (el.roundsSelectorGrid) el.roundsSelectorGrid.classList.remove('rounds-vertical');
  
  if (state.isHost) {
    if (el.lobbyHostControls) el.lobbyHostControls.style.display = 'block';
    if (el.lobbyPlayerWaiting) el.lobbyPlayerWaiting.style.display = 'none';
  } else {
    if (el.lobbyHostControls) el.lobbyHostControls.style.display = 'none';
    if (el.lobbyPlayerWaiting) el.lobbyPlayerWaiting.style.display = 'block';
  }

  // Gestione Premium UI
  if (state.roomIsPremium) {
    if (el.roundsSelectorGrid) el.roundsSelectorGrid.style.display = 'none';
    const roundLabel = el.lobbyHostControls ? el.lobbyHostControls.querySelector('.input-label') : null;
    if (roundLabel) roundLabel.style.display = 'none';

    if (state.hasSubmittedPremiumCards) {
      if (el.lobbyPremiumCreator) el.lobbyPremiumCreator.style.display = 'none';
      if (el.lobbyPremiumWaiting) el.lobbyPremiumWaiting.style.display = 'flex';
      if (!state.isHost && el.lobbyPlayerWaiting) {
        el.lobbyPlayerWaiting.style.display = 'none';
      }
    } else {
      if (el.lobbyPremiumCreator) el.lobbyPremiumCreator.style.display = 'flex';
      if (!state.currentCroppedImage) {
        if (el.premiumImagePreviewContainer) el.premiumImagePreviewContainer.style.display = 'none';
        if (el.premiumCardInput) el.premiumCardInput.style.display = 'block';
        if (el.btnTriggerPremiumPhoto) el.btnTriggerPremiumPhoto.style.display = 'inline-flex';
      }
      if (el.lobbyPremiumWaiting) el.lobbyPremiumWaiting.style.display = 'none';
      if (!state.isHost && el.lobbyPlayerWaiting) {
        el.lobbyPlayerWaiting.style.display = 'none';
      }
      renderCapsules();
    }
  } else {
    if (el.roundsSelectorGrid) el.roundsSelectorGrid.style.display = 'grid';
    const roundLabel = el.lobbyHostControls ? el.lobbyHostControls.querySelector('.input-label') : null;
    if (roundLabel) roundLabel.style.display = 'block';
    
    if (el.lobbyPremiumCreator) el.lobbyPremiumCreator.style.display = 'none';
    if (el.lobbyPremiumWaiting) el.lobbyPremiumWaiting.style.display = 'none';
  }

  renderLobbyPlayers();
  showScreen(el.screenLobby);
}

function renderLobbyPlayers() {
  el.lobbyPlayersCount.textContent = state.players.length;
  el.lobbyPlayersList.innerHTML = '';
  
  state.players.forEach(player => {
    const card = document.createElement('div');
    const isOffline = player.connected === false;
    card.className = `lobby-player-card ${player.isHost ? 'is-host' : ''} ${isOffline ? 'player-offline' : ''}`;
    
    let statusDotHtml = '';
    if (state.roomIsPremium) {
      statusDotHtml = `
        <span class="lobby-player-status-dot ${player.premiumReady ? 'ready' : 'writing'}" title="${player.premiumReady ? 'Pronto (🟢)' : 'In Scrittura (🔴)'}"></span>
      `;
    }

    const hasAvatar = (player.avatar && typeof player.avatar === 'string' && player.avatar.trim().length > 15 && !player.avatar.includes('broken') && !player.avatar.includes('undefined') && (player.avatar.startsWith('data:image') || player.avatar.startsWith('http') || player.avatar.startsWith('/')));
    const avatarBg = getAvatarBgColor(player.name);

    const avatarHtml = hasAvatar
      ? `<img class="lobby-avatar" src="${player.avatar}" style="cursor: pointer;" loading="lazy" onerror="this.style.display='none'; this.onerror=null; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';">
         <div class="lobby-avatar-fallback" style="display:none; background-color: ${avatarBg}; cursor: pointer; justify-content: center; align-items: center;">${getDefaultAvatarSvg('65%', 'rgba(255,255,255,0.7)')}</div>`
      : `<div class="lobby-avatar-fallback" style="background-color: ${avatarBg}; cursor: pointer; display: flex; justify-content: center; align-items: center;">${getDefaultAvatarSvg('65%', 'rgba(255,255,255,0.7)')}</div>`;

    const hostBadge = player.isHost ? `<span class="lobby-player-host-badge" style="position: absolute; top: -6px; left: -6px; font-size: 0.7rem;">👑</span>` : '';

    const canKick = state.isHost && !player.isHost && player.id !== socket.id && !state.gameplayStarted;
    const kickBtnHtml = canKick
      ? `<button class="btn-kick-player-subtle" title="Espelli ${player.name}">✕</button>`
      : '';

    card.innerHTML = `
      <div style="position: relative; display: flex; align-items: center; flex-shrink: 0; margin-right: 0;">
        ${avatarHtml}
        ${hostBadge}
      </div>
      <span class="lobby-player-name" style="margin-left: 0;">${player.name} ${player.id === socket.id ? '(Tu)' : ''} ${isOffline ? '(Offline)' : ''}</span>
      ${statusDotHtml}
      ${kickBtnHtml}
    `;

    card.addEventListener('click', () => {
      openAvatarZoom(player);
    });
    card.style.cursor = 'pointer';

    const kickBtn = card.querySelector('.btn-kick-player-subtle');
    if (kickBtn) {
      kickBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        kickPlayerConfirm(player);
      });
    }

    el.lobbyPlayersList.appendChild(card);
  });

  // Gestione pulsante di avvio per l'Host
  if (state.isHost && el.btnHostStartGame) {
    // Ripristina stili default
    el.btnHostStartGame.style.background = '';
    el.btnHostStartGame.style.color = '';
    el.btnHostStartGame.style.boxShadow = '';
    
    const hasEnoughPlayers = state.players && state.players.length >= 2;
    if (!hasEnoughPlayers) {
      el.btnHostStartGame.style.opacity = '0.6';
      el.btnHostStartGame.title = 'Servono almeno 2 giocatori in stanza per iniziare';
    } else {
      el.btnHostStartGame.style.opacity = '1';
      el.btnHostStartGame.title = '';
    }

    if (state.roomIsPremium) {
      const hasCards = (state.players && state.players.some(p => p.premiumReady)) || 
                       (state.localPremiumCards && state.localPremiumCards.length > 0);
      if (hasCards && hasEnoughPlayers) {
        el.btnHostStartGame.classList.remove('btn-pulse-blue');
        el.btnHostStartGame.classList.add('btn-pulse-premium');
      } else {
        el.btnHostStartGame.classList.remove('btn-pulse-premium', 'full-glow');
        el.btnHostStartGame.classList.add('btn-pulse-blue');
      }
    } else {
      el.btnHostStartGame.classList.remove('btn-pulse-premium', 'full-glow');
      el.btnHostStartGame.classList.add('btn-pulse-blue');
    }
  }
}

// Il caricamento dei mazzi è stato rimosso in favore del Mazzo Unico

function renderGameplayPlayersStatus(votedPlayers = []) {
  if (!el.gameplayPlayersStatus) return;
  el.gameplayPlayersStatus.innerHTML = '';
  const activePlayers = (state.players || []).filter(p => p.connected !== false && p.isOnline !== false);
  let votedCount = 0;

  state.players.forEach(p => {
    const badge = document.createElement('span');
    const hasVoted = votedPlayers.includes(p.name);
    if (hasVoted) votedCount++;
    badge.className = `player-status-badge ${hasVoted ? 'has-voted' : ''}`;
    badge.innerHTML = `
      <span>${hasVoted ? '✔️' : '🤔'}</span>
      <span>${p.name}</span>
    `;
    el.gameplayPlayersStatus.appendChild(badge);
  });

  // Se tutti i partecipanti attivi hanno votato, arma il watchdog di sicurezza
  if (activePlayers.length > 0 && votedCount >= activePlayers.length) {
    checkAndArmWatchdog('all_voted');
  }
}

function renderRoundEndOverlay(votes = [], showStats = false) {
  state.roundEndActive = true;
  el.roundEndOverlay.classList.add('active');

  // Mostra/nascondi le statistiche di gruppo e mondo nell'overlay
  if (showStats) {
    el.roundEndStatsSummary.style.display = 'flex';
  } else {
    el.roundEndStatsSummary.style.display = 'none';
  }

  // Ferma immediatamente il timer e l'audio del ticchettio
  stopTimerLoop();

  // Controlli per l'Host o semplice Player
  if (state.isHost) {
    el.btnNextOverlay.style.display = 'block';
    el.roundEndPlayerWait.style.display = 'none';
  } else {
    el.btnNextOverlay.style.display = 'none';
    el.roundEndPlayerWait.style.display = 'flex';
  }

  // Controlli per ritardatari: se non ho votato, mostro i bottoni UNDER/OVER
  const myVoteObj = votes.find(v => v.player === state.playerName);
  const myVote = myVoteObj ? myVoteObj.vote : 'thinking';

  if (!state.userHasVoted && myVote === 'thinking') {
    el.roundEndOverlayVoteActions.style.display = 'flex';
    if (state.isHost) {
      el.btnNextOverlay.style.display = 'none';
    } else {
      el.roundEndPlayerWait.style.display = 'none';
    }
  } else {
    el.roundEndOverlayVoteActions.style.display = 'none';
  }

  // Salva i voti correnti per il filtraggio
  state.currentRoundVotes = votes;
  state.activeOverlayFilter = 'all';

  // Reimposta active classe sui bottoni filtro dell'overlay
  document.querySelectorAll('#round-end-overlay .votes-filter-container .filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === 'all');
  });

  // Renderizza la lista filtrata
  renderFilteredOverlayList();
}

function renderFilteredOverlayList() {
  const filter = state.activeOverlayFilter || 'all';
  const votes = state.currentRoundVotes || [];

  // Filtra
  let filteredVotes = votes;
  if (filter === 'over') {
    filteredVotes = votes.filter(v => v.vote === 'overrated');
  } else if (filter === 'under') {
    filteredVotes = votes.filter(v => v.vote === 'underrated');
  }

  // Ordina i voti in modo che l'utente corrente ("Tu") sia il primo della lista
  const sortedVotes = [...filteredVotes].sort((a, b) => {
    if (a.player === state.playerName) return -1;
    if (b.player === state.playerName) return 1;
    return 0;
  });

  el.roundEndVotesList.innerHTML = '';
  if (sortedVotes.length === 0) {
    el.roundEndVotesList.innerHTML = `<div class="no-players-text" style="padding: 10px; text-align: center; color: var(--color-text-muted);">Nessun voto per questa categoria.</div>`;
    return;
  }

  sortedVotes.forEach(pv => {
    const row = document.createElement('div');
    row.className = 'round-end-vote-row';

    let badgeText = 'Sta pensando...';
    let badgeClass = 'round-end-badge-thinking';

    if (pv.vote === 'underrated') {
      badgeText = 'Sottovalutato';
      badgeClass = 'round-end-badge-under';
    } else if (pv.vote === 'overrated') {
      badgeText = 'Sopravvalutato';
      badgeClass = 'round-end-badge-over';
    } else if (pv.vote === 'timeout') {
      badgeText = 'Tempo Scaduto';
      badgeClass = 'round-end-badge-timeout';
    }

    row.innerHTML = `
      <span class="round-end-player-name">${pv.player}</span>
      <span class="round-end-vote-badge ${badgeClass}">${badgeText}</span>
    `;
    el.roundEndVotesList.appendChild(row);
  });
}

function submitLateVote(voteType) {
  if (state.userHasVoted) return;
  state.userHasVoted = true;
  
  // Nascondi subito i bottoni di voto tardivi nell'overlay
  el.roundEndOverlayVoteActions.style.display = 'none';
  
  // Ripristina la visualizzazione di attesa/avanzamento corretta
  if (state.isHost) {
    el.btnNextOverlay.style.display = 'block';
  } else {
    el.roundEndPlayerWait.style.display = 'flex';
  }
  
  // Riproduci suono di conferma
  AudioSynth.playConfirm(voteType === 'underrated');
  
  // Disabilita anche i bottoni del gameplay principale sottostanti
  el.btnUnderrated.classList.add('disabled');
  el.btnOverrated.classList.add('disabled');
  
  // Invia il voto al server
  socket.emit('submit_vote', { voteType, roundId: state.currentRoundId });
}

function stopTimerLoop() {
  if (state.timerRequestId) {
    cancelAnimationFrame(state.timerRequestId);
    state.timerRequestId = null;
  }
}

function pauseTimer() {
  stopTimerLoop();
  state.timerPaused = true;
  state.pausedElapsed = Date.now() - state.timerStartTime;
}

function resumeTimer() {
  if (state.timerPaused) {
    state.timerPaused = false;
    state.timerStartTime = Date.now() - state.pausedElapsed;
    state.timerRequestId = requestAnimationFrame(gameLoop);
  }
}

// ==========================================================================
// LOGICA LOOP TIMER (60 FPS) CON SFUMATURA HSL E VOTO
// ==========================================================================
function gameLoop() {
  // Interrompi immediatamente se non siamo nella schermata di gameplay o se il round è terminato
  if (state.roundEndActive || !el.screenGameplay || !el.screenGameplay.classList.contains('active')) {
    stopTimerLoop();
    return;
  }

  const elapsed = Date.now() - state.timerStartTime;
  
  if (elapsed >= state.timerDurationMs) {
    updateTimerUI(0);
    el.btnUnderrated.classList.add('disabled');
    el.btnOverrated.classList.add('disabled');
    
    // In multigiocatore, suona il gong localmente a 0.0s esatti e attiva il Watchdog
    if (!state.isSoloMode && !state.roundEndActive) {
      state.roundEndActive = true;
      AudioSynth.playGong();
      stopTimerLoop();
    }

    if (!state.isSoloMode) {
      checkAndArmWatchdog('time_up');
    }
    
    // In solo mode, auto-advance su timeout (ferma prima il timer corrente così non cancella il nuovo loop della carta successiva)
    if (state.isSoloMode && !state.userHasVoted) {
      stopTimerLoop();
      state.userHasVoted = true;
      AudioSynth.playTimeout();
      handleSoloVote('timeout');
    }
    return;
  }
  
  const remainingMs = state.timerDurationMs - elapsed;
  updateTimerUI(remainingMs);
  
  // Gestione Ticchettio Audio (scalato sulla durata del timer)
  const dur = state.timerDurationMs;
  let tickInterval = 1000;
  let tickFreq = 800;
  
  if (elapsed >= dur * 0.5 && elapsed < dur * 0.8) {
    tickInterval = 500;
    tickFreq = 950;
  } else if (elapsed >= dur * 0.8) {
    tickInterval = 250;
    tickFreq = 1200;
  }
  
  if (Math.floor(elapsed / tickInterval) > Math.floor(state.lastTickElapsed / tickInterval)) {
    AudioSynth.playTick(tickFreq);
  }
  state.lastTickElapsed = elapsed;

  // Zoom Pulsanti (scalato sulla durata del timer)
  let pulseLeft = false;
  let pulseRight = false;
  
  if (elapsed >= dur * 0.5 && elapsed < dur * 0.65) {
    pulseLeft = true;
  } else if (elapsed >= dur * 0.65 && elapsed < dur * 0.8) {
    pulseRight = true;
  } else if (elapsed >= dur * 0.8 && elapsed < dur * 0.95) {
    pulseLeft = true;
  } else if (elapsed >= dur * 0.95 && elapsed < dur) {
    pulseRight = true;
  }

  if (pulseLeft) {
    el.btnUnderrated.classList.add('pulse-active');
  } else {
    el.btnUnderrated.classList.remove('pulse-active');
  }

  if (pulseRight) {
    el.btnOverrated.classList.add('pulse-active');
  } else {
    el.btnOverrated.classList.remove('pulse-active');
  }

  state.timerRequestId = requestAnimationFrame(gameLoop);
}

// Sfumatura di colore HSL + Bagliore al neon
function updateTimerUI(remainingMs) {
  const remainingSecs = Math.max(0, remainingMs / 1000);
  el.timerCounter.textContent = `${remainingSecs.toFixed(1)}s`;
  
  const pct = (remainingMs / state.timerDurationMs) * 100;
  el.timerBar.style.width = `${pct}%`;
  
  // Interpolazione HSL Continua: Verde (145) -> Giallo (48) -> Rosso (5)
  // Usiamo un fattore quadratico (Math.pow) nella seconda metà per accelerare il passaggio al rosso,
  // rendendo il rosso molto più visibile e presente negli ultimi secondi.
  let hue;
  if (pct >= 50) {
    // Prima metà: da verde (145) a giallo (48)
    const factor = (pct - 50) / 50; // da 1.0 a 0.0
    hue = 48 + factor * (145 - 48);
  } else {
    // Seconda metà: da giallo (48) a rosso (5) con andamento non lineare accelerato
    const factor = pct / 50; // da 1.0 a 0.0
    const curvedFactor = Math.pow(factor, 2); // andamento quadratico per favorire la presenza del rosso
    hue = 5 + curvedFactor * (48 - 5);
  }
  
  const colorStr = `hsl(${hue}, 80%, 50%)`;
  el.timerBar.style.background = colorStr;
  
  // Applica un bagliore neon dinamico del medesimo colore
  el.timerBar.style.boxShadow = `0 0 10px ${colorStr}, 0 0 3px ${colorStr}`;

  // Attiva lo stato di panico (testo rosso e pulsante, barra pulsante) negli ultimi 4 secondi (4000ms)
  if (remainingMs > 0 && remainingMs <= 4000) {
    el.timerCounter.classList.add('panic');
    el.timerBar.classList.add('panic');
  } else {
    el.timerCounter.classList.remove('panic');
    el.timerBar.classList.remove('panic');
  }
}

function submitVote(voteType) {
  if (state.userHasVoted) return;
  state.userHasVoted = true;
  
  AudioSynth.playConfirm(voteType === 'underrated');
  
  el.btnUnderrated.classList.add('disabled');
  el.btnOverrated.classList.add('disabled');
  el.btnUnderrated.classList.remove('pulse-active');
  el.btnOverrated.classList.remove('pulse-active');

  if (state.isSoloMode) {
    // Solo mode: risultati immediati e avanzamento automatico
    handleSoloVote(voteType);
    return;
  }
  
  // Voto via rete
  socket.emit('submit_vote', { voteType, roundId: state.currentRoundId });
  checkAndArmWatchdog();
}

function resetFromJoinLink() {
  try {
    sessionStorage.removeItem('overunder_pendingRoom');
    localStorage.removeItem('overunder_pendingRoom');
  } catch (e) {}

  const joinRulesModal = document.getElementById('join-rules-modal');
  if (joinRulesModal) {
    joinRulesModal.style.display = 'none';
    joinRulesModal.classList.remove('active');
  }
}

function resetToMenu() {
  state.isHost = false;
  state.isSoloMode = false;
  state.roomCode = '';
  state.players = [];
  state.soloDeck = null;
  state.soloCardIndex = 0;
  state.soloResponses = [];
  state.roomIsPremium = false;
  state.hasSubmittedPremiumCards = false;
  state.localPremiumCards = [];
  if (el.soloNameInput) el.soloNameInput.value = '';
  if (el.hostNameInput) el.hostNameInput.value = '';
  if (el.createRoomCodeInput) el.createRoomCodeInput.value = '';
  if (el.joinNameInput) el.joinNameInput.value = '';
  
  // Reset Premium Image cache
  resetPremiumCardInputState();
  
  resetFromJoinLink();

  // Reset pulizia URL da eventuali parametri di invito
  try {
    if (window.history && window.history.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  } catch (e) {}

  // Resetta lo scroll e ripristina l'altezza/classi del contenitore principale
  try { window.scrollTo(0, 0); } catch (e) {}
  if (el.screenWelcome) {
    try { el.screenWelcome.scrollTop = 0; } catch (e) {}
  }

  const container = document.querySelector('.app-container') || document.querySelector('.phone-frame') || document.querySelector('.main-screen');
  if (container) {
    container.style.padding = '';
    container.style.margin = '';
    container.style.height = '';
    container.style.minHeight = '';
    container.style.overflow = '';
  }
  
  if (state.timerRequestId) {
    cancelAnimationFrame(state.timerRequestId);
    state.timerRequestId = null;
  }
  stopTimerLoop();

  if (el.screenGameplay) {
    el.screenGameplay.classList.remove('is-solo-mode');
  }

  const endScreen = document.getElementById('single-player-end-screen');
  if (endScreen) {
    endScreen.style.display = 'none';
    endScreen.classList.remove('active');
  }
  
  clearSession();
  showScreen(el.screenWelcome);
}

function clearSession() {
  safeSessionStorage.removeItem('overunder_roomCode');
  safeSessionStorage.removeItem('overunder_playerName');
  safeSessionStorage.removeItem('overunder_isHost');
  safeSessionStorage.removeItem('overunder_token');
  safeSessionStorage.removeItem('overunder_pendingRoom');
  state.socketAuthenticated = false;
  state.authenticatedToken = null;
}

// ==========================================================================
// MODALITÀ GIOCO INDIVIDUALE (SOLO PLAY - OFFLINE)
// ==========================================================================
function getDefaultSoloDecks() {
  return [{
    deck_id: 'gli_intoccabili',
    deck_name: '🔥 Gli Intoccabili',
    cards: [
      { card_id: 'c001', prompt: "La pizza con l'ananas", description: "Controversa pizza con pomodoro, formaggio e fette di ananas, al centro di infiniti dibattiti gastronomici mondiali.", global_stats: { underrated: 15, overrated: 85 } },
      { card_id: 'c002', prompt: "L'applauso all'atterraggio dell'aereo", description: "Abitudine tipicamente italiana di applaudire l'equipaggio non appena le ruote dell'aereo toccano la pista di atterraggio.", global_stats: { underrated: 10, overrated: 90 } },
      { card_id: 'c003', prompt: "Ordinare un cappuccino dopo le 12:00", description: "Tabù della cultura culinaria italiana, che riserva la bevanda al latte e caffè esclusivamente alla prima colazione.", global_stats: { underrated: 20, overrated: 80 } },
      { card_id: 'c004', prompt: "L'uso quotidiano del bidet", description: "Sanitario indispensabile nelle case italiane per la cura dell'igiene personale intima quotidiana, raro in molti paesi esteri.", global_stats: { underrated: 96, overrated: 4 } },
      { card_id: 'c005', prompt: "Aggiungere la panna nella carbonara", description: "Eresia per i puristi della ricetta romana, che richiede rigorosamente uova, guanciale, pecorino e pepe nero.", global_stats: { underrated: 12, overrated: 88 } },
      { card_id: 'c006', prompt: "Inviare messaggi vocali di oltre 3 minuti", description: "Monologhi vocali su WhatsApp che sostituiscono una vera telefonata, spesso fonte di disperazione per chi li riceve.", global_stats: { underrated: 8, overrated: 92 } },
      { card_id: 'c007', prompt: "Arrivare 15 minuti in anticipo ad un appuntamento", description: "Rara dimostrazione di puntualità e rispetto del tempo altrui, talvolta al confine con l'ansia sociale anticipatoria.", global_stats: { underrated: 72, overrated: 28 } },
      { card_id: 'c008', prompt: "Mettere i calzini con i sandali in estate", description: "Abbinamento a lungo deriso come anti-estetico ma recentemente sdoganato nel mondo della moda da trendsetter internazionali.", global_stats: { underrated: 18, overrated: 82 } },
      { card_id: 'c009', prompt: "Mangiare la pasta riscaldata il giorno dopo", description: "Abitudine culinaria domestica in cui la pasta avanzata guadagna sapore e croccantezza venendo ripassata in padella.", global_stats: { underrated: 88, overrated: 12 } },
      { card_id: 'c010', prompt: "Fare spoiler di serie TV senza preavviso", description: "Rivelare a tradimento colpi di scena o finali di film e serie prima che gli altri abbiano potuto guardarli.", global_stats: { underrated: 3, overrated: 97 } },
      { card_id: 'c011', prompt: "Usare la modalità scura su qualsiasi app", global_stats: { underrated: 91, overrated: 9 } },
      { card_id: 'c012', prompt: "Ballare da soli in camera con le cuffie", global_stats: { underrated: 84, overrated: 16 } },
      { card_id: 'c013', prompt: "Comprare libri e non leggerli mai", global_stats: { underrated: 35, overrated: 65 } },
      { card_id: 'c014', prompt: "Riguardare sempre la stessa serie TV di conforto", global_stats: { underrated: 78, overrated: 22 } },
      { card_id: 'c015', prompt: "Il silenzio assoluto durante i viaggi in macchina", global_stats: { underrated: 68, overrated: 32 } },
      { card_id: 'c016', prompt: "Dormire con la porta della camera aperta", global_stats: { underrated: 42, overrated: 58 } },
      { card_id: 'c017', prompt: "Fare il letto appena svegli la mattina", global_stats: { underrated: 65, overrated: 35 } },
      { card_id: 'c018', prompt: "Mettere il parmigiano sulla pasta con il pesce", global_stats: { underrated: 14, overrated: 86 } },
      { card_id: 'c019', prompt: "Andare al cinema da soli", global_stats: { underrated: 81, overrated: 19 } },
      { card_id: 'c020', prompt: "Rispondere ai messaggi dopo 4 giorni", global_stats: { underrated: 11, overrated: 89 } },
      { card_id: 'c021', prompt: "Le vacanze senza smartphone né connessione", global_stats: { underrated: 79, overrated: 21 } },
      { card_id: 'c022', prompt: "Cucinare per gli amici il sabato sera", global_stats: { underrated: 87, overrated: 13 } },
      { card_id: 'c023', prompt: "L'odore della pioggia sull'asfalto estivo", global_stats: { underrated: 94, overrated: 6 } },
      { card_id: 'c024', prompt: "Rimettere la sveglia per altri 5 minuti", global_stats: { underrated: 76, overrated: 24 } },
      { card_id: 'c025', prompt: "Bere il caffè amaro senza zucchero", global_stats: { underrated: 69, overrated: 31 } },
      { card_id: 'c026', prompt: "Le serate a casa sotto la coperta con la pioggia", global_stats: { underrated: 93, overrated: 7 } },
      { card_id: 'c027', prompt: "Fare la spesa quando si ha fame", global_stats: { underrated: 15, overrated: 85 } },
      { card_id: 'c028', prompt: "Cantare a squarciagola sotto la doccia", global_stats: { underrated: 89, overrated: 11 } },
      { card_id: 'c029', prompt: "I vocali di WhatsApp ascoltati a velocità 2x", global_stats: { underrated: 83, overrated: 17 } },
      { card_id: 'c030', prompt: "Guardare il tramonto senza fare foto", global_stats: { underrated: 88, overrated: 12 } }
    ]
  }];
}

async function startSoloMode(playerName) {
  try {
    state.isSoloMode = true;
    state.isHost = true;
    state.playerName = playerName || 'Giocatore';
    state.players = [{ id: 'solo', name: state.playerName, isHost: true }];
    state.soloResponses = [];
    state.soloCardIndex = 0;
    state.currentCardIndex = 0;
    state.userHasVoted = false;
    state.gameMode = 'single';
    state.roomIsPremium = false;
    state.hasSubmittedPremiumCards = false;

    if (el.createPremiumToggle) {
      el.createPremiumToggle.checked = false;
    }

    // Carica il mazzo dal server o usa il mazzo locale di fallback garantito
    let decks = null;
    try {
      const response = await fetch('/api/decks');
      if (response && response.ok) {
        const data = await response.json();
        if (data && data.decks && Array.isArray(data.decks) && data.decks.length > 0) {
          decks = data.decks;
        }
      }
    } catch (e) {
      console.warn("Caricamento mazzi da server non disponibile. Uso fallback locale:", e);
    }

    if (!decks || decks.length === 0) {
      decks = getDefaultSoloDecks();
    }

    state.soloAvailableDecks = decks;

    // Avvia immediatamente la partita in singolo con il numero di carte selezionato dall'utente
    const length = state.soloGameLength || 30;
    startSoloGame(length);
  } catch (err) {
    console.error("[START SOLO MODE] Errore avvio modalità singolo:", err);
    state.soloAvailableDecks = getDefaultSoloDecks();
    startSoloGame(state.soloGameLength || 30);
  }
}

function setupSoloLobbyUI() {
  el.lobbyRoomCode.textContent = 'SOLO';
  
  // Nascondi elementi lobby in Solo e imposta layout round verticale
  el.lobbyHeader.style.display = 'none';
  el.lobbyPlayersPanel.style.display = 'none';
  el.btnAddBots.style.display = 'none';
  el.roundsSelectorGrid.classList.add('rounds-vertical');
  
  el.lobbyHostControls.style.display = 'block';
  el.lobbyPlayerWaiting.style.display = 'none';

  // Resetta/nascondi i moduli premium e ripristina la visualizzazione della durata del round in Solo
  if (el.roundsSelectorGrid) el.roundsSelectorGrid.style.display = 'grid';
  const roundLabel = el.lobbyHostControls ? el.lobbyHostControls.querySelector('.input-label') : null;
  if (roundLabel) roundLabel.style.display = 'block';
  
  el.lobbyPremiumCreator.style.display = 'none';
  el.lobbyPremiumWaiting.style.display = 'none';

  renderLobbyPlayers();
  showScreen(el.screenLobby);
}

function startSoloGame(length = 30) {
  try {
    // 1. Assicurati che l'array delle carte sia caricato COMPLETAMENTE prima del rendering
    if (!state.soloAvailableDecks || !Array.isArray(state.soloAvailableDecks) || state.soloAvailableDecks.length === 0) {
      state.soloAvailableDecks = getDefaultSoloDecks();
    }

    let deck = state.soloAvailableDecks[0];
    if (!deck || !Array.isArray(deck.cards) || deck.cards.length === 0) {
      state.soloAvailableDecks = getDefaultSoloDecks();
      deck = state.soloAvailableDecks[0];
    }

    const isInfinite = (length >= 9999 || length === '∞');
    state.isInfiniteMode = isInfinite;

    const clonedDeck = JSON.parse(JSON.stringify(deck));
    const shuffledCards = (clonedDeck.cards || []).sort(() => 0.5 - Math.random());

    if (isInfinite) {
      clonedDeck.cards = shuffledCards;
      state.totalCards = 9999;
    } else {
      const numCards = typeof length === 'number' ? length : (parseInt(length) || 30);
      clonedDeck.cards = shuffledCards.slice(0, Math.min(numCards, shuffledCards.length));
      state.totalCards = clonedDeck.cards.length;
    }

    // Se l'array per qualsiasi motivo fosse vuoto, ricarica subito il fallback
    if (!clonedDeck.cards || clonedDeck.cards.length === 0) {
      const fallbackDeck = getDefaultSoloDecks()[0];
      clonedDeck.cards = JSON.parse(JSON.stringify(fallbackDeck.cards));
      state.totalCards = clonedDeck.cards.length;
    }

    state.soloDeck = clonedDeck;
    state.currentDeckName = deck.deck_name || "Over Under";
    state.soloCardIndex = 0;
    state.currentCardIndex = 0;
    state.soloResponses = [];
    state.soloStreakType = null;
    state._victorySoundPlayed = false;
    state.soloStreakCount = 0;
    state.userHasVoted = false;
    state.isSoloMode = true;
    state.gameMode = 'single';
    hideSoloPersonalityPopup();

    const endScreen = document.getElementById('single-player-end-screen');
    if (endScreen) {
      endScreen.style.setProperty('display', 'none', 'important');
      endScreen.classList.remove('active');
    }

    // Rimuovi eventuali stili inline residui
    if (el.screenGameplay) {
      el.screenGameplay.style.removeProperty('display');
      el.screenGameplay.classList.add('is-solo-mode');
    }

    try { AudioSynth.playConfirm(true); } catch (e) {}
    showScreen(el.screenGameplay);
    showSoloCard();
  } catch (err) {
    console.error("[START SOLO GAME] Errore critico in startSoloGame:", err);
    state.soloDeck = JSON.parse(JSON.stringify(getDefaultSoloDecks()[0]));
    state.totalCards = state.soloDeck.cards.length;
    state.soloCardIndex = 0;
    state.currentCardIndex = 0;
    showScreen(el.screenGameplay);
    showSoloCard();
  }
}

function showSoloCard() {
  try {
    const isInfinite = !!state.isInfiniteMode;
    // Verifica che l'array esista e contenga elementi
    if (!state.soloDeck || !Array.isArray(state.soloDeck.cards) || state.soloDeck.cards.length === 0) {
      console.warn("[SHOW SOLO CARD] Mazzo non presente o vuoto, ricarico mazzo di default");
      state.soloDeck = JSON.parse(JSON.stringify(getDefaultSoloDecks()[0]));
      state.totalCards = state.soloDeck.cards.length;
    }

    const cards = state.soloDeck.cards;
    const totalCards = cards.length || state.totalCards || 0;

    // 1. GUARDIA SUL RENDERING: se l'indice è fuori dai limiti, mostra il fine partita
    if ((state.soloCardIndex >= totalCards || totalCards === 0) && !isInfinite) {
      console.log("[GUARDIA RENDERING] Indice superato (currentIndex >= totalCards). Arresto immediato rendering.");
      const promptCard = el.promptCard || document.getElementById('prompt-card');
      if (promptCard) promptCard.innerHTML = '';
      renderSinglePlayerFinalScreen();
      return;
    }

    let card = cards[state.soloCardIndex];

    if (!card && isInfinite && cards.length > 0) {
      const originalCards = state.soloAvailableDecks && state.soloAvailableDecks[0] ? state.soloAvailableDecks[0].cards : cards;
      const extraCards = JSON.parse(JSON.stringify(originalCards)).sort(() => 0.5 - Math.random());
      state.soloDeck.cards.push(...extraCards);
      card = state.soloDeck.cards[state.soloCardIndex];
    }

    // 2. Controllo di sicurezza: se la carta corrente non è valida
    if (!card) {
      console.warn("[SHOW SOLO CARD] Carta non trovata all'indice " + state.soloCardIndex + ", ricarico carta di fallback");
      if (cards.length > 0) {
        card = cards[0];
        state.soloCardIndex = 0;
      } else {
        renderSinglePlayerFinalScreen();
        return;
      }
    }

    // Verifica che gli elementi essenziali del DOM siano presenti
    if (!el.screenGameplay || !document.getElementById('prompt-card')) {
      console.warn("[SHOW SOLO CARD] Nodi DOM di gameplay mancanti, ripristino vista");
      showScreen(el.screenOnboarding);
      return;
    }

    state.userHasVoted = false;
    const promptStr = card.prompt || card.text || card.promptText || '';
    state.currentPromptText = promptStr;
    state.currentCardDescription = card.description || null;
    state.currentCardIndex = state.soloCardIndex;

    if (el.currentDeckName) el.currentDeckName.textContent = state.currentDeckName || 'OVER UNDER';
    updateGameplayCardMedia(promptStr, card.image);

    const totalDisplay = (state.isInfiniteMode || state.totalCards >= 9999 || state.totalCards === '∞') ? '∞' : totalCards;
    if (el.deckProgress) el.deckProgress.textContent = `Carta ${state.soloCardIndex + 1} / ${totalDisplay}`;

    if (el.btnUnderrated) el.btnUnderrated.classList.remove('disabled', 'pulse-active');
    if (el.btnOverrated) el.btnOverrated.classList.remove('disabled', 'pulse-active');

    // Reset timer bar & UI counter
    updateTimerUI(state.timerDurationMs);
    if (el.timerBar) {
      el.timerBar.style.background = 'hsl(145, 80%, 50%)';
      el.timerBar.style.boxShadow = '0 0 12px hsl(145, 80%, 50%)';
    }

    // In solo mode nascondi lo stato votazioni del gruppo e la lista avatar in alto
    if (el.gameplayPlayersStatus) el.gameplayPlayersStatus.innerHTML = '';
    if (el.gameplayStatusPanel) el.gameplayStatusPanel.style.display = 'none';
    if (el.gameplayAvatarsWrapper) {
      el.gameplayAvatarsWrapper.style.display = 'none';
    }

    showScreen(el.screenGameplay);

    // Avvia Timer Locale
    state.lastTickElapsed = 0;
    state.timerStartTime = Date.now();
    if (state.timerRequestId) {
      cancelAnimationFrame(state.timerRequestId);
    }
    state.timerRequestId = requestAnimationFrame(gameLoop);
  } catch (err) {
    console.error("[SHOW SOLO CARD] Errore critico nel rendering della prima carta:", err);
    try {
      showScreen(el.screenOnboarding);
    } catch (e) {
      renderSinglePlayerFinalScreen();
    }
  }
}

function updateSoloPersonalityStreak(voteType) {
  if (!state.isSoloMode) return;
  if (voteType !== 'overrated' && voteType !== 'underrated') return;

  const popupEl = document.getElementById('solo-personality-popup');
  const textEl = document.getElementById('solo-personality-text');
  if (!popupEl || !textEl) return;

  if (state.soloPersonalityTimer) {
    clearTimeout(state.soloPersonalityTimer);
    state.soloPersonalityTimer = null;
  }

  if (state.soloStreakType === voteType) {
    state.soloStreakCount = (state.soloStreakCount || 1) + 1;
  } else {
    // Scomparire immediatamente se l'utente cambia scelta (preme il pulsante opposto)
    state.soloStreakType = voteType;
    state.soloStreakCount = 1;
    hideSoloPersonalityPopup();
    return;
  }

  if (state.soloStreakCount >= 3) {
    let msg = '';
    if (voteType === 'underrated') {
      const underMsgs = [
        "Wow, sei un sottovalutatore cronico! 📉",
        "Tutto troppo gonfio per te, eh? 🎈",
        "Ma che ti hanno fatto le cose? 🧐",
        "Scetticismo ai massimi storici! 🔍",
        "Sottovaluteresti anche l'aria che respiri! 🌬️"
      ];
      const idx = Math.min(state.soloStreakCount - 3, underMsgs.length - 1);
      msg = underMsgs[idx];
      popupEl.className = 'solo-personality-popup glass-panel streak-under';
    } else {
      const overMsgs = [
        "Un vero sognatore, eh? 🚀",
        "Ottimismo stellare! 🌟",
        "Ma secondo te tutto vale di più? 💎",
        "Generosità di votazione al 100%! 🔥",
        "Sopravvaluteresti persino un sasso! 🗿"
      ];
      const idx = Math.min(state.soloStreakCount - 3, overMsgs.length - 1);
      msg = overMsgs[idx];
      popupEl.className = 'solo-personality-popup glass-panel streak-over';
    }

    textEl.textContent = msg;
    popupEl.style.display = 'flex';

    state.soloPersonalityTimer = setTimeout(() => {
      hideSoloPersonalityPopup();
    }, 2800);
  } else {
    hideSoloPersonalityPopup();
  }
}

function hideSoloPersonalityPopup() {
  const popupEl = document.getElementById('solo-personality-popup');
  if (popupEl) {
    popupEl.style.display = 'none';
    popupEl.className = 'solo-personality-popup glass-panel';
  }
  if (state.soloPersonalityTimer) {
    clearTimeout(state.soloPersonalityTimer);
    state.soloPersonalityTimer = null;
  }
}

function cleanUpMultiplayerListeners() {
  try {
    clearWatchdog();
    if (state.timerRequestId) {
      cancelAnimationFrame(state.timerRequestId);
      state.timerRequestId = null;
    }
    stopTimerLoop();
    if (state.soloPersonalityTimer) {
      clearTimeout(state.soloPersonalityTimer);
      state.soloPersonalityTimer = null;
    }
    if (state.soloTimeoutId) {
      clearTimeout(state.soloTimeoutId);
      state.soloTimeoutId = null;
    }
    if (state.connectionTimeout) {
      clearTimeout(state.connectionTimeout);
      state.connectionTimeout = null;
    }
    if (typeof socket !== 'undefined' && socket) {
      if (typeof socket.disconnect === 'function') {
        socket.disconnect();
      }
    }
  } catch (e) {
    console.warn("[CLEANUP] Errore in cleanUpMultiplayerListeners:", e);
  }
}

function renderSinglePlayerFinalScreen() {
  if (state.roomCode) {
    console.warn("[GUARD] Tentativo di rendering schermata single player in una stanza multiplayer. Eseguo renderGameOver().");
    renderGameOver();
    return;
  }
  try {
    triggerVictorySoundOnce();
    cleanUpMultiplayerListeners();

    if (state.timerRequestId) {
      cancelAnimationFrame(state.timerRequestId);
      state.timerRequestId = null;
    }
    stopTimerLoop();
    hideSoloPersonalityPopup();

    // 1. Nascondi tassativamente la schermata di gioco e qualsiasi altro pannello
    if (el.screenGameplay) {
      el.screenGameplay.classList.remove('active', 'is-solo-mode');
      el.screenGameplay.style.setProperty('display', 'none', 'important');
    }
    [el.screenResults, el.screenSummary, el.screenLobby, el.screenWelcome, el.screenSplash, el.screenLoading, el.screenKicked, el.screenRoomFull].forEach(s => {
      if (s) {
        s.classList.remove('active');
        s.style.setProperty('display', 'none', 'important');
      }
    });

    if (el.summaryPlayerWaiting) {
      el.summaryPlayerWaiting.style.setProperty('display', 'none', 'important');
    }
    if (el.resultsPlayerWaitingConfluent) {
      el.resultsPlayerWaitingConfluent.style.setProperty('display', 'none', 'important');
    }

    // 2. Calcola e popola il badge di personalità in modo sicuro
    const cardsPlayed = (state.soloResponses && Array.isArray(state.soloResponses)) ? state.soloResponses.length : (state.soloCardIndex || 0);
    
    let countUnder = 0;
    let countOver = 0;
    let countTimeout = 0;
    if (state.soloResponses && Array.isArray(state.soloResponses)) {
      state.soloResponses.forEach(res => {
        if (res && res.votes && Array.isArray(res.votes)) {
          res.votes.forEach(v => {
            if (v && v.vote === 'underrated') countUnder++;
            else if (v && v.vote === 'overrated') countOver++;
            else countTimeout++;
          });
        }
      });
    }

    let personalityTitle = "L'EQUILIBRATO";
    let personalityDesc = "Hai mantenuto un bilanciamento perfetto tra Over e Under!";
    let personalityIcon = "⚖️";
    let personalityDot = "🎯";

    if (countUnder >= Math.ceil(cardsPlayed / 2) && countUnder > 0) {
      personalityTitle = "IL SOTTO-VALUTATORE";
      personalityDesc = `Hai votato SOTTOVALUTATO ${countUnder} volte su ${cardsPlayed}. Trovi valore in qualsiasi cosa!`;
      personalityIcon = "✨";
      personalityDot = "🟢";
    } else if (countOver >= Math.ceil(cardsPlayed / 2) && countOver > 0) {
      personalityTitle = "IL SOPRA-VALUTATORE";
      personalityDesc = `Hai votato SOPRAVVALUTATO ${countOver} volte su ${cardsPlayed}. Niente sembra soddisfarti!`;
      personalityIcon = "⛔";
      personalityDot = "🔴";
    } else if (countTimeout > 0 && countTimeout >= Math.ceil(cardsPlayed / 2)) {
      personalityTitle = "IL PIGRO";
      personalityDesc = `Tempo scaduto per ${countTimeout} volte. La fretta non fa per te!`;
      personalityIcon = "💤";
      personalityDot = "🐌";
    }

    // 3. Mostra la schermata finale Single Player isolata
    let endScreen = document.getElementById('single-player-end-screen');
    if (!endScreen) {
      endScreen = document.createElement('div');
      endScreen.id = 'single-player-end-screen';
      const container = document.getElementById('app') || document.body;
      container.appendChild(endScreen);
    }

    endScreen.className = 'single-player-end-screen-overlay custom-modal-overlay active';
    endScreen.style.display = 'flex';

    endScreen.innerHTML = `
      <div class="single-player-bg-effects">
        <div class="single-player-light-rays"></div>
        <div class="single-player-confetti-container">
          <span class="confetti c1"></span>
          <span class="confetti c2"></span>
          <span class="confetti c3"></span>
          <span class="confetti c4"></span>
          <span class="confetti c5"></span>
          <span class="confetti c6"></span>
          <span class="confetti c7"></span>
          <span class="confetti c8"></span>
          <span class="confetti c9"></span>
          <span class="confetti c10"></span>
          <span class="confetti c11"></span>
          <span class="confetti c12"></span>
        </div>
      </div>

      <!-- Header Superiore con icone Home e Impostazioni -->
      <div class="single-player-end-nav-header">
        <button id="btn-end-home" class="nav-btn-back" title="Home">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"
            stroke-linejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        </button>
        <button class="nav-btn-settings btn-open-settings" title="Impostazioni">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>
      </div>

      <!-- Logo Animato OVER UNDER in alto -->
      <div class="logo-area single-player-logo-area" style="animation: float-logo 4s ease-in-out infinite;">
        <div class="logo-title">
          <span class="logo-over">OVER</span>
          <div class="logo-divider"></div>
          <span class="logo-under">under</span>
        </div>
        <p class="logo-tagline">Sopravvalutato o Sottovalutato?</p>
      </div>

      <div class="single-player-end-modal-wrapper">
        <div class="single-player-top-flame-wrapper">
          <div class="flame-glow-halo"></div>
          <span class="single-player-top-flame">🔥</span>
        </div>

        <div class="single-player-end-modal-box">
          <div class="single-player-box-header">
            <h1 class="single-player-end-title">PARTITA COMPLETATA!</h1>
            <p id="single-player-summary" class="single-player-end-subtitle">Hai risposto a tutte le carte della sessione.</p>
          </div>
          <div id="single-player-personality-badge" class="single-player-badge-wrapper" style="width: 100%;">
            <div class="single-player-award-card">
              <div class="single-player-award-icon-box">
                <span class="single-player-award-icon">${personalityIcon}</span>
              </div>
              <div class="single-player-award-info">
                <div class="single-player-award-title">
                  <span class="single-player-award-dot">${personalityDot}</span>
                  <span>${personalityTitle}</span>
                </div>
                <p class="single-player-award-desc">${personalityDesc}</p>
              </div>
            </div>
          </div>
          <div class="single-player-box-footer" style="width: 100%;">
            <button id="btn-restart-direct" class="btn-single-player-restart">RICOMINCIA</button>
            <button id="btn-try-room-direct" class="btn-single-player-rooms">
              <span>GIOCA CON I TUOI AMICI</span>
              <svg class="btn-icon" viewBox="0 0 24 24">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
            </button>
          </div>
        </div>
        <button type="button" id="btn-single-player-cancel-home" class="btn-link-subtle">Annulla e torna al menù principale</button>
      </div>
    `;

    // 4. Collega gli eventi al tasto RICOMINCIA, PROVA STANZA, ai tasti Home e al tasto Impostazioni
    const btnRestartDirect = endScreen.querySelector('#btn-restart-direct');
    if (btnRestartDirect) {
      btnRestartDirect.onclick = handleSinglePlayerRestart;
    }
    const handleGoToRooms = (e) => {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      try { AudioSynth.playConfirm(true); } catch (err) {}
      const endOverlay = document.getElementById('single-player-end-screen');
      if (endOverlay) {
        endOverlay.style.display = 'none';
        endOverlay.classList.remove('active');
      }
      showScreen(el.screenOnboarding);
      if (el.tabCreate) el.tabCreate.click();
      if (el.tabCreate) el.tabCreate.classList.add('active');
      if (el.tabSolo) el.tabSolo.classList.remove('active');
      if (el.formCreateRoom) el.formCreateRoom.style.display = 'block';
      if (el.formSoloPlay) el.formSoloPlay.style.display = 'none';
      try {
        if (el.screenOnboarding) el.screenOnboarding.scrollTop = 0;
      } catch (err) {}
    };
    const btnTryRoomDirect = endScreen.querySelector('#btn-try-room-direct');
    if (btnTryRoomDirect) {
      btnTryRoomDirect.onclick = handleGoToRooms;
    }
    const btnCancelHome = endScreen.querySelector('#btn-single-player-cancel-home');
    if (btnCancelHome) {
      btnCancelHome.onclick = (e) => {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        try { AudioSynth.playConfirm(false); } catch (err) {}
        resetToMenu();
      };
    }
    const btnEndHome = endScreen.querySelector('#btn-end-home');
    if (btnEndHome) {
      btnEndHome.onclick = (e) => {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        try { AudioSynth.playConfirm(false); } catch (err) {}
        resetToMenu();
      };
    }
    const btnEndSettings = endScreen.querySelector('.btn-open-settings');
    if (btnEndSettings) {
      btnEndSettings.onclick = (e) => {
        e.stopPropagation();
        const backdrop = document.getElementById('settings-sidebar-backdrop');
        if (backdrop) backdrop.classList.add('active');
        syncAudioUI();
      };
    }
  } catch (error) {
    console.error("[SAFE RENDER] Errore in renderSinglePlayerFinalScreen, attivo fallback:", error);
    try {
      const container = document.getElementById('app') || document.body;
      let fallbackScreen = document.getElementById('single-player-end-screen');
      if (!fallbackScreen) {
        fallbackScreen = document.createElement('div');
        fallbackScreen.id = 'single-player-end-screen';
        container.appendChild(fallbackScreen);
      }
      fallbackScreen.className = 'single-player-end-screen-overlay custom-modal-overlay active';
      fallbackScreen.style.display = 'flex';
      fallbackScreen.innerHTML = `
        <div class="single-player-bg-effects">
          <div class="single-player-light-rays"></div>
          <div class="single-player-confetti-container">
            <span class="confetti c1"></span>
            <span class="confetti c2"></span>
            <span class="confetti c3"></span>
            <span class="confetti c4"></span>
            <span class="confetti c5"></span>
            <span class="confetti c6"></span>
          </div>
        </div>

        <!-- Header Superiore con icone Home e Impostazioni -->
        <div class="single-player-end-nav-header">
          <button id="btn-end-home" class="nav-btn-back" title="Home">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"
              stroke-linejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </button>
          <button class="nav-btn-settings btn-open-settings" title="Impostazioni">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          </button>
        </div>

        <!-- Logo Animato OVER UNDER in alto -->
        <div class="logo-area single-player-logo-area" style="animation: float-logo 4s ease-in-out infinite;">
          <div class="logo-title">
            <span class="logo-over">OVER</span>
            <div class="logo-divider"></div>
            <span class="logo-under">under</span>
          </div>
          <p class="logo-tagline">Sopravvalutato o Sottovalutato?</p>
        </div>

        <div class="single-player-end-modal-wrapper">
          <div class="single-player-top-flame-wrapper">
            <div class="flame-glow-halo"></div>
            <span class="single-player-top-flame">🔥</span>
          </div>
          <div class="single-player-end-modal-box">
            <div class="single-player-box-header">
              <h1 class="single-player-end-title">PARTITA COMPLETATA!</h1>
              <p style="color: rgba(255,255,255,0.72); text-align: center; font-size: 0.85rem; margin: 0;">Hai risposto a tutte le carte della sessione.</p>
            </div>
            <div class="single-player-badge-wrapper" style="width: 100%;">
              <div class="single-player-award-card">
                <div class="single-player-award-icon-box">
                  <span class="single-player-award-icon">⛔</span>
                </div>
                <div class="single-player-award-info">
                  <div class="single-player-award-title">
                    <span class="single-player-award-dot">🔴</span>
                    <span>IL SOPRA-VALUTATORE</span>
                  </div>
                  <p class="single-player-award-desc">Sessione completata con successo!</p>
                </div>
              </div>
            </div>
            <div class="single-player-box-footer" style="width: 100%;">
              <button id="btn-restart-direct" class="btn-single-player-restart">RICOMINCIA</button>
              <button id="btn-try-room-direct" class="btn-single-player-rooms">
                <span>GIOCA CON I TUOI AMICI</span>
                <svg class="btn-icon" viewBox="0 0 24 24">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
              </button>
            </div>
          </div>
          <button type="button" id="btn-single-player-cancel-home" class="btn-link-subtle">Annulla e torna al menù principale</button>
        </div>
      `;
      const btnFallback = fallbackScreen.querySelector('#btn-restart-direct');
      if (btnFallback) {
        btnFallback.onclick = handleSinglePlayerRestart;
      }
      const btnFallbackRooms = fallbackScreen.querySelector('#btn-try-room-direct');
      if (btnFallbackRooms) {
        btnFallbackRooms.onclick = handleGoToRooms;
      }
      const btnFallbackCancel = fallbackScreen.querySelector('#btn-single-player-cancel-home');
      if (btnFallbackCancel) {
        btnFallbackCancel.onclick = (e) => {
          if (e && typeof e.preventDefault === 'function') e.preventDefault();
          try { AudioSynth.playConfirm(false); } catch (err) {}
          resetToMenu();
        };
      }
      const btnFallbackHome = fallbackScreen.querySelector('#btn-end-home');
      if (btnFallbackHome) {
        btnFallbackHome.onclick = (e) => {
          if (e && typeof e.preventDefault === 'function') e.preventDefault();
          try { AudioSynth.playConfirm(false); } catch (err) {}
          resetToMenu();
        };
      }
      const btnFallbackSettings = fallbackScreen.querySelector('.btn-open-settings');
      if (btnFallbackSettings) {
        btnFallbackSettings.onclick = (e) => {
          e.stopPropagation();
          const backdrop = document.getElementById('settings-sidebar-backdrop');
          if (backdrop) backdrop.classList.add('active');
          syncAudioUI();
        };
      }
    } catch (e) {
      console.error("[CRITICAL FALLBACK ERROR]", e);
    }
  }
}

function handleSinglePlayerRestart(e) {
  if (e && typeof e.preventDefault === 'function') e.preventDefault();

  // 1. Reset dello stato delle carte
  state.soloCardIndex = 0;
  state.currentCardIndex = 0;
  state.soloResponses = [];
  state.soloStreakType = null;
  state.soloStreakCount = 0;
  state.userHasVoted = false;
  state.isSoloMode = true;
  state.gameMode = 'single';
  state._victorySoundPlayed = false;
  hideSoloPersonalityPopup();

  if (state.timerRequestId) {
    cancelAnimationFrame(state.timerRequestId);
    state.timerRequestId = null;
  }
  stopTimerLoop();

  // 2. Nascondi la schermata finale
  const endScreen = document.getElementById('single-player-end-screen');
  if (endScreen) {
    endScreen.style.setProperty('display', 'none', 'important');
    endScreen.classList.remove('active');
  }

  // 3. Mostra direttamente la schermata di selezione delle carte del Single Player (senza reload / no splash)
  showScreen(el.screenOnboarding);
  if (el.modeTabs) el.modeTabs.style.display = 'flex';
  if (el.tabSolo) el.tabSolo.classList.add('active');
  if (el.tabCreate) el.tabCreate.classList.remove('active');
  if (el.formSoloPlay) el.formSoloPlay.style.display = 'block';
  if (el.formCreateRoom) el.formCreateRoom.style.display = 'none';
  if (el.formJoinRoomLink) el.formJoinRoomLink.style.display = 'none';
  if (el.nameErrorMsg) el.nameErrorMsg.style.display = 'none';
  if (el.soloNameInput && state.playerName) {
    el.soloNameInput.value = state.playerName;
  }
  if (el.screenOnboarding) {
    try { el.screenOnboarding.scrollTop = 0; } catch (err) {}
  }
}

function endGame(params) {
  const isSinglePlayer = !!(state.isSoloMode || state.gameMode === 'single') && !state.roomCode;
  if (isSinglePlayer) {
    cleanUpMultiplayerListeners();
    renderSinglePlayerFinalScreen();
    return;
  }
  renderGameOver(params || {});
}

function showResults(params) {
  const isSinglePlayer = !!(state.isSoloMode || state.gameMode === 'single') && !state.roomCode;
  if (isSinglePlayer) {
    cleanUpMultiplayerListeners();
    renderSinglePlayerFinalScreen();
    return;
  }
  renderGameOver(params || {});
}

function finishMatch(params) {
  const isSinglePlayer = !!(state.isSoloMode || state.gameMode === 'single') && !state.roomCode;
  if (isSinglePlayer) {
    cleanUpMultiplayerListeners();
    renderSinglePlayerFinalScreen();
    return;
  }
  renderGameOver(params || {});
}

function showSinglePlayerResults() {
  if (state.roomCode) {
    renderGameOver();
    return;
  }
  triggerVictorySoundOnce();
  cleanUpMultiplayerListeners();
  renderSinglePlayerFinalScreen();
}

function renderSoloGameOver() {
  if (state.roomCode) {
    renderGameOver();
    return;
  }
  triggerVictorySoundOnce();
  cleanUpMultiplayerListeners();
  renderSinglePlayerFinalScreen();
}

function forceSwitchToSummary() {
  try {
    if ((state.isSoloMode || state.gameMode === 'single') && !state.roomCode) {
      cleanUpMultiplayerListeners();
      renderSinglePlayerFinalScreen();
      return;
    }

    if (state.timerRequestId) {
      cancelAnimationFrame(state.timerRequestId);
      state.timerRequestId = null;
    }
    stopTimerLoop();
    hideSoloPersonalityPopup();

    if (el.screenGameplay) {
      el.screenGameplay.classList.remove('active');
    }
    if (el.screenSummary) {
      el.screenSummary.classList.add('active');
    }
    showScreen(el.screenSummary);
  } catch (e) {
    console.error("[FORCE SWITCH] Errore in forceSwitchToSummary:", e);
    showScreen(el.screenSummary);
  }
}

function handleSoloVote(voteType) {
  try {
    // 1. Ferma subito il timer ed elimina celermente qualsiasi animation loop
    if (state.timerRequestId) {
      cancelAnimationFrame(state.timerRequestId);
      state.timerRequestId = null;
    }
    stopTimerLoop();

    const isInfinite = !!state.isInfiniteMode;
    const cards = (state.soloDeck && Array.isArray(state.soloDeck.cards)) ? state.soloDeck.cards : [];
    const totalCards = cards.length || state.totalCards || 0;

    // Check bounds
    if (!isInfinite && (state.soloCardIndex >= totalCards || totalCards === 0)) {
      renderSinglePlayerFinalScreen();
      return;
    }

    const card = cards[state.soloCardIndex];
    if (!card) {
      console.log("[FORCE ENDGAME] Carta non trovata in handleSoloVote, rendering finale.");
      renderSinglePlayerFinalScreen();
      return;
    }

    // Traccia le scelte consecutive e gestisce i pop-up di personalità
    updateSoloPersonalityStreak(voteType);

    const votes = [{ player: state.playerName, vote: voteType }];

    if (!Array.isArray(state.soloResponses)) {
      state.soloResponses = [];
    }
    state.soloResponses.push({
      prompt: card.prompt || '',
      image: card.image || null,
      votes: votes,
      stats: card.global_stats || null
    });

    // Se l'indice corrente ha completato l'ultima carta del mazzo:
    if (!isInfinite && (state.soloCardIndex >= totalCards - 1)) {
      triggerVictorySoundOnce();
      console.log("[FORCE ENDGAME] Ultima carta completata in handleSoloVote (indice " + state.soloCardIndex + "). Rendering finale istantaneo!");
      renderSinglePlayerFinalScreen();
      return;
    }

    // Avanza alla prossima carta
    advanceSoloGame();
  } catch (err) {
    console.error("[FORCE ENDGAME] Errore in handleSoloVote, forzo rendering finale:", err);
    renderSinglePlayerFinalScreen();
  }
}

function advanceSoloGame() {
  try {
    const isInfinite = !!state.isInfiniteMode;
    const cards = (state.soloDeck && Array.isArray(state.soloDeck.cards)) ? state.soloDeck.cards : [];
    const totalCards = cards.length || state.totalCards || 0;

    // Controllo fine mazzo per non superare mai l'array
    if (!isInfinite && (state.soloCardIndex >= totalCards - 1 || state.soloCardIndex + 1 >= totalCards)) {
      console.log("[FORCE ENDGAME] Fine mazzo in advanceSoloGame. Rendering finale!");
      renderSinglePlayerFinalScreen();
      return;
    }

    // Modalità infinita
    if (isInfinite) {
      state.soloCardIndex++;
      if (state.soloCardIndex >= cards.length) {
        const originalCards = state.soloAvailableDecks && state.soloAvailableDecks[0] ? state.soloAvailableDecks[0].cards : cards;
        const extraCards = JSON.parse(JSON.stringify(originalCards)).sort(() => 0.5 - Math.random());
        state.soloDeck.cards.push(...extraCards);
      }
      showSoloCard();
      return;
    }

    // Avanzamento regolare con verifica di sicurezza
    state.soloCardIndex++;
    if (state.soloCardIndex >= totalCards) {
      renderSinglePlayerFinalScreen();
      return;
    }

    showSoloCard();
  } catch (err) {
    console.error("[FORCE ENDGAME] Errore in advanceSoloGame, forzo rendering finale:", err);
    renderSinglePlayerFinalScreen();
  }
}

function renderRoundResults({ votes, groupStats, globalStats, prompt, image, cardIndex, totalCards } = {}) {
  clearWatchdog();
  stopTimerLoop();
  state.roundEndActive = true;
  state.currentCardIndex = cardIndex;
  state.totalCards = totalCards;
  state.currentPromptText = prompt;

  // Reset dello stato della barra toggle bridge per ogni nuovo round
  state.isWorldStatsVisible = false;
  if (el.btnToggleWorldStats) el.btnToggleWorldStats.classList.remove('active');
  if (el.globalStatsCard) el.globalStatsCard.classList.remove('active');

  if (state.roomIsPremium) {
    if (el.worldToggleBridge) el.worldToggleBridge.style.display = 'none';
    if (el.globalStatsCard) el.globalStatsCard.style.display = 'none';
  } else {
    if (el.worldToggleBridge) el.worldToggleBridge.style.display = 'flex';
    if (el.globalStatsCard) el.globalStatsCard.style.display = '';
  }

  // Gestione immagine risultati round (Full-Card, no zoom)
  if (el.resultsPromptImageContainer) {
    if (image) {
      if (el.resultsPromptImage) el.resultsPromptImage.src = image;
      el.resultsPromptImageContainer.style.display = 'block';
      if (el.resultsPromptImage) {
        el.resultsPromptImage.style.pointerEvents = 'none';
        el.resultsPromptImage.style.cursor = 'default';
      }
    } else {
      el.resultsPromptImageContainer.style.display = 'none';
      if (el.resultsPromptImage) el.resultsPromptImage.src = '';
    }
  }

  // Popola il soggetto del prompt (nasconde titoli generici in partita)
  const cleanResultPrompt = (prompt && typeof prompt === 'string') ? prompt.trim() : '';
  const isGenericResultPrompt = !cleanResultPrompt || 
                                cleanResultPrompt === 'Carta Immagine' || 
                                cleanResultPrompt.startsWith('Immagine (') || 
                                cleanResultPrompt === 'immagine caricata' || 
                                cleanResultPrompt.startsWith('image_');
  
  if (el.resultsPromptSubject) {
    if (!isGenericResultPrompt) {
      el.resultsPromptSubject.textContent = cleanResultPrompt;
      el.resultsPromptSubject.style.display = 'block';
    } else {
      el.resultsPromptSubject.textContent = '';
      el.resultsPromptSubject.style.display = 'none';
    }
  }

  const gStats = groupStats || { underrated: 50, overrated: 50 };
  const wStats = globalStats || { underrated: 50, overrated: 50 };

  // Modulo 1: Il Tuo Gruppo (Barre percentuali bipolari)
  if (el.groupUnderPctText) el.groupUnderPctText.textContent = `UNDER ${gStats.underrated}%`;
  if (el.groupOverPctText) el.groupOverPctText.textContent = `OVER ${gStats.overrated}%`;
  if (el.groupUnderFill) el.groupUnderFill.style.width = `${gStats.underrated}%`;
  if (el.groupOverFill) el.groupOverFill.style.width = `${gStats.overrated}%`;

  // Modulo 2: Il Mondo (Global, Barre percentuali bipolari)
  if (el.globalUnderPctText) el.globalUnderPctText.textContent = `UNDER ${wStats.underrated}%`;
  if (el.globalOverPctText) el.globalOverPctText.textContent = `OVER ${wStats.overrated}%`;
  if (el.globalUnderFill) el.globalUnderFill.style.width = `${wStats.underrated}%`;
  if (el.globalOverFill) el.globalOverFill.style.width = `${wStats.overrated}%`;

  // Modulo Dettaglio Voti (Solo in Multiplayer)
  if (state.isSoloMode) {
    if (el.resultsVotesDetailCard) el.resultsVotesDetailCard.style.display = 'none';
  } else {
    if (el.resultsVotesDetailCard) el.resultsVotesDetailCard.style.display = 'block';
    
    // Salva i voti correnti per il filtraggio
    state.currentRoundResultsVotes = votes || [];
    state.activeResultsFilter = 'all';

    // Reimposta active classe sui bottoni filtro dei risultati
    document.querySelectorAll('#results-votes-detail-card .votes-filter-container .filter-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === 'all');
    });

    renderFilteredResultsList();
  }

  // Configura il footer (Controlli avanzamento)
  const isLast = (cardIndex !== undefined && totalCards !== undefined) ? (cardIndex >= totalCards - 1) : false;
  if (state.isSoloMode || state.isHost) {
    if (el.btnNextCardConfluent) {
      el.btnNextCardConfluent.style.display = 'flex';
      const labelSpan = el.btnNextCardConfluent.querySelector('span');
      if (labelSpan) labelSpan.textContent = isLast ? "VEDI CLASSIFICA" : "PROSSIMA CARTA";
    }
    if (el.resultsPlayerWaitingConfluent) el.resultsPlayerWaitingConfluent.style.display = 'none';
  } else {
    if (el.btnNextCardConfluent) el.btnNextCardConfluent.style.display = 'none';
    if (el.resultsPlayerWaitingConfluent) el.resultsPlayerWaitingConfluent.style.display = 'flex';
  }

  // Transizione alla schermata risultati
  showScreen(el.screenResults);
}

function renderFilteredResultsList() {
  const filter = state.activeResultsFilter || 'all';
  const votes = state.currentRoundResultsVotes || [];

  let filteredVotes = votes;
  if (filter === 'over') {
    filteredVotes = votes.filter(v => v.vote === 'overrated');
  } else if (filter === 'under') {
    filteredVotes = votes.filter(v => v.vote === 'underrated');
  }

  const sortedVotes = [...filteredVotes].sort((a, b) => {
    if (a.player === state.playerName) return -1;
    if (b.player === state.playerName) return 1;
    return 0;
  });

  if (!el.resultsVotesList) return;
  el.resultsVotesList.innerHTML = '';
  if (sortedVotes.length === 0) {
    el.resultsVotesList.innerHTML = `<div class="no-players-text" style="padding: 10px; text-align: center; color: var(--color-text-muted);">Nessun voto per questa categoria.</div>`;
    return;
  }

  sortedVotes.forEach(pv => {
    const row = document.createElement('div');
    row.className = 'results-vote-row';

    let badgeText = 'Tempo Scaduto';
    let badgeClass = 'results-vote-row-badge timeout';

    if (pv.vote === 'underrated') {
      badgeText = 'Sottovalutato';
      badgeClass = 'results-vote-row-badge under';
    } else if (pv.vote === 'overrated') {
      badgeText = 'Sopravvalutato';
      badgeClass = 'results-vote-row-badge over';
    }

    const displayName = pv.player === state.playerName ? 'Tu' : pv.player;

    row.innerHTML = `
      <span class="results-vote-row-name">${displayName}</span>
      <span class="${badgeClass}">${badgeText}</span>
    `;
    el.resultsVotesList.appendChild(row);
  });
}

function renderGameOver({ awards, summary } = {}) {
  triggerVictorySoundOnce();
  state.isSoloMode = false;
  state.gameMode = 'multiplayer';

  // Assicurati che l'overlay del single player sia tassativamente nascosto
  const singlePlayerEndScreen = document.getElementById('single-player-end-screen');
  if (singlePlayerEndScreen) {
    singlePlayerEndScreen.classList.remove('active');
    singlePlayerEndScreen.style.setProperty('display', 'none', 'important');
  }

  const mainTitleEl = document.querySelector('#screen-summary .summary-main-title');
  if (mainTitleEl) {
    mainTitleEl.textContent = "Partita Completata! 🎉";
  }

  const subtitleEl = document.getElementById('summary-subtitle');
  if (subtitleEl) {
    subtitleEl.textContent = "Classifiche e premi finali del gruppo:";
  }

  const sectionTitles = document.querySelectorAll('#screen-summary .awards-section-title');
  if (sectionTitles && sectionTitles.length >= 2) {
    sectionTitles[0].textContent = "🏆 Premi Speciali:";
    sectionTitles[1].textContent = "📊 Tutti i Verdetti:";
  }

  // 1. Genera sezione "PREMI SPECIALI"
  if (el.groupAwardsContainer) {
    el.groupAwardsContainer.innerHTML = '';
    const awardsList = Array.isArray(awards) ? awards : [];
    if (awardsList.length === 0) {
      el.groupAwardsContainer.innerHTML = `<div class="no-players-text">Nessun premio speciale assegnato in questa partita!</div>`;
    } else {
      awardsList.forEach(aw => {
        const card = document.createElement('div');
        card.className = 'award-card glass-panel';
        card.innerHTML = `
          <div class="award-icon-box">${aw.icon || '🏆'}</div>
          <div class="award-info">
            <div class="award-title-row">
              <span class="award-name">${aw.title || ''}</span>
              <span class="award-winner">${aw.winner || ''}</span>
            </div>
            <div class="award-desc">${aw.desc || ''}</div>
          </div>
        `;
        el.groupAwardsContainer.appendChild(card);
      });
    }
  }

  // 2. Genera sezione "TUTTI I VERDETTI"
  if (el.summaryCardsList) {
    el.summaryCardsList.innerHTML = '';
    const summaryList = Array.isArray(summary) ? summary : [];
    summaryList.forEach(res => {
      const item = document.createElement('div');
      item.className = 'summary-item glass-panel';
      
      let playerVotesHtml = '';
      const votesList = Array.isArray(res.votes) ? res.votes : [];
      votesList.forEach(pv => {
        let badgeClass = 'voto-timeout';
        let badgeText = 'Tempo Scaduto';
        if (pv.vote === 'underrated') {
          badgeClass = 'voto-under';
          badgeText = 'Sottovalutato';
        } else if (pv.vote === 'overrated') {
          badgeClass = 'voto-over';
          badgeText = 'Sopravvalutato';
        }
        playerVotesHtml += `
          <div class="summary-player-vote-row">
            <span class="summary-player-name">${pv.player || 'Giocatore'}</span>
            <span class="summary-item-voto ${badgeClass}">${badgeText}</span>
          </div>
        `;
      });

      const hasImage = isValidImageString(res.image);
      const rawPrompt = (res.prompt || res.text || '').trim();

      // Riconoscimento rigoroso di file tecnici / id / placeholder per non mostrarli MAI nei verdetti
      const isTechnicalName = !rawPrompt || 
                             /^image[_\-\.0-9]/i.test(rawPrompt) || 
                             /^img[_\-\.0-9]/i.test(rawPrompt) || 
                             /^photo[_\-\.0-9]/i.test(rawPrompt) || 
                             /^upload[_\-\.0-9]/i.test(rawPrompt) || 
                             rawPrompt.startsWith('Immagine (') || 
                             rawPrompt.toLowerCase() === 'immagine caricata' ||
                             rawPrompt.toLowerCase() === 'carta immagine' ||
                             /\.(webp|jpg|jpeg|png|gif)$/i.test(rawPrompt) ||
                             /^[a-zA-Z0-9_-]+\.(webp|jpg|jpeg|png|gif)$/i.test(rawPrompt);

      let headerLayout = '';
      if (hasImage && isTechnicalName) {
        // Foto "nuda" centrata con bordi arrotondati, senza scritte tecniche
        headerLayout = `
          <div style="display: flex; justify-content: center; width: 100%; margin-bottom: 8px;">
            <div class="summary-card-img-container" style="width: 72px; height: 72px; border-radius: 14px; overflow: hidden; border: 1px solid rgba(255,255,255,0.18); cursor: pointer; box-shadow: 0 6px 16px rgba(0,0,0,0.4); flex-shrink: 0;">
              <img class="summary-card-image" src="${res.image}" onerror="this.onerror=null; this.parentElement.style.display='none';" style="width: 100%; height: 100%; object-fit: cover; display: block;">
            </div>
          </div>
        `;
      } else if (hasImage && !isTechnicalName) {
        // Foto + Didattica pulita
        headerLayout = `
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
            <div class="summary-card-img-container" style="width: 56px; height: 56px; border-radius: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,0.18); flex-shrink: 0; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
              <img class="summary-card-image" src="${res.image}" onerror="this.onerror=null; this.parentElement.style.display='none';" style="width: 100%; height: 100%; object-fit: cover; display: block;">
            </div>
            <div class="summary-item-prompt clickable-toggle-text" style="margin-bottom: 0; flex: 1; text-align: left; cursor: pointer; font-weight: 700; font-size: 0.95rem; color: #FFFFFF;">${rawPrompt}</div>
          </div>
        `;
      } else if (!hasImage && rawPrompt) {
        // Solo testo prompt pulito
        headerLayout = `
          <div class="summary-item-prompt clickable-toggle-text" style="margin-bottom: 6px; text-align: left; cursor: pointer; font-weight: 700; font-size: 0.95rem; color: #FFFFFF;">${rawPrompt}</div>
        `;
      } else {
        // Fallback di sicurezza
        headerLayout = `
          <div class="summary-item-prompt clickable-toggle-text" style="margin-bottom: 6px; text-align: left; cursor: pointer; font-weight: 700; font-size: 0.95rem; color: #FFFFFF;">Carta #${idx + 1}</div>
        `;
      }

      const statsHtml = (state.roomIsPremium || !res.stats) 
        ? '' 
        : `<div class="summary-item-stats" style="margin-top: 6px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.06); text-align: right; font-size: 0.7rem; color: rgba(255,255,255,0.5);">Mondo: <span style="color: #F59E0B; font-weight: 700;">OVER ${res.stats.overrated || 0}%</span> / <span style="color: #06B6D4; font-weight: 700;">UNDER ${res.stats.underrated || 0}%</span></div>`;

      item.innerHTML = `
        ${headerLayout}
        <div class="summary-item-details">
          ${playerVotesHtml}
        </div>
        ${statsHtml}
      `;

      if (hasImage) {
        const imgContainer = item.querySelector('.summary-card-img-container');
        if (imgContainer) {
          bindFastClick(imgContainer, (e) => {
            if (e) {
              e.stopPropagation();
              e.preventDefault();
            }
            openCardImageZoom(res.image, isTechnicalName ? '' : (res.prompt || res.text));
          });
        }
      }

      // Permetti l'espansione al tap sulle didascalie del summary
      const promptDiv = item.querySelector('.summary-item-prompt');
      if (promptDiv) {
        bindFastClick(promptDiv, () => {
          promptDiv.classList.toggle('expanded');
        });
      }

      el.summaryCardsList.appendChild(item);
    });
  }

  // Controlli Host per riavvio / Partecipanti in attesa
  if (el.summaryHostControls && el.summaryPlayerWaiting) {
    const btnSoloMenu = document.getElementById('btn-solo-menu');
    el.summaryHostControls.style.removeProperty('display');
    el.summaryPlayerWaiting.style.removeProperty('display');

    if (state.isHost) {
      el.summaryHostControls.style.display = 'flex';
      el.summaryPlayerWaiting.style.display = 'none';
      const btnRestartSpan = el.btnRestart ? el.btnRestart.querySelector('span') : null;
      if (btnRestartSpan) {
        btnRestartSpan.textContent = "RICOMINCIA";
      }
      if (btnSoloMenu) {
        btnSoloMenu.style.display = 'none';
      }
    } else {
      el.summaryHostControls.style.display = 'none';
      el.summaryPlayerWaiting.style.display = 'flex';
      if (btnSoloMenu) {
        btnSoloMenu.style.display = 'none';
      }
    }
  }

  showScreen(el.screenSummary);
}

function showToast(message, duration = 3000) {
  const toast = document.getElementById('toast-notification');
  const toastMsg = document.getElementById('toast-message');
  if (!toast || !toastMsg) return;
  toastMsg.textContent = message;
  toast.classList.add('show');
  
  if (state.toastTimeout) {
    clearTimeout(state.toastTimeout);
  }
  
  state.toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
    state.toastTimeout = null;
  }, duration);
}

function startConnectionLoading(mode = 'join') {
  state.connectionLoadingActive = true;
  state.connectionStartTime = Date.now();
  
  showScreen(el.screenLoading);
  
  if (el.loadingSpinnerContainer) el.loadingSpinnerContainer.style.display = 'flex';
  if (el.btnLoadingHome) el.btnLoadingHome.style.display = 'none';
  
  // Messaggi contestuali in base al tipo di azione
  let initialText, progressText;
  if (mode === 'create') {
    initialText = "Creazione stanza in corso...";
    progressText = "Preparazione della lobby...";
  } else if (mode === 'restore') {
    initialText = "Riconnessione in corso...";
    progressText = "Recupero partecipanti connessi...";
  } else {
    initialText = "Connessione alla stanza in corso...";
    progressText = "Recupero partecipanti connessi...";
  }
  
  if (el.loadingStatusText) {
    el.loadingStatusText.textContent = initialText;
    el.loadingStatusText.style.opacity = 1;
  }
  
  if (state.connectionTimeout) {
    clearTimeout(state.connectionTimeout);
  }
  
  setTimeout(() => {
    if (state.connectionLoadingActive) {
      updateLoadingText(progressText);
    }
  }, 1000);

  setTimeout(() => {
    if (state.connectionLoadingActive) {
      updateLoadingText("Avvio del server in corso, attendi qualche secondo...");
    }
  }, 12000);
  
  state.connectionTimeout = setTimeout(() => {
    if (state.connectionLoadingActive) {
      handleConnectionError('timeout');
    }
  }, 35000);
}

function updateLoadingText(newText) {
  if (!el.loadingStatusText) return;
  el.loadingStatusText.style.opacity = 0;
  setTimeout(() => {
    el.loadingStatusText.textContent = newText;
    el.loadingStatusText.style.opacity = 1;
  }, 150);
}

function handleConnectionError(reason) {
  state.connectionLoadingActive = false;
  if (state.connectionTimeout) {
    clearTimeout(state.connectionTimeout);
    state.connectionTimeout = null;
  }
  
  if (el.loadingSpinnerContainer) el.loadingSpinnerContainer.style.display = 'none';
  if (el.btnLoadingHome) el.btnLoadingHome.style.display = 'block';
  
  let errorMsg = '⚠️ Connessione persa. Controlla la tua rete e riprova.';
  if (reason === 'not_found') {
    errorMsg = '❌ Questa stanza non esiste o è già terminata.';
  } else if (reason === 'locked') {
    errorMsg = "🔒 La stanza è stata chiusa dall'Host.";
  } else if (reason === 'full') {
    errorMsg = '🚫 Stanza piena. Massimo 30 giocatori raggiunto.';
  }
  
  if (el.loadingStatusText) {
    el.loadingStatusText.textContent = errorMsg;
    el.loadingStatusText.style.opacity = 1;
  }
}

function updateLockIcon() {
  if (!el.btnLockRoom) return;
  if (state.gameplayStarted) {
    el.btnLockRoom.style.display = 'none';
    return;
  }
  el.btnLockRoom.style.display = 'inline-flex';
  
  if (state.roomIsLocked) {
    el.btnLockRoom.className = 'btn-lock-room locked';
    el.btnLockRoom.title = 'Stanza bloccata (Clicca per sbloccare)';
    el.btnLockRoom.style.color = '#ff4444';
    el.btnLockRoom.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
      </svg>
    `;
  } else {
    el.btnLockRoom.className = 'btn-lock-room unlocked';
    el.btnLockRoom.title = 'Stanza aperta (Clicca per bloccare)';
    el.btnLockRoom.style.color = 'rgba(255, 255, 255, 0.4)';
    el.btnLockRoom.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z"/>
      </svg>
    `;
  }
  
  if (!state.isHost) {
    el.btnLockRoom.classList.add('disabled-lock');
  } else {
    el.btnLockRoom.classList.remove('disabled-lock');
  }
}

function openKickContextMenu(e, player) {
  state.playerToKick = player;
  
  if (el.btnKickPlayer) {
    el.btnKickPlayer.textContent = `Rimuovi ${player.name} dalla stanza`;
  }
  
  let x = 0;
  let y = 0;
  
  if (e) {
    if (e.clientX !== undefined) {
      x = e.clientX;
      y = e.clientY;
    } else if (e.touches && e.touches.length > 0) {
      x = e.touches[0].clientX;
      y = e.touches[0].clientY;
    } else if (e.changedTouches && e.changedTouches.length > 0) {
      x = e.changedTouches[0].clientX;
      y = e.changedTouches[0].clientY;
    }
  }
  
  if (el.kickContextMenu) {
    el.kickContextMenu.style.display = 'block';
    const menuWidth = el.kickContextMenu.offsetWidth || 200;
    const menuHeight = el.kickContextMenu.offsetHeight || 100;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    if (x + menuWidth > windowWidth) {
      x = windowWidth - menuWidth - 10;
    }
    if (y + menuHeight > windowHeight) {
      y = windowHeight - menuHeight - 10;
    }
    
    el.kickContextMenu.style.left = `${x}px`;
    el.kickContextMenu.style.top = `${y}px`;
  }
}

async function checkUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const payment = params.get('payment');
  const sessionIdParam = params.get('session_id');

  if (payment === 'success' && sessionIdParam) {
    const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
    window.history.replaceState({ path: cleanUrl }, '', cleanUrl);

    try {
      let token = safeSessionStorage.getItem('overunder_token');
      if (!token) {
        token = await authenticateHost("host_player");
        safeSessionStorage.setItem('overunder_token', token);
      }

      const res = await fetch(`/api/stripe/verify-session?session_id=${sessionIdParam}`, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.token) {
          safeSessionStorage.setItem('overunder_token', data.token);
          safeStorage.setItem('overunder_token', data.token);
          safeStorage.setItem('overunder_premium_unlocked', 'true');
        }
        state.roomIsPremium = true;
        if (el.createPremiumToggle) {
          el.createPremiumToggle.checked = true;
        }
        showToast("Pagamento confermato! Modalità \"Judgement Day\" sbloccata per sempre! 👑", 5000);
        updatePremiumUI();
      }
    } catch (e) {
      console.error("Errore verifica pagamento:", e);
    }
  }

  let room = params.get('room');
  
  if (!room) {
    // Controllo se il codice stanza è passato nel path (es. /join/ABCD o /join/abcd)
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    if (pathParts.length >= 2 && pathParts[0].toLowerCase() === 'join') {
      room = pathParts[1];
    }
  }

  if (room) {
    console.log('[INVITE] Rilevato codice stanza da URL:', room);
    // Pulisci le sessioni residue di vecchie stanze per evitare che restore_session le sovrascriva
    clearSession();
    const cleanUrl = window.location.protocol + "//" + window.location.host + "/";
    window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
    const decodedRoom = decodeURIComponent(room.replace(/\+/g, ' ')).trim().toUpperCase();
    console.log('[INVITE] Room decodificata:', decodedRoom);
    showJoinFromLink(decodedRoom);
    return true; // Segnala che c'è un invite link attivo
  }
  return false;
}

function showJoinFromLink(roomCode) {
  const cleanCode = (roomCode || '').trim().toUpperCase();
  console.log('[INVITE] showJoinFromLink - codice:', cleanCode);
  state.pendingRoomToJoin = cleanCode;
  safeSessionStorage.setItem('overunder_pendingRoom', cleanCode);
  
  // Interroga il server per recuperare la modalità della stanza e predisporre le slide
  fetchAndApplyRoomInfo(cleanCode, false);

  // Nascondi le schede standard
  if (el.modeTabs) el.modeTabs.style.display = 'none';
  if (el.formSoloPlay) el.formSoloPlay.style.display = 'none';
  if (el.formCreateRoom) el.formCreateRoom.style.display = 'none';
  
  // Mostra il form dedicato
  if (el.joinRoomCodeDisplay) el.joinRoomCodeDisplay.textContent = cleanCode;
  if (el.formJoinRoomLink) {
    el.formJoinRoomLink.style.display = 'block';
    console.log('[INVITE] Form join-room-link mostrato');
  } else {
    console.error('[INVITE] ERRORE: el.formJoinRoomLink non trovato nel DOM!');
  }
  
  // Resetta input ed errori
  if (el.joinNameInput) {
    const savedName = state.playerName || safeSessionStorage.getItem('overunder_playerName') || '';
    el.joinNameInput.value = savedName;
  }
  if (el.nameErrorMsg) el.nameErrorMsg.style.display = 'none';
}

function resetFromJoinLink() {
  state.pendingRoomToJoin = null;
  if (el.formJoinRoomLink) el.formJoinRoomLink.style.display = 'none';
  if (el.modeTabs) el.modeTabs.style.display = 'flex';
  
  // Torna a mostrare il tab Gioco Solo attivo
  if (el.tabSolo) el.tabSolo.classList.add('active');
  if (el.tabCreate) el.tabCreate.classList.remove('active');
  if (el.formSoloPlay) el.formSoloPlay.style.display = 'block';
  if (el.formCreateRoom) el.formCreateRoom.style.display = 'none';
  if (el.nameErrorMsg) el.nameErrorMsg.style.display = 'none';
}

function getDeckMeta(deckId) {
  const meta = {
    'gli_intoccabili': {
      emoji: '🔥',
      desc: "Cibo, tradizioni e icone nazionali. Il mazzo perfetto per accendere accesi dibattiti culturali all'italiana."
    },
    'tendenze_social': {
      emoji: '📱',
      desc: "Social network, comportamenti moderni, TikTok ed abitudini digitali. Scopri quanto sei allineato con la Gen-Z."
    },
    'vita_ufficio': {
      emoji: '👔',
      desc: "Riunioni infinite, Smart Working e caffè tristi della macchinetta. Esprimi il tuo odio represso per il corporate."
    },
    'nerd_tech': {
      emoji: '🚀',
      desc: "Programmazione, videogiochi, intelligenza artificiale e stranezze hi-tech. Solo per veri smanettoni."
    },
    'cibo_cucina': {
      emoji: '🍔',
      desc: "Cibi discutibili, abitudini culinarie bizzarre e regole non scritte della tavola. Da far venire fame (o ribrezzo)."
    },
    'nostalgia_retro': {
      emoji: '🎒',
      desc: "Walkman, modem 56k, MSN, vecchi cartoni animati e ricordi d'infanzia degli anni '90 e 2000."
    },
    'viaggi_vacanze': {
      emoji: '✈️',
      desc: "Voli low-cost, alberghi discutibili, valigie al limite del peso consentito e applausi all'atterraggio."
    },
    'pop_culture': {
      emoji: '🍿',
      desc: "Maratone di serie TV, meme virali, cinema sovrapprezzo, faide cinematografiche e podcast ossessivi."
    },
    'sport_salute': {
      emoji: '🏋️',
      desc: "Buoni propositi di gennaio, frullati proteici al sapore di gesso, crossfit e calcetti del lunedì sera."
    },
    'vita_adulta': {
      emoji: '💸',
      desc: "Bollette da pagare, mobili Ikea montati al contrario e la gioia inspiegabile per una scopa elettrica nuova."
    },
    'traffico_mezzi': {
      emoji: '🚗',
      desc: "Ritardi dei regionali, semafori rossi eterni, rotonde contromano e parcheggi impossibili in centro."
    },
    'animali_natura': {
      emoji: '🐾',
      desc: "Gatti che preferiscono le scatole di cartone, cani che abbaiano al vento, zanzare notturne e piante appassite."
    },
    'relazioni_social': {
      emoji: '🎭',
      desc: "Messaggi vocali di 10 minuti, amici perennemente in ritardo, primi appuntamenti disastrosi e silenzi in ascensore."
    }
  };
  return meta[deckId] || { emoji: '🎮', desc: "Nuovo mazzo speciale! Mettiti alla prova con questa divertente categoria." };
}

// ==========================================================================
// MODAL SLIDE CAROUSEL ONBOARDING GUEST ("COME SI GIOCA")
// ==========================================================================
state.joinRulesCurrentSlide = 0;
state.joinRulesIsPremium = false;
state.joinRulesAutoOpened = false;

function renderJoinRulesSlides(isPremium = false) {
  const track = document.getElementById('join-carousel-track');
  const modeBanner = document.getElementById('join-room-mode-banner');
  const modeTag = document.getElementById('join-room-mode-tag');
  const modalModeTag = document.getElementById('join-modal-mode-tag');
  const modalCard = document.querySelector('.join-rules-modal-card');

  if (modeBanner) modeBanner.className = `join-room-banner ${isPremium ? 'mode-premium' : 'mode-standard'}`;
  
  if (modeTag) {
    modeTag.style.display = 'none';
    modeTag.innerHTML = '';
  }
  if (modalModeTag) {
    modalModeTag.style.display = 'inline-flex';
    modalModeTag.className = `join-modal-mode-tag ${isPremium ? 'tag-premium' : 'tag-standard'}`;
    modalModeTag.innerHTML = isPremium ? `👑 MODALITÀ "JUDGEMENT DAY"` : `🎯 MODALITÀ STANDARD`;
  }
  if (modalCard) {
    modalCard.className = `join-rules-modal-card ${isPremium ? 'mode-premium' : 'mode-standard'}`;
  }

  if (!track) return;

  if (isPremium) {
    track.innerHTML = `
      <div class="join-slide">
        <div class="join-slide-icon-box">📱</div>
        <div class="join-slide-title">1. Il Vostro Mazzo 📱</div>
        <div class="join-slide-desc">
          Tutti i partecipanti creano il mazzo inserendo contemporaneamente immagini e didascalie personalizzate.
        </div>
      </div>

      <div class="join-slide">
        <div class="join-slide-icon-box">🛑</div>
        <div class="join-slide-title">2. Zero Filtri 🛑</div>
        <div class="join-slide-desc">
          Ogni giocatore deve inserire almeno una carta per poter iniziare. Non c'è alcun limite al massimo di carte inseribili. Vale tutto.
        </div>
      </div>

      <div class="join-slide">
        <div class="join-slide-icon-box">🕵️</div>
        <div class="join-slide-title">3. Anonimato & Caos 🕵️</div>
        <div class="join-slide-desc">
          Le carte vengono mostrate in modo completamente anonimo. Sparate a zero: nessuno saprà chi ha inserito la frase, ma il gruppo voterà di pancia scatenando il dibattito al tavolo. <strong>È sopravvalutato (OVER) o sottovalutato (UNDER)?</strong>
        </div>
      </div>
    `;
  } else {
    track.innerHTML = `
      <div class="join-slide">
        <div class="join-slide-icon-box">💡</div>
        <div class="join-slide-title">1. La Carta 💡</div>
        <div class="join-slide-desc">
          Ti verrà mostrata una carta casuale: ogni carta nasconde un'entità diversa, dalla più iconica alla più inaspettata...
        </div>
      </div>

      <div class="join-slide">
        <div class="join-slide-icon-box">🤔</div>
        <div class="join-slide-title">2. La Scelta 🤔</div>
        <div class="join-slide-desc">
          Sputa il rospo. È sopravvalutato (OVER) o sottovalutato (UNDER)? Vota di pancia senza farti spiare.
        </div>
      </div>

      <div class="join-slide">
        <div class="join-slide-icon-box">📊</div>
        <div class="join-slide-title">3. Il Verdetto 📊</div>
        <div class="join-slide-desc">
          Scatena il dibattito. Scopri chi la pensa come te e individua immediatamente il caso umano del gruppo.
        </div>
      </div>
    `;
  }
}

function goToJoinRulesSlide(slideIndex) {
  state.joinRulesCurrentSlide = Math.max(0, Math.min(2, slideIndex));
  const track = document.getElementById('join-carousel-track');
  const dots = document.querySelectorAll('#join-carousel-dots .join-dot');
  const prevBtn = document.getElementById('btn-carousel-prev');
  const nextBtn = document.getElementById('btn-carousel-next');
  const finishBtn = document.getElementById('btn-carousel-finish');

  if (track) {
    track.style.transform = `translateX(-${state.joinRulesCurrentSlide * 33.33333}%)`;
  }

  dots.forEach((dot, index) => {
    dot.classList.toggle('active', index === state.joinRulesCurrentSlide);
  });

  if (prevBtn) {
    prevBtn.style.visibility = state.joinRulesCurrentSlide > 0 ? 'visible' : 'hidden';
  }

  if (state.joinRulesCurrentSlide === 2) {
    if (nextBtn) nextBtn.style.display = 'none';
    if (finishBtn) finishBtn.style.display = 'inline-block';
  } else {
    if (nextBtn) nextBtn.style.display = 'inline-block';
    if (finishBtn) finishBtn.style.display = 'none';
  }
}

function openJoinRulesModal(isPremium = false) {
  state.joinRulesIsPremium = !!isPremium;
  renderJoinRulesSlides(state.joinRulesIsPremium);
  goToJoinRulesSlide(0);

  const modal = document.getElementById('join-rules-modal');
  if (modal) {
    modal.style.display = 'flex';
    modal.offsetHeight; // force reflow
    modal.classList.remove('hidden');
    try { AudioSynth.playConfirm(true); } catch (e) {}
  }
}

function closeJoinRulesModal() {
  const modal = document.getElementById('join-rules-modal');
  if (modal) {
    modal.classList.add('hidden');
    setTimeout(() => {
      modal.style.display = 'none';
    }, 300);
    try { AudioSynth.playConfirm(false); } catch (e) {}
  }
  if (el.joinNameInput && el.formJoinRoomLink && el.formJoinRoomLink.style.display !== 'none') {
    setTimeout(() => {
      try { el.joinNameInput.focus(); } catch (e) {}
    }, 350);
  }
}

async function fetchAndApplyRoomInfo(roomCode, autoOpenModal = false) {
  if (!roomCode) return;
  try {
    const res = await fetch(`/api/room-info?code=${encodeURIComponent(roomCode)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.exists) {
        state.joinRulesIsPremium = !!data.isPremium;
        renderJoinRulesSlides(state.joinRulesIsPremium);
        if (autoOpenModal && !state.joinRulesAutoOpened) {
          state.joinRulesAutoOpened = true;
          setTimeout(() => { openJoinRulesModal(state.joinRulesIsPremium); }, 350);
        }
        return;
      }
    }
  } catch (e) {
    console.warn("Errore recupero info stanza:", e);
  }
  renderJoinRulesSlides(false);
  if (autoOpenModal && !state.joinRulesAutoOpened) {
    state.joinRulesAutoOpened = true;
    setTimeout(() => { openJoinRulesModal(false); }, 350);
  }
}

function setupJoinRulesModalEvents() {
  const triggerBtn = document.getElementById('btn-trigger-join-rules-modal');
  const closeBtn = document.getElementById('btn-close-join-rules-modal');
  const prevBtn = document.getElementById('btn-carousel-prev');
  const nextBtn = document.getElementById('btn-carousel-next');
  const finishBtn = document.getElementById('btn-carousel-finish');
  const modalOverlay = document.getElementById('join-rules-modal');
  const dots = document.querySelectorAll('#join-carousel-dots .join-dot');
  const viewport = document.getElementById('join-carousel-viewport');

  if (triggerBtn) {
    bindFastClick(triggerBtn, () => {
      openJoinRulesModal(state.joinRulesIsPremium);
    });
  }

  if (closeBtn) {
    bindFastClick(closeBtn, closeJoinRulesModal);
  }

  if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) {
        closeJoinRulesModal();
      }
    });
  }

  if (prevBtn) {
    bindFastClick(prevBtn, () => {
      goToJoinRulesSlide(state.joinRulesCurrentSlide - 1);
      try { AudioSynth.playConfirm(false); } catch (e) {}
    });
  }

  if (nextBtn) {
    bindFastClick(nextBtn, () => {
      goToJoinRulesSlide(state.joinRulesCurrentSlide + 1);
      try { AudioSynth.playConfirm(true); } catch (e) {}
    });
  }

  if (finishBtn) {
    bindFastClick(finishBtn, () => {
      closeJoinRulesModal();
    });
  }

  dots.forEach(dot => {
    bindFastClick(dot, () => {
      const idx = parseInt(dot.getAttribute('data-slide'), 10) || 0;
      goToJoinRulesSlide(idx);
      try { AudioSynth.playConfirm(true); } catch (e) {}
    });
  });

  // Touch & Swipe Support fluido su Mobile (Slide sinistra/destra)
  if (viewport) {
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    let isTouchActive = false;

    viewport.addEventListener('touchstart', (e) => {
      if (!e.touches || e.touches.length === 0) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartTime = Date.now();
      isTouchActive = true;
    }, { passive: true });

    viewport.addEventListener('touchmove', (e) => {
      if (!isTouchActive || !e.touches || e.touches.length === 0) return;
      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      const diffX = currentX - touchStartX;
      const diffY = currentY - touchStartY;

      // Se il movimento è prevalentemente orizzontale, previene rimbalzi verticali
      if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 10) {
        if (e.cancelable) e.preventDefault();
      }
    }, { passive: false });

    const handleSwipeEnd = (e) => {
      if (!isTouchActive) return;
      isTouchActive = false;
      const touch = (e.changedTouches && e.changedTouches.length > 0) ? e.changedTouches[0] : null;
      if (!touch) return;

      const deltaX = touch.clientX - touchStartX;
      const deltaY = touch.clientY - touchStartY;
      const elapsedTime = Date.now() - touchStartTime;

      const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY);
      const isSignificantSwipe = Math.abs(deltaX) > 35 || (Math.abs(deltaX) > 20 && elapsedTime < 250);

      if (isHorizontal && isSignificantSwipe) {
        if (deltaX < 0) {
          // Swipe a sinistra -> Slide Successiva (Avanti)
          if (state.joinRulesCurrentSlide < 2) {
            goToJoinRulesSlide(state.joinRulesCurrentSlide + 1);
            try { AudioSynth.playConfirm(true); } catch (err) {}
          }
        } else if (deltaX > 0) {
          // Swipe a destra -> Slide Precedente (Indietro)
          if (state.joinRulesCurrentSlide > 0) {
            goToJoinRulesSlide(state.joinRulesCurrentSlide - 1);
            try { AudioSynth.playConfirm(false); } catch (err) {}
          }
        }
      }
    };

    viewport.addEventListener('touchend', handleSwipeEnd, { passive: true });
    viewport.addEventListener('touchcancel', () => { isTouchActive = false; }, { passive: true });

    // Supporto Drag con Mouse / Pointer per testing desktop
    let mouseStartX = 0;
    let mouseStartY = 0;
    let isMouseDown = false;
    let mouseStartTime = 0;

    viewport.addEventListener('mousedown', (e) => {
      isMouseDown = true;
      mouseStartX = e.clientX;
      mouseStartY = e.clientY;
      mouseStartTime = Date.now();
    });

    window.addEventListener('mouseup', (e) => {
      if (!isMouseDown) return;
      isMouseDown = false;
      const deltaX = e.clientX - mouseStartX;
      const deltaY = e.clientY - mouseStartY;
      const elapsedTime = Date.now() - mouseStartTime;

      if (Math.abs(deltaX) > Math.abs(deltaY) && (Math.abs(deltaX) > 40 || (Math.abs(deltaX) > 20 && elapsedTime < 250))) {
        if (deltaX < 0 && state.joinRulesCurrentSlide < 2) {
          goToJoinRulesSlide(state.joinRulesCurrentSlide + 1);
          try { AudioSynth.playConfirm(true); } catch (err) {}
        } else if (deltaX > 0 && state.joinRulesCurrentSlide > 0) {
          goToJoinRulesSlide(state.joinRulesCurrentSlide - 1);
          try { AudioSynth.playConfirm(false); } catch (err) {}
        }
      }
    });
  }

  // Pre-render di base
  renderJoinRulesSlides(false);
}

let lastCaptionTapTimestamp = 0;

function setupCaptionTapListeners() {
  const handleCaptionTap = (e) => {
    const target = e.target ? e.target.closest('.card-caption, .prompt-text, .results-prompt-subject, .capsule-text, .summary-item-prompt') : null;
    if (!target) return;

    const now = Date.now();
    if (now - lastCaptionTapTimestamp < 250) {
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      return;
    }
    lastCaptionTapTimestamp = now;

    // Evita che il tap venga intercettato dal drag/swipe o card flip della carta
    e.stopPropagation();
    target.classList.toggle('is-expanded');

    const parentCard = target.closest('.prompt-card, .results-prompt-card, .premium-card-capsule');
    if (parentCard) {
      parentCard.classList.toggle('is-expanded');
    }

    console.log("--> TAP TESTO ESEGUITO. Espanso:", target.classList.contains('is-expanded'));
  };

  // Aggancia in fase di Capture sia per click che touchend per intercettare prima dei gestori di swipe/drag
  document.addEventListener('click', handleCaptionTap, true);
  document.addEventListener('touchend', handleCaptionTap, true);
}

// Helper per la gestione reattiva a 0ms dei tocchi su smartphone (evita il ritardo di 300ms dei browser mobile)
function bindFastClick(element, callback) {
  if (!element) return;
  let isExecuted = false;

  const handleAction = (e) => {
    if (e) {
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
    }
    if (isExecuted) return;
    isExecuted = true;
    setTimeout(() => { isExecuted = false; }, 250);
    callback(e);
  };

  element.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.pointerType === 'mouse') {
      handleAction(e);
    }
  }, { passive: false });

  element.addEventListener('click', handleAction, { passive: false });
}

// Funzioni helper per la gestione del Drawer laterale delle opzioni carta (#card-actions-drawer)
function openCardDrawer(cardIndex) {
  const cardObj = state.localPremiumCards[cardIndex];
  if (!cardObj) return;

  state.selectedCardIndex = cardIndex;

  const drawerTitle = el.drawerCardTitle || document.getElementById('drawer-card-title');
  if (drawerTitle) {
    const textSnippet = cardObj.text ? (cardObj.text.length > 18 ? cardObj.text.substring(0, 18) + '...' : cardObj.text) : 'Opzioni Carta';
    drawerTitle.textContent = textSnippet;
  }

  const drawer = el.cardActionsDrawer || document.getElementById('card-actions-drawer');
  if (drawer) {
    drawer.classList.remove('hidden');
  }
  try { AudioSynth.playConfirm(true); } catch (e) {}
}

function closeCardDrawer() {
  const drawer = el.cardActionsDrawer || document.getElementById('card-actions-drawer');
  if (drawer) {
    drawer.classList.add('hidden');
  }
  state.selectedCardIndex = null;
  try { AudioSynth.playConfirm(false); } catch (e) {}
}

// Ripristina e pulisce l'input delle carte e l'icona di caricamento media in Judgement Day
function resetPremiumCardInputState() {
  state.currentCroppedImage = null;
  state.currentUploadedFilename = '';
  if (el.premiumImagePreviewContainer) {
    el.premiumImagePreviewContainer.style.display = 'none';
  }
  if (el.premiumImagePreview) {
    el.premiumImagePreview.src = '';
  }
  if (el.premiumCardInput) {
    el.premiumCardInput.value = '';
    el.premiumCardInput.disabled = false;
    el.premiumCardInput.style.display = 'block';
    el.premiumCardInput.placeholder = 'A cosa stai pensando?';
    el.premiumCardInput.style.paddingLeft = '42px';
    el.premiumCardInput.style.paddingRight = '42px';
  }
  if (el.btnTriggerPremiumPhoto) {
    el.btnTriggerPremiumPhoto.style.display = 'inline-flex';
  }
  if (el.lblPremiumImageUpload) {
    el.lblPremiumImageUpload.style.display = 'inline-flex';
  }
  if (el.premiumPhotoPopover) {
    el.premiumPhotoPopover.style.display = 'none';
  }
  if (el.premiumImageUpload) {
    el.premiumImageUpload.value = '';
  }
  if (el.inputPremiumCamera) {
    el.inputPremiumCamera.value = '';
  }
  if (activeCropper) {
    try { activeCropper.destroy(); } catch (e) {}
    activeCropper = null;
  }
}

// Eventi e logica per l'editor delle carte Premium personalizzate
function renderCapsules() {
  el.premiumCardsList.innerHTML = '';
  
  // Ordine cronologico inverso: la carta più recente appare in cima alla lista
  const reversedIndices = state.localPremiumCards.map((_, i) => i).reverse();
  reversedIndices.forEach((index) => {
    const cardObj = state.localPremiumCards[index];
    const capsule = document.createElement('div');
    
    const hasImage = isValidImageString(cardObj.image);
    const imgHtml = hasImage ? `<img src="${cardObj.image}" class="capsule-img-thumb" onerror="this.style.display='none'" style="width: 32px; height: 32px; border-radius: 6px; object-fit: cover; margin-right: 8px; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.15); cursor: pointer;" title="Ingrandisci immagine">` : '';
    const genericName = `Immagine (${index + 1})`;
    const textToDisplay = (hasImage && !cardObj.text) ? genericName : (cardObj.text || genericName);

    if (state.editingPremiumCardIndex === index) {
      capsule.className = 'premium-card-capsule inline-editing';
      capsule.innerHTML = `
        <div style="display: flex; align-items: center; flex: 1; min-width: 0;">
          ${imgHtml}
          <input type="text" class="capsule-inline-input" value="${cardObj.text || ''}" maxlength="100">
        </div>
        <button class="btn-capsule-save" title="Salva">✓</button>
        <button class="btn-capsule-cancel" title="Annulla">&times;</button>
      `;

      const input = capsule.querySelector('.capsule-inline-input');
      const btnSave = capsule.querySelector('.btn-capsule-save');
      const btnCancel = capsule.querySelector('.btn-capsule-cancel');
      const imgThumb = capsule.querySelector('.capsule-img-thumb');

      if (imgThumb) {
        bindFastClick(imgThumb, (e) => {
          if (e) {
            e.stopPropagation();
            e.preventDefault();
          }
          openCardImageZoom(cardObj.image, cardObj.text);
        });
      }

      const saveInlineEdit = () => {
        const newText = input.value.trim();
        if (newText || cardObj.image) {
          state.localPremiumCards[index].text = newText || `Immagine (${index + 1})`;
          if (state.hasSubmittedPremiumCards) {
            socket.emit('submit_premium_cards', { cards: state.localPremiumCards });
          }
        }
        state.editingPremiumCardIndex = null;
        renderCapsules();
        try { AudioSynth.playConfirm(true); } catch (e) {}
      };

      const cancelInlineEdit = () => {
        state.editingPremiumCardIndex = null;
        renderCapsules();
      };

      bindFastClick(btnSave, saveInlineEdit);
      bindFastClick(btnCancel, cancelInlineEdit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveInlineEdit();
        } else if (e.key === 'Escape') {
          cancelInlineEdit();
        }
      });

      requestAnimationFrame(() => {
        if (input) {
          input.focus();
          input.select();
        }
      });

    } else {
      capsule.className = 'premium-card-capsule';
      capsule.innerHTML = `
        <div class="capsule-content-clickable" style="display: flex; align-items: center; flex: 1; min-width: 0; cursor: pointer;">
          ${imgHtml}
          <span class="capsule-text" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${textToDisplay}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
          <button class="capsule-quick-edit" title="Modifica">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
            </svg>
          </button>
          <button class="capsule-quick-delete" title="Elimina">&times;</button>
        </div>
      `;

      const contentClickable = capsule.querySelector('.capsule-content-clickable');
      const btnQuickEdit = capsule.querySelector('.capsule-quick-edit');
      const btnQuickDelete = capsule.querySelector('.capsule-quick-delete');
      const textSpan = capsule.querySelector('.capsule-text');
      const imgThumb = capsule.querySelector('.capsule-img-thumb');

      if (imgThumb) {
        bindFastClick(imgThumb, (e) => {
          if (e) {
            e.stopPropagation();
            e.preventDefault();
          }
          openCardImageZoom(cardObj.image, cardObj.text);
        });
      }

      const toggleExpandText = (e) => {
        if (e && e.target && e.target.closest('.capsule-img-thumb')) {
          return;
        }
        if (textSpan) {
          textSpan.classList.toggle('expanded');
        }
      };

      const startEditing = () => {
        if (cardObj.image) {
          state.cropperTarget = 'card';
          el.cropperImageTarget.src = cardObj.image;
          el.cropperModal.style.display = 'flex';
          el.cropperModal.offsetHeight;
          el.cropperModal.classList.add('active');

          initCropper(el.cropperImageTarget);

          state.editingPremiumCardIndex = index;
        } else {
          state.editingPremiumCardIndex = index;
          renderCapsules();
        }
      };

      const deleteCardDirect = () => {
        state.localPremiumCards.splice(index, 1);
        if (state.editingPremiumCardIndex === index) {
          state.editingPremiumCardIndex = null;
        }
        renderCapsules();
        if (state.hasSubmittedPremiumCards) {
          socket.emit('submit_premium_cards', { cards: state.localPremiumCards });
        }
        try { AudioSynth.playConfirm(false); } catch (e) {}
      };

      bindFastClick(contentClickable, toggleExpandText);
      bindFastClick(btnQuickEdit, startEditing);
      bindFastClick(btnQuickDelete, deleteCardDirect);
    }

    el.premiumCardsList.appendChild(capsule);
  });

  if (el.btnPremiumCardsSubmit) {
    el.btnPremiumCardsSubmit.disabled = state.localPremiumCards.length === 0;
  }
}

function setupPremiumCreatorEvents() {
  state.localPremiumCards = [];
  state.editingPremiumCardIndex = null;
  resetPremiumCardInputState();

  // Gestione interazione ed eventi per il Drawer laterale delle opzioni carta
  const drawer = el.cardActionsDrawer || document.getElementById('card-actions-drawer');
  const closeBtn = el.drawerCloseBtn || document.querySelector('.drawer-close-btn');
  const editBtn = el.btnEditCard || document.getElementById('btn-edit-card');
  const deleteBtn = el.btnDeleteCard || document.getElementById('btn-delete-card');

  if (closeBtn) {
    bindFastClick(closeBtn, closeCardDrawer);
  }

  if (drawer) {
    drawer.addEventListener('click', (e) => {
      if (e.target === drawer) {
        closeCardDrawer();
      }
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer && !drawer.classList.contains('hidden')) {
      closeCardDrawer();
    }
  });

  if (editBtn) {
    bindFastClick(editBtn, () => {
      const index = state.selectedCardIndex;
      if (index === null || index === undefined) return;
      const cardObj = state.localPremiumCards[index];
      if (!cardObj) return;

      closeCardDrawer();

      if (cardObj.image) {
        // Carica l'immagine nel target e apri modal di crop per la modifica dell'immagine
        state.cropperTarget = 'card';
        el.cropperImageTarget.src = cardObj.image;
        el.cropperModal.style.display = 'flex';
        el.cropperModal.offsetHeight; // trigger reflow
        el.cropperModal.classList.add('active');

        initCropper(el.cropperImageTarget);

        state.editingPremiumCardIndex = index;
      } else {
        // Attiva modifica inline direttamente nella stessa riga della capsule
        state.editingPremiumCardIndex = index;
        renderCapsules();
      }
    });
  }

  if (deleteBtn) {
    bindFastClick(deleteBtn, () => {
      const index = state.selectedCardIndex;
      if (index !== null && index !== undefined && state.localPremiumCards[index]) {
        state.localPremiumCards.splice(index, 1);
        if (state.editingPremiumCardIndex === index) {
          state.editingPremiumCardIndex = null;
        }
        renderCapsules();

        if (state.hasSubmittedPremiumCards) {
          socket.emit('submit_premium_cards', { cards: state.localPremiumCards });
        }
      }
      closeCardDrawer();
    });
  }

  const addCard = () => {
    const val = el.premiumCardInput ? el.premiumCardInput.value.trim() : '';
    if (!val && !state.currentCroppedImage) return;

    const cardData = {
      text: state.currentCroppedImage 
        ? `Immagine (${state.localPremiumCards.length + 1})` 
        : val,
      image: state.currentCroppedImage || null
    };

    if (state.editingPremiumCardIndex !== null && state.editingPremiumCardIndex !== undefined && state.localPremiumCards[state.editingPremiumCardIndex]) {
      // Aggiorna in-place la carta esistente in modifica
      state.localPremiumCards[state.editingPremiumCardIndex] = cardData;
      state.editingPremiumCardIndex = null;
    } else {
      // Controllo duplicati solo per nuova carta
      const exists = state.localPremiumCards.some(c => {
        if (state.currentCroppedImage) {
          return c.image === state.currentCroppedImage;
        }
        return c.text === val;
      });
      
      if (!exists) {
        state.localPremiumCards.push(cardData);
      }
    }

    renderCapsules();

    if (state.hasSubmittedPremiumCards) {
      socket.emit('submit_premium_cards', { cards: state.localPremiumCards });
    }

    // Reset completo dell'input e ripristino icona caricamento immagine
    resetPremiumCardInputState();
    if (el.premiumCardInput) {
      el.premiumCardInput.focus();
    }
    
    AudioSynth.playConfirm(true);
  };

  if (el.btnPremiumCardAdd) {
    el.btnPremiumCardAdd.addEventListener('click', addCard);
  }

  if (el.premiumCardInput) {
    el.premiumCardInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addCard();
      }
    });
  }

  if (el.btnPremiumCardsSubmit) {
    el.btnPremiumCardsSubmit.addEventListener('click', () => {
      if (state.localPremiumCards.length === 0) return;
      
      AudioSynth.playConfirm(true);
      socket.emit('submit_premium_cards', { cards: state.localPremiumCards });
      
      // NON impostare hasSubmittedPremiumCards qui — aspetta l'ACK dal server (cards_received_success)
      // Safety net: se il server non risponde entro 3 secondi, imposta comunque lo stato
      if (state._premiumCardsAckTimeout) clearTimeout(state._premiumCardsAckTimeout);
      state._premiumCardsAckTimeout = setTimeout(() => {
        if (!state.hasSubmittedPremiumCards) {
          console.warn('[CARDS TIMEOUT] Server non ha risposto con ACK entro 3s. Impostazione hasSubmittedPremiumCards forzata.');
          state.hasSubmittedPremiumCards = true;
          setupLobbyUI();
        }
      }, 3000);

      setupLobbyUI();
    });
  }
  
  const handleCardFile = (file) => {
    if (!file) return;

    state.cropperTarget = 'card';
    state.cropperSource = 'upload';
    const cardCount = (state.localPremiumCards ? state.localPremiumCards.length : 0) + 1;
    state.currentUploadedFilename = `image_${Date.now()}_${cardCount}.webp`;

    const reader = new FileReader();
    reader.onload = (event) => {
      el.cropperImageTarget.src = event.target.result;
      el.cropperModal.style.display = 'flex';
      el.cropperModal.offsetHeight; // trigger reflow
      el.cropperModal.classList.add('active');

      initCropper(el.cropperImageTarget);
    };
    reader.readAsDataURL(file);
  };

  // Image upload and Cropper events con reset immediato dell'input value per abilitare ricaricamento
  if (el.premiumImageUpload) {
    el.premiumImageUpload.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleCardFile(e.target.files[0]);
      }
      e.target.value = '';
    });
  }

  if (el.inputPremiumCamera) {
    el.inputPremiumCamera.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleCardFile(e.target.files[0]);
      }
      e.target.value = '';
    });
  }

  // Trigger Popover Scatta / Carica per Modalità Judgement Day
  if (el.btnTriggerPremiumPhoto) {
    el.btnTriggerPremiumPhoto.addEventListener('click', (e) => {
      e.stopPropagation();
      if (el.premiumPhotoPopover) {
        const isOpen = el.premiumPhotoPopover.style.display === 'flex';
        el.premiumPhotoPopover.style.display = isOpen ? 'none' : 'flex';
      }
    });
  }

  if (el.btnPremiumSelectCamera) {
    el.btnPremiumSelectCamera.addEventListener('click', (e) => {
      e.stopPropagation();
      if (el.premiumPhotoPopover) el.premiumPhotoPopover.style.display = 'none';
      openInAppCamera('card');
    });
  }

  if (el.btnPremiumSelectUpload) {
    el.btnPremiumSelectUpload.addEventListener('click', (e) => {
      e.stopPropagation();
      if (el.premiumPhotoPopover) el.premiumPhotoPopover.style.display = 'none';
      if (el.premiumImageUpload) el.premiumImageUpload.click();
    });
  }

  if (el.btnPremiumSelectWeb) {
    el.btnPremiumSelectWeb.addEventListener('click', (e) => {
      e.stopPropagation();
      if (el.premiumPhotoPopover) el.premiumPhotoPopover.style.display = 'none';
      openWebImageSearchModal();
    });
  }

  document.addEventListener('click', (e) => {
    if (el.premiumPhotoPopover && el.premiumPhotoPopover.style.display === 'flex') {
      if (!el.premiumPhotoPopover.contains(e.target) && e.target !== el.btnTriggerPremiumPhoto && !el.btnTriggerPremiumPhoto.contains(e.target)) {
        el.premiumPhotoPopover.style.display = 'none';
      }
    }
  });

  // Configura la modale di ricerca immagini web Pixabay
  setupWebImageSearch();

  if (el.btnCropperConfirm) {
    el.btnCropperConfirm.addEventListener('click', async () => {
      if (!activeCropper) return;

      // Compressione HD Client-Side: 1200px per carte, 512px per avatar HD
      const isAvatar = state.cropperTarget === 'avatar';
      const maxSize = isAvatar ? 512 : 1200;
      const canvas = activeCropper.getCroppedCanvas({
        width: maxSize,
        height: maxSize,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high'
      });

      if (canvas) {
        const confirmBtn = el.btnCropperConfirm;
        confirmBtn.disabled = true;
        const oldText = confirmBtn.textContent;
        confirmBtn.textContent = 'Caricamento...';

        // WebP HD al 92% di qualità (nitidezza visiva eccellente)
        const quality = isAvatar ? 0.92 : 0.88;
        let mimeType = 'image/webp';
        let dataUrl = canvas.toDataURL(mimeType, quality);
        if (!dataUrl.startsWith('data:image/webp')) {
          mimeType = 'image/jpeg';
          dataUrl = canvas.toDataURL(mimeType, quality);
        }

        const ext = mimeType === 'image/webp' ? '.webp' : '.jpg';
        const filename = state.currentUploadedFilename || 'img_' + Date.now() + ext;
        
        try {
          const uploadUrl = await uploadImage(dataUrl, filename);
          if (uploadUrl) {
            if (state.cropperTarget === 'avatar') {
              // Imposta l'avatar dell'utente
              state.playerAvatarUrl = uploadUrl;
              localStorage.setItem('overunder_avatarUrl', uploadUrl);
              
              el.avatarDefaultSvg.style.display = 'none';
              el.avatarPreviewImg.src = uploadUrl;
              el.avatarPreviewImg.style.display = 'block';
              el.avatarPreviewBox.classList.add('has-image');
            } else {
              if (state.editingPremiumCardIndex !== null && state.editingPremiumCardIndex !== undefined) {
                // Modifica in-place della carta esistente
                state.localPremiumCards[state.editingPremiumCardIndex].image = uploadUrl;
                renderCapsules();
                if (state.hasSubmittedPremiumCards) {
                  socket.emit('submit_premium_cards', { cards: state.localPremiumCards });
                }
                state.editingPremiumCardIndex = null;
              } else {
                // Caricamento nuova immagine (Sola foto, no didascalia)
                state.currentCroppedImage = uploadUrl;
                if (el.premiumImagePreview) el.premiumImagePreview.src = uploadUrl;
                if (el.premiumImagePreviewContainer) el.premiumImagePreviewContainer.style.display = 'flex';
                if (el.premiumCardInput) {
                  el.premiumCardInput.value = '';
                  el.premiumCardInput.style.display = 'none';
                }
                if (el.lblPremiumImageUpload) {
                  el.lblPremiumImageUpload.style.display = 'none';
                }
                if (el.btnTriggerPremiumPhoto) {
                  el.btnTriggerPremiumPhoto.style.display = 'none';
                }
                if (el.premiumPhotoPopover) {
                  el.premiumPhotoPopover.style.display = 'none';
                }
              }
            }
          }
        } catch (err) {
          console.error("Errore durante l'upload:", err);
          showToast(err.message || "Impossibile caricare l'immagine.");
        } finally {
          confirmBtn.disabled = false;
          confirmBtn.textContent = oldText;
        }
      }

      el.cropperModal.classList.remove('active');
      el.cropperModal.style.display = 'none';
      if (activeCropper) {
        activeCropper.destroy();
        activeCropper = null;
      }
      if (el.premiumImageUpload) el.premiumImageUpload.value = '';
      if (el.inputPremiumCamera) el.inputPremiumCamera.value = '';
      if (el.inputAvatarGallery) el.inputAvatarGallery.value = '';
      if (el.inputAvatarCamera) el.inputAvatarCamera.value = '';
    });
  }

  if (el.btnCropperCancel) {
    el.btnCropperCancel.addEventListener('click', () => {
      el.cropperModal.classList.remove('active');
      el.cropperModal.style.display = 'none';
      if (activeCropper) {
        activeCropper.destroy();
        activeCropper = null;
      }
      if (el.premiumImageUpload) el.premiumImageUpload.value = '';
      if (el.inputPremiumCamera) el.inputPremiumCamera.value = '';
      if (el.inputAvatarGallery) el.inputAvatarGallery.value = '';
      if (el.inputAvatarCamera) el.inputAvatarCamera.value = '';
      state.editingPremiumCardIndex = null;
      
      const wasCamera = state.cropperSource === 'camera';
      const lastTarget = state.cropperTarget || 'avatar';
      state.cropperTarget = null;
      state.cropperSource = null;

      if (wasCamera && openInAppCamera) {
        openInAppCamera(lastTarget);
      }
    });
  }

  if (el.btnCropperZoomIn) {
    el.btnCropperZoomIn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (activeCropper) {
        activeCropper.zoom(0.1);
      }
    });
  }

  if (el.btnCropperZoomOut) {
    el.btnCropperZoomOut.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (activeCropper) {
        activeCropper.zoom(-0.1);
      }
    });
  }

// Convertitore Base64 Data URL a Blob (Cross-Platform)
function dataURLtoBlob(dataurl) {
  const arr = dataurl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

// Upload dell'immagine croppata all'endpoint HTTP REST
async function uploadImage(dataUrl, filename) {
  const blob = dataURLtoBlob(dataUrl);
  const formData = new FormData();
  formData.append('file', blob, filename);
  formData.append('roomCode', state.roomCode);
  formData.append('sessionId', sessionId);
  formData.append('target', state.cropperTarget || 'card');

  const response = await fetch('/upload', {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const errData = await response.json();
    throw new Error(errData.error || 'Errore durante il caricamento');
  }

  const data = await response.json();
  return data.url;
}

  if (el.btnClearImage) {
    el.btnClearImage.addEventListener('click', (e) => {
      e.stopPropagation();
      resetPremiumCardInputState();
      if (el.premiumCardInput) {
        el.premiumCardInput.focus();
      }
    });
  }

  if (el.premiumImagePreview) {
    el.premiumImagePreview.addEventListener('click', () => {
      if (!state.currentCroppedImage) return;

      state.cropperTarget = 'card';
      el.cropperImageTarget.src = state.currentCroppedImage;
      el.cropperModal.style.display = 'flex';
      el.cropperModal.offsetHeight; // trigger reflow
      el.cropperModal.classList.add('active');

      if (activeCropper) {
        activeCropper.destroy();
      }

      activeCropper = new Cropper(el.cropperImageTarget, {
        aspectRatio: 1,
        viewMode: 1,
        dragMode: 'move',
        autoCropArea: 1,
        restore: false,
        guides: true,
        center: true,
        highlight: false,
        cropBoxMovable: true,
        cropBoxResizable: false,
        toggleDragModeOnDblclick: false
      });

      state.editingPremiumCardIndex = null;
    });
  }
}

// ==========================================================================
// SEZIONE AVATAR E PARTECIPANTI (DEFINIZIONI MANCANTI)
// ==========================================================================

function getDefaultAvatarSvg(size = '55%', color = 'rgba(255,255,255,0.6)') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: ${size}; height: ${size}; color: ${color}; opacity: 0.85; display: block; flex-shrink: 0;"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
}

function getAvatarBgColor(name) {
  if (!name) return 'hsl(200, 70%, 60%)';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash % 360);
  const s = 65 + (Math.abs(hash) % 10);
  const l = 55 + (Math.abs(hash) % 10);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

function hasUserCustomAvatar() {
  const url = state.playerAvatarUrl || localStorage.getItem('overunder_avatarUrl');
  if (!url || typeof url !== 'string' || url.trim().length < 5) return false;
  const trimmed = url.trim();
  if (trimmed === 'null' || trimmed === 'undefined' || trimmed === '') return false;
  if (trimmed.includes('<svg') || trimmed.includes('circle') || trimmed.includes('path') || trimmed === '?') return false;
  return trimmed.startsWith('data:image/') || trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/') || trimmed.startsWith('blob:');
}

function updateRemoveAvatarVisibility() {
  const btnRemoveAvatar = document.getElementById('btn-remove-avatar');
  if (btnRemoveAvatar) {
    const isCustom = hasUserCustomAvatar();
    btnRemoveAvatar.style.setProperty('display', isCustom ? 'flex' : 'none', 'important');
  }
}

function setupAvatarEvents() {
  const savedAvatar = localStorage.getItem('overunder_avatarUrl');
  if (savedAvatar && hasUserCustomAvatar()) {
    state.playerAvatarUrl = savedAvatar;
    if (el.avatarDefaultSvg) el.avatarDefaultSvg.style.display = 'none';
    if (el.avatarPreviewImg) {
      el.avatarPreviewImg.src = savedAvatar;
      el.avatarPreviewImg.style.display = 'block';
    }
    const box = document.getElementById('avatar-preview-box');
    if (box) box.classList.add('has-image');
  } else {
    state.playerAvatarUrl = null;
    localStorage.removeItem('overunder_avatarUrl');
    if (el.avatarDefaultSvg) el.avatarDefaultSvg.style.display = 'block';
    if (el.avatarPreviewImg) {
      el.avatarPreviewImg.src = '';
      el.avatarPreviewImg.style.display = 'none';
    }
    const box = document.getElementById('avatar-preview-box');
    if (box) box.classList.remove('has-image');
  }

  updateRemoveAvatarVisibility();

  const isInAppBrowser = /Instagram|FBAN|FBAV|TikTok|WhatsApp/i.test(navigator.userAgent);
  let cameraStream = null;
  let currentFacingMode = 'user'; // 'user' (selfie/front) | 'environment' (rear/main)

  const applyVideoMirror = () => {
    if (!el.cameraVideo) return;
    if (currentFacingMode === 'user') {
      el.cameraVideo.style.transform = 'scaleX(-1)';
    } else {
      el.cameraVideo.style.transform = 'scaleX(1)';
    }
    const labelEl = el.cameraFacingLabel || document.getElementById('camera-facing-label');
    if (labelEl) {
      labelEl.textContent = currentFacingMode === 'user' ? 'Selfie' : 'Retro';
    }
  };

  const stopCameraStream = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      cameraStream = null;
    }
    if (el.cameraVideo) {
      el.cameraVideo.srcObject = null;
    }
  };

  const closeCamera = () => {
    stopCameraStream();
    if (el.cameraModal) {
      el.cameraModal.classList.remove('active');
      el.cameraModal.style.display = 'none';
    }
  };

  const startCameraStream = async (facingMode) => {
    currentFacingMode = facingMode || currentFacingMode || 'user';
    stopCameraStream();

    const constraints = {
      video: {
        facingMode: { ideal: currentFacingMode },
        width: { ideal: 1280 },
        height: { ideal: 1280 }
      },
      audio: false
    };

    try {
      cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      console.warn(`[CAMERA] Fallback facingMode generico per "${currentFacingMode}":`, err);
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false
        });
      } catch (e) {
        console.error("[CAMERA] Impossibile accedere alla fotocamera:", e);
        throw e;
      }
    }

    if (el.cameraVideo && cameraStream) {
      el.cameraVideo.srcObject = cameraStream;
      try {
        await el.cameraVideo.play();
      } catch (e) {
        console.warn("[CAMERA] Play video in attesa di interazione:", e);
      }
      applyVideoMirror();
    }
  };

  const switchCamera = async () => {
    const switchBtn = el.btnCameraSwitch || document.getElementById('btn-camera-switch');
    const floatingSwitchBtn = el.btnCameraSwitchFloating || document.getElementById('btn-camera-switch-floating');

    if (switchBtn) switchBtn.classList.add('rotating');
    if (floatingSwitchBtn) floatingSwitchBtn.classList.add('rotating');

    const newFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';

    try {
      await startCameraStream(newFacingMode);
      try { AudioSynth.playPop(); } catch (e) {}
    } catch (err) {
      console.error("[CAMERA] Errore cambio fotocamera:", err);
      showToast("Impossibile passare all'altra fotocamera.");
    } finally {
      setTimeout(() => {
        if (switchBtn) switchBtn.classList.remove('rotating');
        if (floatingSwitchBtn) floatingSwitchBtn.classList.remove('rotating');
      }, 400);
    }
  };

  openInAppCamera = async (target = 'avatar') => {
    if (el.avatarOptionsPopover) el.avatarOptionsPopover.style.display = 'none';
    if (el.premiumPhotoPopover) el.premiumPhotoPopover.style.display = 'none';

    state.cropperTarget = target; // 'avatar' | 'card'

    // Per avatar il default naturale è la fotocamera frontale (selfie), per le carte Judgement Day è la posteriore (retro)
    const defaultFacing = (target === 'card') ? 'environment' : 'user';

    if (isInAppBrowser) {
      if (target === 'card' && el.inputPremiumCamera) {
        el.inputPremiumCamera.click();
      } else if (el.inputAvatarCamera) {
        el.inputAvatarCamera.click();
      }
      return;
    }

    try {
      await startCameraStream(defaultFacing);
      if (el.cameraModal) {
        el.cameraModal.style.display = 'flex';
        el.cameraModal.offsetHeight; // trigger reflow
        el.cameraModal.classList.add('active');
      }
    } catch (err) {
      console.warn("Accesso fotocamera fallito, fallback su input file nativo", err);
      if (target === 'card' && el.inputPremiumCamera) {
        el.inputPremiumCamera.click();
      } else if (el.inputAvatarCamera) {
        el.inputAvatarCamera.click();
      }
    }
  };

  if (el.btnSelectCamera) {
    el.btnSelectCamera.addEventListener('click', (e) => {
      e.stopPropagation();
      openInAppCamera('avatar');
    });
  }

  if (el.btnCameraClose) {
    el.btnCameraClose.addEventListener('click', closeCamera);
  }

  if (el.btnCameraSwitch) {
    el.btnCameraSwitch.addEventListener('click', (e) => {
      e.stopPropagation();
      switchCamera();
    });
  }

  if (el.btnCameraSwitchFloating) {
    el.btnCameraSwitchFloating.addEventListener('click', (e) => {
      e.stopPropagation();
      switchCamera();
    });
  }

  if (el.btnCameraCapture) {
    el.btnCameraCapture.addEventListener('click', () => {
      if (!cameraStream || !el.cameraVideo) return;
      const video = el.cameraVideo;
      const videoWidth = video.videoWidth || 640;
      const videoHeight = video.videoHeight || 640;
      const size = Math.min(videoWidth, videoHeight);

      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');

      const sx = (videoWidth - size) / 2;
      const sy = (videoHeight - size) / 2;

      if (currentFacingMode === 'user') {
        // Inverti orizzontalmente per specchiare fedelmente l'anteprima selfie
        ctx.translate(size, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);
      } else {
        // Fotocamera posteriore / principale: resa diretta naturale
        ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);
      }

      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

      const targetType = state.cropperTarget || 'avatar';
      closeCamera();

      state.cropperTarget = targetType;
      state.cropperSource = 'camera';
      el.cropperImageTarget.src = dataUrl;
      el.cropperModal.style.display = 'flex';
      el.cropperModal.offsetHeight; // trigger reflow
      el.cropperModal.classList.add('active');

      initCropper(el.cropperImageTarget);
    });
  }

  if (el.btnSelectUpload) {
    el.btnSelectUpload.addEventListener('click', (e) => {
      e.stopPropagation();
      if (el.avatarOptionsPopover) el.avatarOptionsPopover.style.display = 'none';
      if (el.inputAvatarGallery) el.inputAvatarGallery.click();
    });
  }

  const btnRemoveAvatar = document.getElementById('btn-remove-avatar');
  if (btnRemoveAvatar) {
    btnRemoveAvatar.addEventListener('click', (e) => {
      e.stopPropagation();
      if (el.avatarOptionsPopover) el.avatarOptionsPopover.style.display = 'none';

      state.playerAvatarUrl = null;
      localStorage.removeItem('overunder_avatarUrl');

      if (el.avatarPreviewImg) {
        el.avatarPreviewImg.style.display = 'none';
        el.avatarPreviewImg.src = '';
      }
      if (el.avatarDefaultSvg) {
        el.avatarDefaultSvg.style.display = 'block';
      }
      const box = document.getElementById('avatar-preview-box');
      if (box) box.classList.remove('has-image');

      btnRemoveAvatar.style.setProperty('display', 'none', 'important');

      if (socket && socket.connected && state.roomCode) {
        socket.emit('update_avatar', { avatar: null });
      }
      showToast("Foto profilo rimossa.");
    });
  }

  if (el.btnTriggerAvatarOptions) {
    el.btnTriggerAvatarOptions.addEventListener('click', (e) => {
      e.stopPropagation();
      if (el.avatarOptionsPopover) {
        const isOpen = el.avatarOptionsPopover.style.display === 'flex';
        const willOpen = !isOpen;
        el.avatarOptionsPopover.style.display = willOpen ? 'flex' : 'none';

        if (willOpen) {
          updateRemoveAvatarVisibility();
        }
      }
    });
  }

  // Click sulla propria foto profilo per vederla a schermo intero
  if (el.avatarPreviewImg) {
    el.avatarPreviewImg.addEventListener('click', (e) => {
      e.stopPropagation();
      // Solo se c'è un'immagine caricata
      if (!el.avatarPreviewBox || !el.avatarPreviewBox.classList.contains('has-image')) return;
      const playerName = state.playerName || sessionStorage.getItem('overunder_playerName') || '';
      openAvatarZoom({ name: playerName, avatar: el.avatarPreviewImg.src });
    });
    // Cursore pointer per indicare cliccabilità quando c'è un'immagine
    el.avatarPreviewImg.style.cursor = 'pointer';
  }

  document.addEventListener('click', (e) => {
    if (el.avatarOptionsPopover && el.avatarOptionsPopover.style.display === 'flex') {
      if (!el.avatarOptionsPopover.contains(e.target) && e.target !== el.btnTriggerAvatarOptions && !el.btnTriggerAvatarOptions.contains(e.target)) {
        el.avatarOptionsPopover.style.display = 'none';
      }
    }
  });

  const handleAvatarFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      state.cropperTarget = 'avatar';
      state.cropperSource = 'upload';
      el.cropperImageTarget.src = event.target.result;
      el.cropperModal.style.display = 'flex';
      el.cropperModal.offsetHeight; // trigger reflow
      el.cropperModal.classList.add('active');

      initCropper(el.cropperImageTarget);
    };
    reader.readAsDataURL(file);
  };

  if (el.inputAvatarGallery) {
    el.inputAvatarGallery.addEventListener('change', (e) => {
      handleAvatarFile(e.target.files[0]);
    });
  }
  if (el.inputAvatarCamera) {
    el.inputAvatarCamera.addEventListener('change', (e) => {
      handleAvatarFile(e.target.files[0]);
    });
  }

  // Eventi per aprire e chiudere la modale dei partecipanti in-game
  if (el.gameplayAvatarsList) {
    el.gameplayAvatarsList.addEventListener('click', () => {
      state.isPlayerListOpen = true;
      if (el.playerListModal) {
        el.playerListModal.style.display = 'flex';
        el.playerListModal.offsetHeight;
        el.playerListModal.classList.add('active');
      }
      renderPlayerListModalContent();
    });
  }
  if (el.btnPlayerListClose) {
    el.btnPlayerListClose.addEventListener('click', () => {
      state.isPlayerListOpen = false;
      if (el.playerListModal) {
        el.playerListModal.classList.remove('active');
        el.playerListModal.style.display = 'none';
      }
    });
  }

  // Eventi per chiudere lo zoom dell'avatar
  const zoomModal = document.getElementById('avatar-zoom-modal');
  const btnZoomClose = document.getElementById('btn-avatar-zoom-close');
  if (zoomModal && btnZoomClose) {
    btnZoomClose.addEventListener('click', () => {
      closeAvatarZoom();
    });
    zoomModal.addEventListener('click', (e) => {
      if (e.target === zoomModal) {
        closeAvatarZoom();
      }
    });
  }

  // Eventi per chiudere lo zoom dell'immagine della carta (Gogna)
  const cardZoomModal = el.cardImageZoomModal || document.getElementById('card-image-zoom-modal');
  const btnCardZoomClose = el.btnCardImageZoomClose || document.getElementById('btn-card-image-zoom-close');
  if (cardZoomModal && btnCardZoomClose) {
    btnCardZoomClose.addEventListener('click', () => {
      closeCardImageZoom();
    });
    cardZoomModal.addEventListener('click', (e) => {
      if (e.target === cardZoomModal) {
        closeCardImageZoom();
      }
    });
  }
}

function renderGameplayAvatars() {
  if (!el.gameplayAvatarsList) return;
  el.gameplayAvatarsList.innerHTML = '';

  const badge = document.getElementById('gameplay-player-count-badge');
  if (badge) {
    badge.textContent = state.players.length;
  }

  const maxVisible = 5;
  const visiblePlayers = state.players.slice(0, maxVisible);

  visiblePlayers.forEach(player => {
    const avatarContainer = document.createElement('div');
    avatarContainer.style.position = 'relative';
    avatarContainer.style.width = '28px';
    avatarContainer.style.height = '28px';
    avatarContainer.style.borderRadius = '50%';
    avatarContainer.style.flexShrink = '0';

    const hasAvatar = player.avatar ? true : false;
    if (hasAvatar) {
      avatarContainer.innerHTML = `<img src="${player.avatar}" class="gameplay-avatar-img" style="width:100%; height:100%; border-radius:50%; object-fit:cover; border:1.5px solid rgba(255,255,255,0.4);">`;
    } else {
      const bgColor = getAvatarBgColor(player.name);
      avatarContainer.innerHTML = `<div class="avatar-initials-fallback" style="background-color:${bgColor}; display:flex; justify-content:center; align-items:center;">${getDefaultAvatarSvg('60%', 'rgba(255,255,255,0.75)')}</div>`;
    }
    el.gameplayAvatarsList.appendChild(avatarContainer);
  });

  if (state.players.length > maxVisible) {
    const moreCount = state.players.length - maxVisible;
    const moreIndicator = document.createElement('div');
    moreIndicator.style.width = '28px';
    moreIndicator.style.height = '28px';
    moreIndicator.style.borderRadius = '50%';
    moreIndicator.style.background = 'rgba(255,255,255,0.15)';
    moreIndicator.style.border = '1.5px solid rgba(255, 255, 255, 0.4)';
    moreIndicator.style.display = 'flex';
    moreIndicator.style.justifyContent = 'center';
    moreIndicator.style.alignItems = 'center';
    moreIndicator.style.fontSize = '0.7rem';
    moreIndicator.style.fontWeight = '800';
    moreIndicator.style.color = 'white';
    moreIndicator.style.flexShrink = '0';
    moreIndicator.textContent = `+${moreCount}`;
    el.gameplayAvatarsList.appendChild(moreIndicator);
  }
}

function renderPlayerListModalContent() {
  if (!el.playerListModalContent) return;
  el.playerListModalContent.innerHTML = '';

  state.players.forEach(player => {
    const row = document.createElement('div');
    row.className = 'modal-player-row';

    const hasAvatar = player.avatar ? true : false;
    let avatarHtml = '';
    if (hasAvatar) {
      avatarHtml = `<img src="${player.avatar}" class="modal-player-avatar" style="cursor: pointer;">`;
    } else {
      const bgColor = getAvatarBgColor(player.name);
      avatarHtml = `<div class="modal-player-avatar-fallback" style="background-color:${bgColor}; cursor: pointer; display:flex; justify-content:center; align-items:center;">${getDefaultAvatarSvg('60%', 'rgba(255,255,255,0.75)')}</div>`;
    }

    const isMe = player.id === socket.id;
    let roleBadge = '';
    if (player.isHost) {
      roleBadge = `<span class="modal-player-role host">👑 HOST</span>`;
    } else if (isMe) {
      roleBadge = `<span class="modal-player-role">TE</span>`;
    }

    row.innerHTML = `
      <div class="modal-player-left" style="display: flex; align-items: center; gap: 12px; flex: 1;">
        ${avatarHtml}
        <span class="modal-player-name">${player.name} ${isMe ? '(Tu)' : ''}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        ${roleBadge}
      </div>
    `;

    const avatarEl = row.querySelector('.modal-player-avatar, .modal-player-avatar-fallback');
    if (avatarEl) {
      avatarEl.addEventListener('click', (e) => {
        e.stopPropagation();
        openAvatarZoom(player);
      });
    }

    el.playerListModalContent.appendChild(row);
  });
}

function kickPlayerConfirm(player) {
  if (!player || !state.isHost || state.gameplayStarted) return;
  socket.emit('kick_player', {
    playerId: player.id,
    sessionId: player.sessionId,
    name: player.name
  });
  showToast(`Giocatore ${player.name} espulso`, 3000);
}

function openAvatarZoom(player) {
  if (!player) return;
  const zoomModal = document.getElementById('avatar-zoom-modal');
  const zoomImage = document.getElementById('avatar-zoom-image');
  const zoomFallback = document.getElementById('avatar-zoom-fallback');
  const zoomName = document.getElementById('avatar-zoom-name');

  if (!zoomModal) return;

  if (player.avatar) {
    if (zoomImage) {
      zoomImage.src = player.avatar;
      zoomImage.style.display = 'block';
    }
    if (zoomFallback) zoomFallback.style.display = 'none';
  } else {
    if (zoomImage) zoomImage.style.display = 'none';
    if (zoomFallback) {
      zoomFallback.innerHTML = getDefaultAvatarSvg('50%', 'rgba(255,255,255,0.75)');
      zoomFallback.style.backgroundColor = getAvatarBgColor(player.name);
      zoomFallback.style.display = 'flex';
      zoomFallback.style.justifyContent = 'center';
      zoomFallback.style.alignItems = 'center';
    }
  }

  if (zoomName) {
    zoomName.textContent = player.name || '';
  }

  zoomModal.style.display = 'flex';
  zoomModal.offsetHeight;
  zoomModal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeAvatarZoom() {
  const zoomModal = document.getElementById('avatar-zoom-modal');
  if (zoomModal) {
    zoomModal.classList.remove('active');
    zoomModal.style.display = 'none';
  }
  document.body.style.overflow = '';
}

function openCardImageZoom(imageSrc, promptText = '') {
  if (!imageSrc) return;
  const zoomModal = el.cardImageZoomModal || document.getElementById('card-image-zoom-modal');
  const zoomImage = el.cardImageZoomImage || document.getElementById('card-image-zoom-image');
  const zoomPrompt = el.cardImageZoomPrompt || document.getElementById('card-image-zoom-prompt');

  if (!zoomModal) return;

  if (zoomImage) {
    zoomImage.src = imageSrc;
  }
  if (zoomPrompt) {
    const raw = (promptText || '').trim();
    const isTech = !raw || 
                   /^immagine\s*\(\d+\)$/i.test(raw) || 
                   raw.toLowerCase() === 'immagine' ||
                   raw.toLowerCase() === 'immagine caricata' ||
                   raw.toLowerCase() === 'carta immagine' ||
                   /\.(webp|jpg|jpeg|png|gif)$/i.test(raw);
    if (!isTech && raw) {
      zoomPrompt.textContent = raw;
      zoomPrompt.style.display = 'block';
    } else {
      zoomPrompt.textContent = '';
      zoomPrompt.style.display = 'none';
    }
  }

  zoomModal.style.display = 'flex';
  zoomModal.offsetHeight;
  zoomModal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeCardImageZoom() {
  const zoomModal = el.cardImageZoomModal || document.getElementById('card-image-zoom-modal');
  if (zoomModal) {
    zoomModal.classList.remove('active');
    zoomModal.style.display = 'none';
  }
  document.body.style.overflow = '';
}

// ==========================================================================
// RICERCA & IMPORTAZIONE IMMAGINI WEB (PIXABAY BROWSER)
// ==========================================================================

function openWebImageSearchModal() {
  const modal = el.webImageSearchModal || document.getElementById('web-image-search-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  modal.offsetHeight; // trigger reflow
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
  const input = el.inputWebImageSearch || document.getElementById('input-web-image-search');
  if (input) {
    setTimeout(() => { try { input.focus(); } catch (e) {} }, 150);
  }
}

function closeWebImageSearchModal() {
  const modal = el.webImageSearchModal || document.getElementById('web-image-search-modal');
  if (!modal) return;
  modal.classList.remove('active');
  modal.style.display = 'none';
  document.body.style.overflow = '';
}

function setupWebImageSearch() {
  const modal = el.webImageSearchModal || document.getElementById('web-image-search-modal');
  const btnClose = el.btnCloseWebSearchModal || document.getElementById('btn-close-web-search-modal');
  const input = el.inputWebImageSearch || document.getElementById('input-web-image-search');
  const btnClear = el.btnClearWebImageSearch || document.getElementById('btn-clear-web-image-search');
  const btnSubmit = el.btnSubmitWebImageSearch || document.getElementById('btn-submit-web-image-search');
  const loading = el.webSearchLoading || document.getElementById('web-search-loading');
  const importing = el.webSearchImporting || document.getElementById('web-search-importing');
  const placeholder = el.webSearchPlaceholder || document.getElementById('web-search-placeholder');
  const noResults = el.webSearchNoResults || document.getElementById('web-search-no-results');
  const grid = el.webSearchResultsGrid || document.getElementById('web-search-results-grid');

  if (btnClose) {
    btnClose.addEventListener('click', closeWebImageSearchModal);
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeWebImageSearchModal();
      }
    });
  }

  let searchDebounceTimer = null;

  async function performSearch(query) {
    const q = (query || '').trim();
    if (!q) {
      if (loading) loading.style.display = 'none';
      if (noResults) noResults.style.display = 'none';
      if (grid) { grid.style.display = 'none'; grid.innerHTML = ''; }
      if (placeholder) placeholder.style.display = 'block';
      return;
    }

    if (placeholder) placeholder.style.display = 'none';
    if (noResults) noResults.style.display = 'none';
    if (grid) { grid.style.display = 'none'; grid.innerHTML = ''; }
    if (loading) loading.style.display = 'flex';

    try {
      const res = await fetch(`/api/images/search?q=${encodeURIComponent(q)}`);
      const data = await res.json().catch(() => ({}));

      if (loading) loading.style.display = 'none';

      if (!res.ok) {
        throw new Error(data.error || "Errore durante la ricerca.");
      }

      const results = Array.isArray(data) ? data : (Array.isArray(data.results) ? data.results : []);

      if (results.length === 0) {
        if (noResults) {
          noResults.textContent = `Nessuna GIF trovata per "${q}". Prova con altri termini.`;
          noResults.style.display = 'block';
        }
        return;
      }

      if (grid) {
        grid.innerHTML = '';
        results.forEach(hit => {
          const card = document.createElement('div');
          card.className = 'web-img-card';
          card.style.cssText = 'position: relative; aspect-ratio: 1; border-radius: 12px; overflow: hidden; cursor: pointer; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.03);';
          
          const rawTitle = (hit.title || hit.tags || '').trim();
          const previewSrc = hit.previewUrl || hit.thumbnail || hit.image || hit.fullUrl;
          const fullSrc = hit.fullUrl || hit.image || hit.previewUrl || hit.thumbnail;

          card.innerHTML = `
            <img src="${previewSrc}" loading="lazy" style="width: 100%; height: 100%; object-fit: cover; display: block;" alt="${rawTitle}" onerror="this.parentElement.style.display='none'">
            ${rawTitle ? `<div style="position: absolute; bottom: 0; left: 0; width: 100%; padding: 6px 8px; background: linear-gradient(transparent, rgba(0,0,0,0.85)); font-size: 0.68rem; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600;">${rawTitle}</div>` : ''}
          `;

          card.addEventListener('click', async () => {
            if (importing) importing.style.display = 'flex';
            try {
              const importRes = await fetch('/api/images/import-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  imageUrl: fullSrc,
                  roomCode: state.roomCode || null
                })
              });
              const importData = await importRes.json().catch(() => ({}));
              if (!importRes.ok) {
                throw new Error(importData.error || "Impossibile scaricare l'immagine.");
              }

              const savedUrl = importData.url;

              if (state.editingPremiumCardIndex !== null && state.editingPremiumCardIndex !== undefined && state.localPremiumCards[state.editingPremiumCardIndex]) {
                state.localPremiumCards[state.editingPremiumCardIndex].image = savedUrl;
                state.editingPremiumCardIndex = null;
                renderCapsules();
                if (state.hasSubmittedPremiumCards) {
                  socket.emit('submit_premium_cards', { cards: state.localPremiumCards });
                }
                showToast("Immagine aggiornata con successo! 🖼️", 3000);
              } else {
                state.currentCroppedImage = savedUrl;
                if (el.premiumImagePreview) el.premiumImagePreview.src = savedUrl;
                if (el.premiumImagePreviewContainer) el.premiumImagePreviewContainer.style.display = 'flex';
                if (el.premiumCardInput) el.premiumCardInput.style.display = 'none';
                if (el.btnTriggerPremiumPhoto) el.btnTriggerPremiumPhoto.style.display = 'none';
                showToast("Foto pronta! Premi '+' per aggiungerla 📸", 3000);
              }

              closeWebImageSearchModal();
              try { AudioSynth.playConfirm(true); } catch (e) {}

            } catch (err) {
              console.error("[IMPORT ERROR]", err);
              showToast(err.message || "Errore importazione immagine");
            } finally {
              if (importing) importing.style.display = 'none';
            }
          });

          grid.appendChild(card);
        });

        grid.style.display = 'grid';
      }

    } catch (err) {
      if (loading) loading.style.display = 'none';
      if (noResults) {
        noResults.textContent = err.message || "Errore durante la ricerca.";
        noResults.style.display = 'block';
      }
    }
  }

  if (input) {
    input.addEventListener('input', () => {
      const val = input.value;
      if (btnClear) btnClear.style.display = val.length > 0 ? 'block' : 'none';
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        performSearch(input.value);
      }, 300);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        performSearch(input.value);
      }
    });
  }

  if (btnClear) {
    btnClear.addEventListener('click', () => {
      if (input) {
        input.value = '';
        input.focus();
      }
      btnClear.style.display = 'none';
      performSearch('');
    });
  }

  if (btnSubmit) {
    btnSubmit.addEventListener('click', () => {
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      if (input) performSearch(input.value);
    });
  }
}

