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

function clearSession() {
  clearRoomSession();
  safeSessionStorage.removeItem('overunder_token');
  safeSessionStorage.removeItem('overunder_pendingRoom');
  state.roomCode = '';
  state.isHost = false;
  state.players = [];
  state.gameplayStarted = false;
}

function resetToMenu() {
  clearSession();
  if (state.timerRequestId) {
    cancelAnimationFrame(state.timerRequestId);
    state.timerRequestId = null;
  }
  showScreen(el.screenWelcome);
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
  const logRes = await fetch('/api/auth/host', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: hostName, deviceUuid: sessionId, sessionId, fingerprint: getDeviceFingerprint() })
  });

  if (!logRes.ok) {
    const errorData = await logRes.json().catch(() => ({}));
    throw new Error(errorData.error || "Login host fallito");
  }

  const data = await logRes.json();
  if (data.token) {
    safeSessionStorage.setItem('overunder_token', data.token);
    safeStorage.setItem('overunder_token', data.token);
    if (data.isPremium) {
      safeStorage.setItem('overunder_premium_unlocked', 'true');
    }
  }
  return data.token;
}

async function authenticateGuest(roomCode, playerName) {
  const logRes = await fetch('/api/auth/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomCode, playerName, sessionId })
  });

  if (!logRes.ok) {
    const errorData = await logRes.json().catch(() => ({}));
    throw new Error(errorData.error || "Login guest fallito");
  }

  const data = await logRes.json();
  return data.token;
}

// ==========================================================================
// SINTETIZZATORE AUDIO (Web Audio API)
// ==========================================================================
const AudioSynth = {
  ctx: null,
  isMuted: localStorage.getItem('overunder_muted') === 'true',

  init() {
    if (this.isMuted) return;
    try {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
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
  }
};

// Sblocco automatico di AudioContext al primissimo tocco dell'utente (iOS / Android Autoplay Policy)
['pointerdown', 'touchstart', 'click'].forEach(evtType => {
  window.addEventListener(evtType, () => {
    try {
      AudioSynth.init();
      if (AudioSynth.ctx && AudioSynth.ctx.state === 'suspended') {
        AudioSynth.ctx.resume();
      }
    } catch (e) {}
  }, { passive: true });
});

// ==========================================================================
// CONFIGURAZIONE STATO & ELEMENTI DOM
// ==========================================================================
const state = {
  isHost: false,
  isSoloMode: false,
  roomCode: '',
  playerName: '',
  players: [],             // Elenco oggetti player: { id, name, isHost }
  
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
  pendingSocketAction: null
};

let activeCropper = null;
let openInAppCamera = null;

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
  premiumImagePreviewContainer: document.getElementById('premium-image-preview-container'),
  premiumImagePreview: document.getElementById('premium-image-preview'),
  btnClearImage: document.getElementById('btn-clear-image'),
  cropperModal: document.getElementById('cropper-modal'),
  cropperImageTarget: document.getElementById('cropper-image-target'),
  btnCropperCancel: document.getElementById('btn-cropper-cancel'),
  btnCropperConfirm: document.getElementById('btn-cropper-confirm'),
  infoGognaModal: document.getElementById('info-gogna-modal'),
  inputHelpModal: document.getElementById('input-help-modal'),
  
  // Card Actions Drawer Modal
  cardActionsDrawer: document.getElementById('card-actions-drawer'),
  btnEditCard: document.getElementById('btn-edit-card'),
  btnDeleteCard: document.getElementById('btn-delete-card'),
  drawerCloseBtn: document.querySelector('.drawer-close-btn'),
  drawerCardTitle: document.getElementById('drawer-card-title'),
  
  // Gameplay Prompt Image elements
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
  
  // Trial modals & elements
  trialGiftModal: document.getElementById('trial-gift-modal'),
  btnActivateTrial: document.getElementById('btn-activate-trial'),
  btnActivateLaterModal: document.getElementById('btn-activate-later-modal'),
  onboardingGiftBanner: document.getElementById('onboarding-gift-banner'),
  trialExpiredModal: document.getElementById('trial-expired-modal'),
  btnPaywallBuy: document.getElementById('btn-paywall-buy'),
  btnPaywallClose: document.getElementById('btn-paywall-close'),
  btnDebugTrial: document.getElementById('btn-debug-trial'),
  btnTestExpired: document.getElementById('btn-test-expired'),
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
  console.log("--> 0. APP INITIALIZATION (STARTUP CHECK):", {
    overunder_trial_redeemed: localStorage.getItem('overunder_trial_redeemed'),
    overunder_has_redeemed_trial: localStorage.getItem('overunder_has_redeemed_trial'),
    overunder_trial_start: localStorage.getItem('overunder_trial_start'),
    overunder_trial_end: localStorage.getItem('overunder_trial_end')
  });

  try { judgementDayStore.init(); } catch (e) { console.warn("judgementDayStore init error:", e); }
  try { initClock(); } catch (e) { console.warn("initClock error:", e); }
  try { setupOnboardingTabs(); } catch (e) { console.warn("setupOnboardingTabs error:", e); }
  try { setupEventListeners(); } catch (e) { console.warn("setupEventListeners error:", e); }
  try { setupSocketListeners(); } catch (e) { console.warn("setupSocketListeners error:", e); }
  try { setupPremiumCreatorEvents(); } catch (e) { console.warn("setupPremiumCreatorEvents error:", e); }
  try { setupAvatarEvents(); } catch (e) { console.warn("setupAvatarEvents error:", e); }
  try { setupJoinRulesModalEvents(); } catch (e) { console.warn("setupJoinRulesModalEvents error:", e); }
  
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
  try { checkTrialStatus(); } catch (e) { console.warn("checkTrialStatus error:", e); }
  try { updateGiftBannerUI(); } catch (e) { console.warn("updateGiftBannerUI error:", e); }
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

function runSplashScreen(skipSplash = false) {
  // Se l'utente sta entrando via invite link, salta lo splash e mostra subito il form
  if (skipSplash) {
    console.log('[INVITE] Splash screen saltato per invite link');
    forceHideSplash();
    return;
  }

  // Assicurati che lo splash screen sia visibile all'avvio
  if (el.screenSplash) {
    el.screenSplash.style.display = 'flex';
    el.screenSplash.classList.add('active');
    el.screenSplash.classList.remove('fade-out');
  }

  // Mostra il caricamento dello splash screen per 5 secondi e poi avvia il fade-out
  setTimeout(() => {
    if (el.screenSplash) {
      el.screenSplash.classList.add('fade-out');
    }
  }, 5000);

  // Nascondi lo splash screen a 5.5 secondi e mostra la schermata iniziale di benvenuto
  setTimeout(() => {
    forceHideSplash();
    
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
  }, 5500);
}

function showScreen(targetScreen) {
  forceHideSplash();
  [el.screenWelcome, el.screenOnboarding, el.screenLobby, el.screenGameplay, el.screenResults, el.screenSummary, el.screenKicked, el.screenRoomFull, el.screenLoading].forEach(screen => {
    if (screen) screen.classList.remove('active');
  });
  if (targetScreen) {
    targetScreen.classList.add('active');
    try { targetScreen.scrollTop = 0; } catch (e) {}
  }

  // Configura il timer counter cliccabile solo in gameplay per l'host
  if (targetScreen === el.screenGameplay) {
    setupTimerCounterClickable();
  } else {
    stopTimerLoop();
    closeTimerPicker();
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
        title: 'OverUnder - Il Gioco',
        text: 'Vieni a provare OverUnder, il gioco del momento! 🔥',
        url: 'https://wwwoverunder-game.com'
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
  const token = sessionStorage.getItem('overunder_token');
  if (!token) return null;
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
}

function checkPremiumStatusFromToken() {
  const decoded = getDecodedToken();
  if (decoded && (decoded.isPremium || decoded.premiumStatus === 'PREMIUM_A_VITA')) {
    return true;
  }
  return false;
}

// ==========================================================================
// STORE GLOBALE REATTIVO PER "JUDGEMENT DAY" & TRIAL 30 GIORNI
// ==========================================================================
const judgementDayStore = {
  state: {
    isPurchased: false,
    trialRedeemed: false,
    trialStart: 0,
    trialEnd: 0,
    isTrialActive: false,
    hasAccess: false,
    timeLeftMs: 0
  },

  listeners: new Set(),

  init() {
    this.hydrate();
  },

  hydrate() {
    const isPurchased = localStorage.getItem('overunder_judgement_purchased') === 'true' || checkPremiumStatusFromToken();
    const trialRedeemed = localStorage.getItem('overunder_trial_redeemed') === 'true' || localStorage.getItem('overunder_has_redeemed_trial') === 'true';
    
    const startStr = localStorage.getItem('overunder_trial_start') || localStorage.getItem('overunder_trial_start_date') || '0';
    const endStr = localStorage.getItem('overunder_trial_end') || localStorage.getItem('overunder_trial_end_date') || '0';
    
    const trialStart = parseInt(startStr, 10);
    const trialEnd = parseInt(endStr, 10);
    const isTrialActive = trialRedeemed && trialEnd > 0 && (Date.now() < trialEnd);

    if (trialRedeemed && trialEnd > 0 && Date.now() >= trialEnd) {
      localStorage.setItem('overunder_trial_activated', 'expired');
    }

    this.state = {
      isPurchased,
      trialRedeemed,
      trialStart,
      trialEnd,
      isTrialActive,
      hasAccess: isPurchased || isTrialActive,
      timeLeftMs: (trialEnd > 0 && isTrialActive) ? (trialEnd - Date.now()) : 0
    };

    return this.state;
  },

  setTrialActivated(startMs, endMs) {
    const now = Date.now();
    const start = startMs || now;
    const end = endMs || (now + 30 * 24 * 60 * 60 * 1000);

    // 1. Scrittura SINCRONA nel LocalStorage (Permanente)
    localStorage.setItem('overunder_trial_redeemed', 'true');
    localStorage.setItem('overunder_trial_start', String(start));
    localStorage.setItem('overunder_trial_end', String(end));

    // Scrittura chiavi retrocompatibili
    localStorage.setItem('overunder_has_redeemed_trial', 'true');
    localStorage.setItem('overunder_trial_activated', 'true');
    localStorage.setItem('overunder_trial_start_date', String(start));
    localStorage.setItem('overunder_trial_end_date', String(end));

    // 2. Aggiornamento SINCRONO dello stato in memoria
    this.hydrate();

    // 3. Notifica sincrona ed immediata di tutti i componenti figli
    this.notify(true);
  },

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },

  notify(autoCheckToggle = false) {
    state.trialActivated = this.state.isTrialActive;
    state.roomIsPremium = this.state.hasAccess;

    if (el.createPremiumToggle) {
      if (this.state.hasAccess) {
        if (autoCheckToggle) {
          el.createPremiumToggle.checked = true;
        }
      } else {
        el.createPremiumToggle.checked = false;
      }
    }

    updateJudgementCardBadge();
    updatePremiumUI();
    updateGiftBannerUI();

    this.listeners.forEach(fn => {
      try { fn(this.state); } catch (e) { console.error("Errore listener judgementDayStore:", e); }
    });

    window.dispatchEvent(new CustomEvent('overunder_premium_state_changed', { detail: this.state }));
  }
};

function checkJudgementDayAccess() {
  return judgementDayStore.hydrate();
}

function hasPremiumAccess() {
  return judgementDayStore.hydrate().hasAccess;
}

function syncJudgementDayUI(autoCheckToggle = false) {
  judgementDayStore.hydrate();
  judgementDayStore.notify(autoCheckToggle);
}

function updatePremiumUI() {
  const isPremium = checkPremiumStatusFromToken();
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

let trialTimerInterval = null;

function formatTrialCountdown(remainingMs) {
  if (remainingMs <= 0) return { text: '🔒 SCADUTO', mode: 'expired' };

  const totalSecs = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSecs / (24 * 3600));
  const hours = Math.floor((totalSecs % (24 * 3600)) / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  const seconds = totalSecs % 60;

  if (days >= 1) {
    return {
      text: `⏳ ${days} ${days === 1 ? 'giorno' : 'giorni'} di prova`,
      mode: 'normal'
    };
  } else if (hours >= 1) {
    return {
      text: `⏳ ${hours}h ${minutes}m rimasti`,
      mode: 'normal'
    };
  } else {
    return {
      text: `⏳ ${minutes}m ${String(seconds).padStart(2, '0')}s`,
      mode: 'panic'
    };
  }
}

function updateJudgementCardBadge() {
  const badge = document.getElementById('judgement-trial-badge');
  if (!badge) return;

  const access = checkJudgementDayAccess();

  // Caso 1: Licenza Premium a Vita / Acquistata
  if (access.isPurchased) {
    if (trialTimerInterval) {
      clearInterval(trialTimerInterval);
      trialTimerInterval = null;
    }
    badge.className = 'judgement-trial-badge badge-lifetime';
    badge.innerHTML = '👑 PREMIUM A VITA';
    badge.style.display = 'inline-flex';
    badge.onclick = (e) => {
      e.stopPropagation();
      showToast('Hai la licenza Premium a vita per Judgement Day! 👑', 3500);
    };
    return;
  }

  // Caso 2: Prova 30 Giorni Attiva
  if (access.isTrialActive) {
    const refreshBadgeTimer = () => {
      const currentAccess = checkJudgementDayAccess();
      if (!currentAccess.isTrialActive) {
        if (trialTimerInterval) {
          clearInterval(trialTimerInterval);
          trialTimerInterval = null;
        }
        syncJudgementDayUI();
        return;
      }
      const info = formatTrialCountdown(currentAccess.timeLeftMs);
      badge.className = `judgement-trial-badge ${info.mode === 'panic' ? 'badge-panic' : ''}`;
      badge.innerHTML = info.text;
      badge.style.display = 'inline-flex';

      const endDate = Date.now() + currentAccess.timeLeftMs;
      const expDate = new Date(endDate);
      const dateFormatted = expDate.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const timeFormatted = expDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

      badge.onclick = (e) => {
        e.stopPropagation();
        showToast(`La tua prova gratuita scade il ${dateFormatted} alle ${timeFormatted} ⏳`, 4500);
      };
    };

    refreshBadgeTimer();
    if (!trialTimerInterval) {
      trialTimerInterval = setInterval(refreshBadgeTimer, 1000);
    }
    return;
  } else {
    if (trialTimerInterval) {
      clearInterval(trialTimerInterval);
      trialTimerInterval = null;
    }
  }

  // Caso 3: Prova Riscatta e Scaduta
  if (access.trialRedeemed) {
    badge.className = 'judgement-trial-badge badge-panic';
    badge.innerHTML = '🔒 PROVA SCADUTA';
    badge.style.display = 'inline-flex';
    badge.onclick = (e) => {
      e.stopPropagation();
      if (el.trialExpiredModal) {
        el.trialExpiredModal.style.display = 'flex';
        el.trialExpiredModal.classList.add('active');
      }
    };
    return;
  }

  // Caso 4: Regalo Non Ancora Riscattato
  badge.className = 'judgement-trial-badge badge-available';
  badge.innerHTML = 'Regalo disponibile 🎁';
  badge.style.display = 'inline-flex';
  badge.onclick = (e) => {
    e.stopPropagation();
    if (el.trialGiftModal) {
      el.trialGiftModal.style.display = 'flex';
      el.trialGiftModal.classList.add('active');
    }
  };
}

function updateGiftBannerUI() {
  const access = checkJudgementDayAccess();
  const isGiftAvailable = !access.hasAccess && !access.trialRedeemed;

  if (el.onboardingGiftBanner) {
    el.onboardingGiftBanner.style.display = isGiftAvailable ? 'block' : 'none';
  }

  const sidebarGiftSection = document.getElementById('sidebar-gift-section');
  if (sidebarGiftSection) {
    sidebarGiftSection.style.display = isGiftAvailable ? 'block' : 'none';
  }
}

async function checkTrialStatus() {
  // Reidrata prima lo stato locale dal localStorage (ground truth)
  judgementDayStore.hydrate();

  try {
    const fingerprint = getDeviceFingerprint();
    const res = await fetch(`/api/trial/status?deviceUuid=${sessionId}&fingerprint=${fingerprint}`);
    if (res.ok) {
      const data = await res.json();
      if (data.activated || data.hasRedeemedTrial || data.overunder_trial_redeemed === 'true') {
        const startMs = data.trial_start || data.trial_start_date || judgementDayStore.state.trialStart;
        const endMs = data.trial_end || data.trial_end_date || judgementDayStore.state.trialEnd;

        localStorage.setItem('overunder_trial_redeemed', 'true');
        localStorage.setItem('overunder_has_redeemed_trial', 'true');
        if (startMs) {
          localStorage.setItem('overunder_trial_start', String(startMs));
          localStorage.setItem('overunder_trial_start_date', String(startMs));
        }
        if (endMs) {
          localStorage.setItem('overunder_trial_end', String(endMs));
          localStorage.setItem('overunder_trial_end_date', String(endMs));
        }
        if (data.active) {
          localStorage.setItem('overunder_trial_activated', 'true');
        } else {
          localStorage.setItem('overunder_trial_activated', 'expired');
        }
      }
    }
  } catch (e) {
    console.warn("Errore recupero stato trial dal server:", e);
  } finally {
    // PROTEZIONE DA SOVRASCRITTURE ALL'AVVIO: Preserva e notifica lo stato dal localStorage
    judgementDayStore.notify();
  }
}

async function activateTrialOnServer() {
  const deviceUuid = sessionId;
  const fingerprint = getDeviceFingerprint();
  
  const token = sessionStorage.getItem('overunder_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = 'Bearer ' + token;
  }
  
  const res = await fetch('/api/trial/activate', {
    method: 'POST',
    headers,
    body: JSON.stringify({ deviceUuid, fingerprint })
  });
  
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || "Impossibile attivare il regalo di benvenuto.");
  }
  
  const data = await res.json();
  if (data.token) {
    sessionStorage.setItem('overunder_token', data.token);
    state.roomIsPremium = true;
    if (socket.connected) {
      socket.disconnect();
      socket.connect();
    }
  }
  
  const now = Date.now();
  const startMs = data.trial_start || data.trial_start_date || now;
  const endMs = data.trial_end || data.trial_end_date || (now + 30 * 24 * 60 * 60 * 1000);

  // AGGIORNAMENTO SINCRONO NELLO STORE E NEL LOCALSTORAGE CON NOTIFICA IMMEDIATA
  judgementDayStore.setTrialActivated(startMs, endMs);
}

function checkMatchEndTrialExpiration() {
  const endDateStr = localStorage.getItem('overunder_trial_end_date');
  if (endDateStr) {
    const endDate = parseInt(endDateStr, 10);
    if (!isNaN(endDate) && Date.now() > endDate) {
      const isLifetimePremium = checkPremiumStatusFromToken() && !localStorage.getItem('overunder_trial_activated');
      if (!isLifetimePremium) {
        state.trialActivated = false;
        localStorage.setItem('overunder_trial_activated', 'expired');
        sessionStorage.removeItem('overunder_token');
        state.roomIsPremium = false;
        if (el.createPremiumToggle) el.createPremiumToggle.checked = false;
        updatePremiumUI();
        updateGiftBannerUI();
      }
    }
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
      if (socket && socket.connected) {
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

      const access = checkJudgementDayAccess();
      const trialShown = localStorage.getItem('overunder_trial_shown') === 'true';
      const isProd = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';

      // Mostra il pop-up SOLO SE l'utente NON l'ha mai riscattato in passato (!access.trialRedeemed) e NON ha accesso
      if (isProd && !access.hasAccess && !access.trialRedeemed && !trialShown) {
        if (el.trialGiftModal) {
          el.trialGiftModal.style.display = 'flex';
          el.trialGiftModal.classList.add('active');
          localStorage.setItem('overunder_trial_shown', 'true');
        } else {
          showScreen(el.screenOnboarding);
        }
      } else {
        showScreen(el.screenOnboarding);
      }
    });
  }

  // === DEBUG TRIAL POPUP ===
  if (el.btnDebugTrial) {
    el.btnDebugTrial.addEventListener('click', () => {
      if (el.trialGiftModal) {
        el.trialGiftModal.style.display = 'flex';
        el.trialGiftModal.classList.add('active');
      }
    });
  }

  // === TEST SCADENZA TRIAL ===
  if (el.btnTestExpired) {
    el.btnTestExpired.addEventListener('click', () => {
      if (el.trialExpiredModal) {
        el.trialExpiredModal.style.display = 'flex';
        el.trialExpiredModal.classList.add('active');
      }
    });
  }

  // === RESTRIZIONE TOGGLE PREMIUM LOBBY ===
  if (el.createPremiumToggle) {
    el.createPremiumToggle.addEventListener('change', () => {
      const access = checkJudgementDayAccess();
      console.log("--> 3. VALUTAZIONE ACCESSO CARD:", {
        local_storage_val: localStorage.getItem('overunder_trial_redeemed'),
        state_val: access,
        isPurchased: access.isPurchased
      });

      if (el.createPremiumToggle.checked) {
        if (access.hasAccess) {
          console.log('[ACCESS] Accesso alla modalità Judgement Day consentito via checkJudgementDayAccess()');
          return;
        }

        // Accesso negato -> Deseleziona lo switch e mostra modale opportuna
        el.createPremiumToggle.checked = false;

        if (access.trialRedeemed) {
          if (el.trialExpiredModal) {
            el.trialExpiredModal.style.display = 'flex';
            el.trialExpiredModal.classList.add('active');
          }
          showError("Il tuo periodo di prova gratuito di 30 giorni è terminato. Sblocca la modalità per continuare.");
        } else {
          if (el.trialGiftModal) {
            el.trialGiftModal.style.display = 'flex';
            el.trialGiftModal.classList.add('active');
          } else {
            const standardModal = document.getElementById('paywall-standard-modal');
            if (standardModal) {
              standardModal.style.display = 'flex';
              standardModal.classList.add('active');
            }
          }
        }
      }
    });
  }

  // === RESET TO NO-PREMIUM ===
  if (el.btnResetNoPremium) {
    el.btnResetNoPremium.addEventListener('click', () => {
      sessionStorage.removeItem('overunder_token');
      localStorage.removeItem('overunder_trial_activated');
      localStorage.removeItem('overunder_trial_shown');
      localStorage.removeItem('overunder_trial_redeemed');
      localStorage.removeItem('overunder_has_redeemed_trial');
      localStorage.removeItem('overunder_trial_start');
      localStorage.removeItem('overunder_trial_end');
      state.roomIsPremium = false;
      if (el.createPremiumToggle) {
        el.createPremiumToggle.checked = false;
      }
      const crown = document.getElementById('premium-crown-icon');
      if (crown) {
        crown.style.display = 'inline';
      }
      if (el.onboardingGiftBanner) {
        el.onboardingGiftBanner.style.display = 'block';
      }
      syncJudgementDayUI();
      showError("Stato Premium resettato a NON ACQUISTATO!");
    });
  }

  // === ATTIVAZIONE REGALO (TRIAL) ===
  if (el.btnActivateTrial) {
    el.btnActivateTrial.addEventListener('click', async () => {
      console.log("--> 1. CLICK ACCETTA PROVA ESEGUITO");
      localStorage.setItem('overunder_trial_redeemed', 'true');
      console.log("--> 2. LOCALSTORAGE IMPOSTATO:", localStorage.getItem('overunder_trial_redeemed'));

      try {
        el.btnActivateTrial.disabled = true;
        el.btnActivateTrial.innerText = "ATTIVAZIONE...";
        
        triggerParticleExplosion();
        AudioSynth.init();
        AudioSynth.playConfirm(true);
        
        await activateTrialOnServer();
        console.log("--> 2b. SERVER ACTIVATION COMPLETE, STORE STATE:", judgementDayStore.state);
        
        // Forza l'inizializzazione o l'aggiornamento dello store in memoria
        if (judgementDayStore && typeof judgementDayStore.init === 'function') {
          judgementDayStore.init(); 
        }
        
        // Lancia l'evento globale per avvisare lo Switch e la Card di fare il re-render
        window.dispatchEvent(new CustomEvent('trial-state-changed'));

        setTimeout(() => {
          if (el.trialGiftModal) {
            el.trialGiftModal.classList.add('modal-fade-out');
            setTimeout(() => {
              el.trialGiftModal.style.display = 'none';
              el.trialGiftModal.classList.remove('active', 'modal-fade-out');
              showScreen(el.screenOnboarding);
            }, 500);
          }
        }, 1500);
      } catch (err) {
        console.error(err);
        showError(err.message || "Errore di attivazione trial");
        el.btnActivateTrial.disabled = false;
        el.btnActivateTrial.innerText = "ATTIVA ORA";
        setTimeout(() => {
          if (el.trialGiftModal) {
            el.trialGiftModal.style.display = 'none';
            el.trialGiftModal.classList.remove('active');
          }
          showScreen(el.screenOnboarding);
        }, 1500);
      }
    });
  }

// Listener globale per l'evento trial-state-changed per aggiornare lo switch e la card
window.addEventListener('trial-state-changed', () => {
  const access = checkJudgementDayAccess();
  console.log("--> EVENT trial-state-changed RICEVUTO, NUOVO ACCESSO:", access);
  if (el.createPremiumToggle) {
    el.createPremiumToggle.checked = access.hasAccess;
  }
  updateJudgementCardBadge();
  updatePremiumUI();
  updateGiftBannerUI();
});

  // === REGALO PIÙ TARDI ===
  if (el.btnActivateLaterModal) {
    el.btnActivateLaterModal.addEventListener('click', () => {
      localStorage.setItem('overunder_trial_shown', 'true');
      if (el.trialGiftModal) {
        el.trialGiftModal.style.display = 'none';
        el.trialGiftModal.classList.remove('active');
      }
      updateGiftBannerUI();
      showScreen(el.screenOnboarding);
    });
  }

  // === BANNER REGALO ONBOARDING E SIDEBAR ===
  if (el.onboardingGiftBanner) {
    el.onboardingGiftBanner.addEventListener('click', () => {
      if (el.trialGiftModal) {
        el.trialGiftModal.style.display = 'flex';
        el.trialGiftModal.classList.add('active');
      }
    });
  }

  const btnSidebarGift = document.getElementById('btn-sidebar-gift');
  if (btnSidebarGift) {
    btnSidebarGift.addEventListener('click', () => {
      const sidebar = document.getElementById('settings-sidebar');
      const backdrop = document.getElementById('settings-sidebar-backdrop');
      if (sidebar) sidebar.classList.remove('open');
      if (backdrop) backdrop.classList.remove('open');

      if (el.trialGiftModal) {
        el.trialGiftModal.style.display = 'flex';
        el.trialGiftModal.classList.add('active');
      }
    });
  }

  // === PAYWALL BLOCKER CHIUDI ===
  if (el.btnPaywallClose) {
    el.btnPaywallClose.addEventListener('click', () => {
      if (el.trialExpiredModal) {
        el.trialExpiredModal.style.display = 'none';
        el.trialExpiredModal.classList.remove('active');
      }
      showScreen(el.screenOnboarding);
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
      inputTransferEmail.readOnly = false;
    }
    if (inputTransferOtp) inputTransferOtp.value = '';
    if (btnRequestTransferOtp) {
      btnRequestTransferOtp.disabled = false;
      btnRequestTransferOtp.innerText = "INVIA CODICE";
    }
    if (btnVerifyTransferOtp) {
      btnVerifyTransferOtp.disabled = false;
      btnVerifyTransferOtp.innerText = "CONFERMA";
    }
    if (btnResendTransferOtp) btnResendTransferOtp.style.display = 'none';
  }

  function startOtpCountdown() {
    if (otpTimerInterval) clearInterval(otpTimerInterval);
    otpCountdownSeconds = 60;
    if (transferOtpTimer) transferOtpTimer.textContent = '60';
    if (transferOtpTimerBox) transferOtpTimerBox.style.display = 'flex';
    if (btnResendTransferOtp) btnResendTransferOtp.style.display = 'none';

    otpTimerInterval = setInterval(() => {
      otpCountdownSeconds--;
      if (transferOtpTimer) transferOtpTimer.textContent = String(otpCountdownSeconds);

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
      resetTransferModalState();
      if (restoreModal) {
        restoreModal.style.display = 'flex';
        restoreModal.classList.add('active');
      }
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
    // pulizia profonda per tastiere mobili (spazi invisibili, NBSP, maiuscole automatiche)
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

      // Transizione alla Fase 2
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

      const res = await fetch('/api/premium/verify-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otpCode, deviceUuid: sessionId })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data.error && data.error.includes("scaduto")) {
          if (btnResendTransferOtp) btnResendTransferOtp.style.display = 'inline-block';
        }
        throw new Error(data.error || "Codice errato, riprova.");
      }

      if (data.token) {
        sessionStorage.setItem('overunder_token', data.token);
        localStorage.setItem('overunder_token', data.token);
        localStorage.setItem('overunder_premium_unlocked', 'true');
      }

      state.roomIsPremium = true;
      showToast("Trasferimento completato! Modalità \"Judgement Day\" sbloccata! 👑", 5000);
      updatePremiumUI();

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

    sessionStorage.setItem('overunder_playerName', name);
    sessionStorage.setItem('overunder_roomCode', code);
    sessionStorage.setItem('overunder_isHost', 'true');

    startConnectionLoading('create');

    state.pendingSocketAction = {
      type: 'create_room',
      data: { roomCode: code, avatar: state.playerAvatarUrl, isPremium: isPremiumToggleOn }
    };

    try {
      const token = await authenticateHost(name);
      sessionStorage.setItem('overunder_token', token);
      localStorage.setItem('overunder_token', token);
      if (socket.connected) {
        socket.emit('AUTH', { token });
      } else {
        socket.connect();
      }
    } catch (err) {
      if (state.connectionTimeout) {
        clearTimeout(state.connectionTimeout);
        state.connectionTimeout = null;
      }
      state.connectionLoadingActive = false;
      handleConnectionError('not_found');
      showError(err.message || "Impossibile creare la stanza.");
      state.pendingSocketAction = null;
    }
  });

  // Pulsante invita in lobby
  el.btnLobbyInvite.addEventListener('click', () => {
    if (!state.roomCode) return;
    const inviteLink = window.location.origin + '/?room=' + encodeURIComponent(state.roomCode);
    navigator.clipboard.writeText(inviteLink).then(() => {
      showToast("Invito copiato!");
    }).catch(err => {
      console.error("Errore nella copia dell'invito: ", err);
      // Fallback per vecchi browser o browser in-app di Telegram/Instagram
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
      
      if (state.isSoloMode) {
        startSoloGame(state.gameLength);
      } else {
        if (!state.players || state.players.length < 2) {
          showToast("Servono almeno 2 giocatori in stanza per avviare la partita! Fai scansionare il QR Code 📱", 4000);
          return;
        }

        if (state.roomIsPremium) {
          // Se è Premium e non ci sono carte custom inviate né salvate locale, avvisa l'host
          const hasCards = (state.players && state.players.some(p => p.premiumReady)) || 
                           (state.localPremiumCards && state.localPremiumCards.length > 0);
          if (!hasCards) {
            showToast("Aggiungi almeno una carta prima di avviare la modalità Judgement Day! 👑", 4000);
            return;
          }
          socket.emit('start_game', { gameLength: state.gameLength });
        } else {
          socket.emit('start_game', { gameLength: state.gameLength });
        }
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
      if (state.isSoloMode) {
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

  // Host: Torna al Menu / Reset Lobby
  if (el.btnRestart) {
    el.btnRestart.addEventListener('click', () => {
      if (state.isSoloMode) {
        resetToMenu();
        return;
      }
      if (state.isHost) {
        socket.emit('restart_game');
      }
    });
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

  // Click per zoomare l'immagine della carta (Gogna)
  if (el.gameplayPromptImage) {
    el.gameplayPromptImage.addEventListener('click', () => {
      openCardImageZoom(el.gameplayPromptImage.src, state.currentPromptText);
    });
  }
  if (el.resultsPromptImage) {
    el.resultsPromptImage.addEventListener('click', () => {
      openCardImageZoom(el.resultsPromptImage.src, state.currentPromptText);
    });
  }

  // Pulsante indietro nella lobby
  if (el.btnBackLobby) {
    el.btnBackLobby.addEventListener('click', () => {
      AudioSynth.playConfirm(false);
      if (!state.isSoloMode) {
        socket.disconnect();
        socket.connect();
      }
      resetToMenu();
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
      if (!state.isSoloMode) {
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
      data: { avatar: state.playerAvatarUrl }
    };

    try {
      console.log('[INVITE] Chiamata authenticateGuest per room:', code, 'player:', name);
      const token = await authenticateGuest(code, name);
      console.log('[INVITE] authenticateGuest OK, token ricevuto');
      safeSessionStorage.setItem('overunder_token', token);
      safeStorage.setItem('overunder_token', token);
      if (socket.connected) {
        console.log('[INVITE] Socket già connesso, invio AUTH');
        socket.emit('AUTH', { token });
      } else {
        console.log('[INVITE] Socket non connesso, avvio connessione...');
        socket.connect();
      }
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
  if (el.btnKickedHome) {
    el.btnKickedHome.addEventListener('click', () => {
      AudioSynth.playConfirm(false);
      clearSession();
      resetToMenu();
    });
  }

  if (el.btnRoomFullHome) {
    el.btnRoomFullHome.addEventListener('click', () => {
      AudioSynth.playConfirm(false);
      clearSession();
      resetToMenu();
    });
  }

  if (el.btnLoadingHome) {
    el.btnLoadingHome.addEventListener('click', () => {
      AudioSynth.playConfirm(false);
      clearSession();
      resetToMenu();
    });
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

// ==========================================================================
// RICEZIONE DEGLI EVENTI DI RETE (SOCKET.IO LISTENERS)
// ==========================================================================
function setupSocketListeners() {
  // 0. Connessione e Ripristino Sessione
  socket.on('connect', () => {
    console.log("Connesso al server. ID Socket:", socket.id);
    state.socketAuthenticated = false;

    const savedToken = safeSessionStorage.getItem('overunder_token');
    if (savedToken) {
      console.log('[SOCKET] connect: invio AUTH con token salvato');
      socket.emit('AUTH', { token: savedToken });
    } else {
      console.log('[SOCKET] connect: nessun token salvato in sessionStorage');
    }
  });

  socket.on('connect_error', (err) => {
    console.warn("[SOCKET] Errore di connessione:", err.message);
  });

  socket.on('disconnect', (reason) => {
    console.warn("[SOCKET] Socket disconnesso:", reason);
    state.socketAuthenticated = false;
  });

  socket.on('AUTH_SUCCESS', () => {
    state.socketAuthenticated = true;
    console.log("Socket autenticato con successo!");
    updatePremiumUI();

    if (state.pendingSocketAction) {
      if (state.pendingSocketAction.type === 'create_room') {
        socket.emit('create_room', state.pendingSocketAction.data);
      } else if (state.pendingSocketAction.type === 'join_room') {
        socket.emit('join_room', state.pendingSocketAction.data);
      }
      state.pendingSocketAction = null;
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
        sessionId: sessionId
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
    state.localPremiumCards = [];

    // Forzatura rendering della schermata corretta in base al tipo di stato
    if (roomState === 'lobby' || roomState === 'card_submission') {
      setupLobbyUI();
    } else if (roomState === 'playing') {
      state.currentDeckName = gameData.deckName || 'OVER / UNDER';
      state.totalCards = gameData.totalCards || 0;
      state.currentPromptText = gameData.prompt || '';
      state.currentCardIndex = gameData.cardIndex || 0;
      state.userHasVoted = !!gameData.userHasVoted;

      if (el.currentDeckName) el.currentDeckName.textContent = state.currentDeckName;
      if (el.currentPromptText) el.currentPromptText.textContent = state.currentPromptText;
      
      if (gameData.image) {
        if (el.gameplayPromptImage) el.gameplayPromptImage.src = gameData.image;
        if (el.gameplayPromptImageContainer) el.gameplayPromptImageContainer.style.display = 'block';
      } else {
        if (el.gameplayPromptImageContainer) el.gameplayPromptImageContainer.style.display = 'none';
        if (el.gameplayPromptImage) el.gameplayPromptImage.src = '';
      }
      
      const totalDisplay = (state.totalCards == 9999 || state.totalCards === '∞') ? '∞' : state.totalCards;
      if (el.deckProgress) el.deckProgress.textContent = `Carta ${state.currentCardIndex + 1} / ${totalDisplay}`;
      
      renderGameplayPlayersStatus(gameData.votedPlayers || []);
      
      if (state.userHasVoted) {
        if (el.btnUnderrated) el.btnUnderrated.classList.add('disabled');
        if (el.btnOverrated) el.btnOverrated.classList.add('disabled');
      } else {
        if (el.btnUnderrated) el.btnUnderrated.classList.remove('disabled');
        if (el.btnOverrated) el.btnOverrated.classList.remove('disabled');
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
    state.roomCode = roomCode;
    state.players = players;
    state.playerName = assignedName || players[0].name;
    state.roomIsPremium = !!isPremium;
    state.roomIsLocked = false;
    state.gameplayStarted = false;
    state.hasSubmittedPremiumCards = false;
    state.localPremiumCards = [];

    saveRoomSession(roomCode, state.playerName, true, state.playerAvatarUrl);

    setupLobbyUI();
    updateLockIcon();
  });

  // 2. Ingresso in Stanza riuscito (Player)
  socket.on('room_joined', ({ roomCode, players, isPremium, assignedName, isLocked }) => {
    if (state.connectionTimeout) {
      clearTimeout(state.connectionTimeout);
      state.connectionTimeout = null;
    }
    state.connectionLoadingActive = false;

    state.isHost = false;
    state.roomCode = roomCode;
    state.players = players;
    state.playerName = assignedName || safeSessionStorage.getItem('overunder_playerName') || 'Giocatore';
    state.roomIsPremium = !!isPremium;
    state.roomIsLocked = !!isLocked;
    state.gameplayStarted = false;
    state.hasSubmittedPremiumCards = false;
    state.localPremiumCards = [];

    saveRoomSession(roomCode, state.playerName, false, state.playerAvatarUrl);

    setupLobbyUI();
    updateLockIcon();
  });

  // 3. Errore durante onboarding (Richiede acquisto o ripristino Premium)
  socket.on('trial_expired_error', ({ message }) => {
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
    const paywallModal = el.paywallStandardModal || document.getElementById('paywall-standard-modal');
    if (paywallModal) {
      paywallModal.style.display = 'flex';
      paywallModal.classList.add('active');
    }
  });

  socket.on('room_error', (message) => {
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

  // 4. Aggiornamento lista partecipanti lobby e stato host dinamico
  socket.on('player_list_update', ({ players }) => {
    state.players = players;
    
    // Rileva dinamicamente se siamo diventati Host (failover)
    const me = players.find(p => p.name === state.playerName);
    if (me) {
      const wasHost = state.isHost;
      state.isHost = !!me.isHost;
      safeSessionStorage.setItem('overunder_isHost', state.isHost ? 'true' : 'false');
      
      if (state.isHost && !wasHost) {
        showToast("Sei diventato l'Host della stanza!");
        if (el.screenLobby.classList.contains('active')) {
          setupLobbyUI();
        } else if (el.screenGameplay.classList.contains('active')) {
          if (state.roundEndActive) {
            el.btnNextOverlay.style.display = 'block';
            el.roundEndPlayerWait.style.display = 'none';
          }
        }
      }
    }
    
    renderLobbyPlayers();
    renderGameplayAvatars();
    if (state.isPlayerListOpen) {
      renderPlayerListModalContent();
    }
  });

  // 5. Partita Avviata
  socket.on('game_started', ({ deckName, totalCards }) => {
    state.currentDeckName = deckName;
    state.totalCards = totalCards;
    state.gameplayStarted = true;
    updateLockIcon();
    
    // Suono chime iniziale
    AudioSynth.playConfirm(true);

    if (state.roomIsPremium) {
      showToast(`${totalCards} carte aggiunte`);
    }

    showScreen(el.screenGameplay);
  });

  // 6. Nuova Carta Inviata dal Server
  socket.on('new_card', ({ prompt, image, cardIndex, totalCards, roundId, timerDurationMs }) => {
    state.currentPromptText = prompt;
    state.currentCardIndex = cardIndex;
    state.userHasVoted = false;
    state.roundEndActive = false;
    state.currentRoundId = roundId || 0;

    // Aggiorna la durata timer se il server la specifica (supporto cambio timer mid-game)
    if (timerDurationMs) {
      state.timerDurationMs = timerDurationMs;
      updateTimerPickerSelection();
    }

    // Reset overlay
    el.roundEndOverlay.classList.remove('active');
    el.roundEndOverlayVoteActions.style.display = 'none';
    
    // Gestione Immagine Gameplay Premium
    if (image) {
      el.gameplayPromptImage.src = image;
      el.gameplayPromptImageContainer.style.display = 'block';
    } else {
      el.gameplayPromptImageContainer.style.display = 'none';
      el.gameplayPromptImage.src = '';
    }

    // Reset interfaccia gameplay
    el.currentDeckName.textContent = state.currentDeckName;
    const promptText = image ? '' : prompt;
    el.currentPromptText.textContent = promptText;
    const totalDisplay = (totalCards == 9999 || totalCards === '∞') ? '∞' : totalCards;
    el.deckProgress.textContent = `Carta ${cardIndex + 1} / ${totalDisplay}`;
    
    el.btnUnderrated.classList.remove('disabled', 'pulse-active');
    el.btnOverrated.classList.remove('disabled', 'pulse-active');
    
    // Reset colore e ombra
    el.timerBar.style.background = 'hsl(145, 80%, 50%)';
    el.timerBar.style.boxShadow = '0 0 12px hsl(145, 80%, 50%)';
    
    // Mostra il pannello votazioni gruppo in multiplayer
    el.gameplayStatusPanel.style.display = 'block';
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
  });

  // 7c. Aggiornamento Voti in tempo reale nell'Overlay
  socket.on('verdict_update', ({ votes }) => {
    if (state.roundEndActive) {
      renderRoundEndOverlay(votes);
    }
  });

  // 9. Ricezione Risultati del Round
  socket.on('round_results', (data) => {
    renderRoundResults(data);
  });

  // 10. Fine Partita (Riepilogo e Premi)
  socket.on('game_over', (data) => {
    renderGameOver(data);
  });

  // 11. Reset del gioco (Host torna in Lobby)
  socket.on('lobby_reset', ({ players }) => {
    state.players = players;

    if (state.roomIsPremium) {
      state.hasSubmittedPremiumCards = false;
      state.localPremiumCards = [];
      state.currentCroppedImage = null;
      if (el.premiumImagePreviewContainer) el.premiumImagePreviewContainer.style.display = 'none';
      if (el.premiumImagePreview) el.premiumImagePreview.src = '';
      if (el.premiumCardInput) {
        el.premiumCardInput.value = '';
        el.premiumCardInput.disabled = false;
        el.premiumCardInput.placeholder = 'A cosa stai pensando?';
        el.premiumCardInput.style.paddingLeft = '42px';
      }
      if (el.premiumImageUpload) el.premiumImageUpload.value = '';
      renderCapsules();
    }

    state.gameplayStarted = false;
    updateLockIcon();
    setupLobbyUI();
  });

  // Reset Stanza Normale
  socket.on('game_reset_default', () => {
    // Wipe della chat real-time o commenti
    const chatContainer = document.getElementById('chat-messages');
    if (chatContainer) chatContainer.innerHTML = '';
    
    // Ripristino stati locali
    state.localPremiumCards = [];
    state.currentCroppedImage = null;
    state.hasSubmittedPremiumCards = false;

    // Reset overlay round precedente
    el.roundEndOverlay.classList.remove('active');
    el.roundEndOverlayVoteActions.style.display = 'none';
  });

  // Reset Modalità Gogna
  socket.on('game_reset_gogna', ({ players }) => {
    state.players = players;
    state.hasSubmittedPremiumCards = false;
    state.localPremiumCards = [];
    state.currentCroppedImage = null;

    // Wipe della chat real-time o commenti
    const chatContainer = document.getElementById('chat-messages');
    if (chatContainer) chatContainer.innerHTML = '';

    // Ripristina input mazzo
    if (el.premiumImagePreviewContainer) el.premiumImagePreviewContainer.style.display = 'none';
    if (el.premiumImagePreview) el.premiumImagePreview.src = '';
    if (el.premiumCardInput) {
      el.premiumCardInput.value = '';
      el.premiumCardInput.disabled = false;
      el.premiumCardInput.placeholder = 'A cosa stai pensando?';
      el.premiumCardInput.style.paddingLeft = '42px';
    }
    if (el.premiumImageUpload) el.premiumImageUpload.value = '';
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
      if (el.lobbyPremiumWaiting) el.lobbyPremiumWaiting.style.display = 'none';
      if (!state.isHost && el.lobbyPlayerWaiting) {
        el.lobbyPlayerWaiting.style.display = 'none';
      }
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

    const hasAvatar = (player.avatar && typeof player.avatar === 'string' && player.avatar.trim().length > 15 && !player.avatar.includes('broken'));
    const avatarBg = getAvatarBgColor(player.name);
    const initials = player.name ? player.name.substring(0, 2).toUpperCase() : '??';

    const avatarHtml = hasAvatar
      ? `<img class="lobby-avatar" src="${player.avatar}" style="cursor: pointer;" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';">
         <div class="lobby-avatar-fallback" style="display:none; background-color: ${avatarBg}; cursor: pointer;">${initials}</div>`
      : `<div class="lobby-avatar-fallback" style="background-color: ${avatarBg}; cursor: pointer;">${initials}</div>`;

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
  el.gameplayPlayersStatus.innerHTML = '';
  state.players.forEach(p => {
    const badge = document.createElement('span');
    const hasVoted = votedPlayers.includes(p.name);
    badge.className = `player-status-badge ${hasVoted ? 'has-voted' : ''}`;
    badge.innerHTML = `
      <span>${hasVoted ? '✔️' : '🤔'}</span>
      <span>${p.name}</span>
    `;
    el.gameplayPlayersStatus.appendChild(badge);
  });
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
    
    // In multigiocatore, suona il gong localmente a 0.0s esatti
    if (!state.isSoloMode && !state.roundEndActive) {
      state.roundEndActive = true;
      AudioSynth.playGong();
      stopTimerLoop();
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
  state.currentCroppedImage = null;
  if (el.premiumImagePreviewContainer) el.premiumImagePreviewContainer.style.display = 'none';
  if (el.premiumImagePreview) el.premiumImagePreview.src = '';
  if (el.premiumCardInput) {
    el.premiumCardInput.style.paddingLeft = '42px';
    el.premiumCardInput.disabled = false;
    el.premiumCardInput.placeholder = 'A cosa stai pensando?';
  }
  if (el.premiumImageUpload) el.premiumImageUpload.value = '';
  
  resetFromJoinLink();
  
  if (state.timerRequestId) {
    cancelAnimationFrame(state.timerRequestId);
    state.timerRequestId = null;
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
}

// ==========================================================================
// MODALITÀ GIOCO INDIVIDUALE (SOLO PLAY - OFFLINE)
// ==========================================================================
async function startSoloMode(playerName) {
  state.isSoloMode = true;
  state.isHost = true;
  state.playerName = playerName;
  state.players = [{ id: 'solo', name: playerName, isHost: true }];
  state.soloResponses = [];
  state.soloCardIndex = 0;
  state.roomIsPremium = false;
  state.hasSubmittedPremiumCards = false;

  if (el.createPremiumToggle) {
    el.createPremiumToggle.checked = false;
  }

  // Carica il mazzo dal server o usa il mazzo locale di fallback
  try {
    const response = await fetch('/api/decks');
    const data = await response.json();
    if (data && data.decks && data.decks.length > 0) {
      state.soloAvailableDecks = data.decks;
    } else {
      throw new Error("Mazzi non trovati");
    }
  } catch (e) {
    console.warn("Avviso caricamento mazzi da server. Uso mazzo di backup:", e);
    state.soloAvailableDecks = [{
      deck_id: 'gli_intoccabili',
      deck_name: '🔥 Gli Intoccabili',
      cards: [
        { card_id: 'c001', prompt: "La pizza con l'ananas", global_stats: { underrated: 15, overrated: 85 } },
        { card_id: 'c002', prompt: "L'applauso all'atterraggio dell'aereo", global_stats: { underrated: 10, overrated: 90 } },
        { card_id: 'c003', prompt: "Ordinare un cappuccino dopo le 12:00", global_stats: { underrated: 20, overrated: 80 } },
        { card_id: 'c004', prompt: "L'uso quotidiano del bidet", global_stats: { underrated: 96, overrated: 4 } },
        { card_id: 'c005', prompt: "Aggiungere la panna nella carbonara", global_stats: { underrated: 12, overrated: 88 } }
      ]
    }];
  }

  // Avvia immediatamente la partita in singolo con il numero di carte selezionato dall'utente
  const length = state.soloGameLength || 30;
  startSoloGame(length);
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
  const deck = state.soloAvailableDecks ? state.soloAvailableDecks[0] : null;
  if (!deck || !deck.cards || deck.cards.length === 0) {
    showError("Mazzo non caricato!");
    return;
  }

  // Clona il mazzo e seleziona 'length' carte casuali
  const clonedDeck = JSON.parse(JSON.stringify(deck));
  const shuffledCards = clonedDeck.cards.sort(() => 0.5 - Math.random());
  clonedDeck.cards = shuffledCards.slice(0, Math.min(length, shuffledCards.length));

  state.soloDeck = clonedDeck;
  state.currentDeckName = deck.deck_name || "OverUnder";
  state.totalCards = clonedDeck.cards.length;
  state.soloCardIndex = 0;
  state.soloResponses = [];

  AudioSynth.playConfirm(true);
  showScreen(el.screenGameplay);
  showSoloCard();
}

function showSoloCard() {
  const card = state.soloDeck.cards[state.soloCardIndex];
  if (!card) {
    showSoloSummaryScreen();
    return;
  }
  state.userHasVoted = false;
  const promptStr = card.prompt || card.text || card.promptText || '';
  state.currentPromptText = promptStr;
  state.currentCardIndex = state.soloCardIndex;
  state.currentCardIndex = state.soloCardIndex;

  el.currentDeckName.textContent = state.currentDeckName;
  el.currentPromptText.textContent = card.prompt;
  
  if (card.image) {
    el.gameplayPromptImage.src = card.image;
    el.gameplayPromptImageContainer.style.display = 'block';
  } else {
    el.gameplayPromptImageContainer.style.display = 'none';
    el.gameplayPromptImage.src = '';
  }
  
  const totalDisplay = (state.totalCards == 9999 || state.totalCards === '∞') ? '∞' : state.totalCards;
  el.deckProgress.textContent = `Carta ${state.soloCardIndex + 1} / ${totalDisplay}`;

  el.btnUnderrated.classList.remove('disabled', 'pulse-active');
  el.btnOverrated.classList.remove('disabled', 'pulse-active');

  // Reset timer bar & UI counter
  updateTimerUI(state.timerDurationMs);
  el.timerBar.style.background = 'hsl(145, 80%, 50%)';
  el.timerBar.style.boxShadow = '0 0 12px hsl(145, 80%, 50%)';

  // In solo mode nascondi lo stato votazioni del gruppo e la lista avatar in alto
  el.gameplayPlayersStatus.innerHTML = '';
  el.gameplayStatusPanel.style.display = 'none';
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
}

function handleSoloVote(voteType) {
  // Ferma il timer
  if (state.timerRequestId) {
    cancelAnimationFrame(state.timerRequestId);
    state.timerRequestId = null;
  }

  const card = state.soloDeck.cards[state.soloCardIndex];
  const votes = [{ player: state.playerName, vote: voteType }];

  // Salva risposta
  state.soloResponses.push({
    prompt: card.prompt,
    image: card.image || null,
    votes: votes,
    stats: card.global_stats
  });

  // Avanza immediatamente alla prossima carta o fine gioco
  advanceSoloGame();
}

function advanceSoloGame() {
  state.soloCardIndex++;
  if (state.soloCardIndex < state.soloDeck.cards.length) {
    showSoloCard();
  } else {
    renderSoloGameOver();
  }
}

function renderSoloGameOver() {
  checkMatchEndTrialExpiration();
  // Riproduci suono gong alla fine della partita in Solo
  AudioSynth.playGong();

  // Calcola premi solo
  const stats = {
    [state.playerName]: {
      underrated: 0,
      overrated: 0,
      timeouts: 0,
      agreedWithGroup: 0,
      disagreedWithGroup: 0
    }
  };

  state.soloResponses.forEach(res => {
    res.votes.forEach(v => {
      if (v.vote === 'underrated') stats[state.playerName].underrated++;
      else if (v.vote === 'overrated') stats[state.playerName].overrated++;
      else stats[state.playerName].timeouts++;
    });
  });

  const awards = [];
  const s = stats[state.playerName];
  
  if (s.underrated >= Math.ceil(state.soloResponses.length / 2)) {
    awards.push({
      title: "🟢 IL SOTTO-VALUTATORE",
      winner: state.playerName,
      desc: `Hai votato SOTTOVALUTATO ${s.underrated} volte. Trovi valore in qualsiasi cosa!`,
      icon: "✨"
    });
  }
  if (s.overrated >= Math.ceil(state.soloResponses.length / 2)) {
    awards.push({
      title: "🔴 IL SOPRA-VALUTATORE",
      winner: state.playerName,
      desc: `Hai votato SOPRAVVALUTATO ${s.overrated} volte. Niente sembra soddisfarti!`,
      icon: "⛔"
    });
  }
  if (s.timeouts > 0) {
    awards.push({
      title: "🐌 IL PIGRO",
      winner: state.playerName,
      desc: `Tempo scaduto per ${s.timeouts} volte. La fretta non fa per te!`,
      icon: "💤"
    });
  }

  renderGameOver({
    awards: awards,
    summary: state.soloResponses
  });
}

function renderRoundResults({ votes, groupStats, globalStats, prompt, image, cardIndex, totalCards }) {
  stopTimerLoop();
  state.roundEndActive = true;
  state.currentCardIndex = cardIndex;
  state.totalCards = totalCards;
  state.currentPromptText = prompt;

  // Reset dello stato della barra toggle bridge per ogni nuovo round
  state.isWorldStatsVisible = false;
  el.btnToggleWorldStats.classList.remove('active');
  el.globalStatsCard.classList.remove('active');

  if (state.roomIsPremium) {
    if (el.worldToggleBridge) el.worldToggleBridge.style.display = 'none';
    if (el.globalStatsCard) el.globalStatsCard.style.display = 'none';
  } else {
    if (el.worldToggleBridge) el.worldToggleBridge.style.display = 'flex';
    if (el.globalStatsCard) el.globalStatsCard.style.display = '';
  }

  // Gestione immagine risultati round
  if (el.resultsPromptImageContainer) {
    if (image) {
      el.resultsPromptImage.src = image;
      el.resultsPromptImageContainer.style.display = 'block';
    } else {
      el.resultsPromptImageContainer.style.display = 'none';
      el.resultsPromptImage.src = '';
    }
  }

  // 1. Popola il soggetto del prompt
  const promptText = image ? '' : prompt;
  el.resultsPromptSubject.textContent = promptText;

  // 3. Modulo 1: Il Tuo Gruppo (Barre percentuali bipolari)
  el.groupUnderPctText.textContent = `UNDER ${groupStats.underrated}%`;
  el.groupOverPctText.textContent = `OVER ${groupStats.overrated}%`;
  el.groupUnderFill.style.width = `${groupStats.underrated}%`;
  el.groupOverFill.style.width = `${groupStats.overrated}%`;

  // 4. Modulo 2: Il Mondo (Global, Barre percentuali bipolari)
  el.globalUnderPctText.textContent = `UNDER ${globalStats.underrated}%`;
  el.globalOverPctText.textContent = `OVER ${globalStats.overrated}%`;
  el.globalUnderFill.style.width = `${globalStats.underrated}%`;
  el.globalOverFill.style.width = `${globalStats.overrated}%`;

  // 5. Modulo Dettaglio Voti (Solo in Multiplayer)
  if (state.isSoloMode) {
    el.resultsVotesDetailCard.style.display = 'none';
  } else {
    el.resultsVotesDetailCard.style.display = 'block';
    
    // Salva i voti correnti per il filtraggio
    state.currentRoundResultsVotes = votes;
    state.activeResultsFilter = 'all';

    // Reimposta active classe sui bottoni filtro dei risultati
    document.querySelectorAll('#results-votes-detail-card .votes-filter-container .filter-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === 'all');
    });

    // Renderizza la lista filtrata
    renderFilteredResultsList();
  }
}

function renderFilteredResultsList() {
  const filter = state.activeResultsFilter || 'all';
  const votes = state.currentRoundResultsVotes || [];

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

  // 6. Configura il footer (Controlli avanzamento)
  if (state.isSoloMode) {
    el.btnNextCardConfluent.style.display = 'flex';
    el.resultsPlayerWaitingConfluent.style.display = 'none';
    const isLast = state.currentCardIndex == state.totalCards - 1;
    el.btnNextCardConfluent.querySelector('span').textContent = isLast ? "VEDI CLASSIFICA" : "PROSSIMA CARTA";
  } else if (state.isHost) {
    el.btnNextCardConfluent.style.display = 'flex';
    el.resultsPlayerWaitingConfluent.style.display = 'none';
    const isLast = state.currentCardIndex == state.totalCards - 1;
    el.btnNextCardConfluent.querySelector('span').textContent = isLast ? "VEDI CLASSIFICA" : "PROSSIMA CARTA";
  } else {
    el.btnNextCardConfluent.style.display = 'none';
    el.resultsPlayerWaitingConfluent.style.display = 'flex';
  }

  // 6. Transizione alla schermata
  showScreen(el.screenResults);
}

function renderGameOver({ awards, summary }) {
  checkMatchEndTrialExpiration();
  // Condizionale titolo in base a Solo vs Gruppo
  const subtitleEl = document.getElementById('summary-subtitle');
  if (subtitleEl) {
    subtitleEl.textContent = state.isSoloMode ? "I tuoi risultati" : "I risultati del gruppo";
  }

  // Genera premi
  el.groupAwardsContainer.innerHTML = '';
  if (awards.length === 0) {
    el.groupAwardsContainer.innerHTML = `<div class="no-players-text">Nessun premio speciale assegnato in questa partita!</div>`;
  } else {
    awards.forEach(aw => {
      const card = document.createElement('div');
      card.className = 'award-card';
      card.innerHTML = `
        <div class="award-icon-box">${aw.icon}</div>
        <div class="award-info">
          <div class="award-title-row">
            <span class="award-name">${aw.title}</span>
            <span class="award-winner">${aw.winner}</span>
          </div>
          <div class="award-desc">${aw.desc}</div>
        </div>
      `;
      el.groupAwardsContainer.appendChild(card);
    });
  }

  // Genera verdetti completi per scorrimento
  el.summaryCardsList.innerHTML = '';
  summary.forEach(res => {
    const item = document.createElement('div');
    item.className = 'summary-item';
    
    let playerVotesHtml = '';
    res.votes.forEach(pv => {
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
          <span>${pv.player}</span>
          <span class="summary-item-voto ${badgeClass}">${badgeText}</span>
        </div>
      `;
    });

    const hasImage = res.image ? true : false;
    const imgHtml = hasImage ? `<div class="summary-card-img-container" style="width: 50px; height: 50px; border-radius: 8px; overflow: hidden; border: 1px solid rgba(255,255,255,0.15); margin-right: 12px; flex-shrink: 0; cursor: pointer;"><img class="summary-card-image" src="${res.image}" style="width: 100%; height: 100%; object-fit: cover;"></div>` : '';
    const promptText = res.image ? '' : res.prompt;

    const statsHtml = state.roomIsPremium 
      ? '' 
      : `<span class="summary-item-stats">Mondo: <span style="color: #F97316; font-weight: bold;">OVER ${res.stats.overrated}%</span> / <span style="color: #EC4899; font-weight: bold;">UNDER ${res.stats.underrated}%</span></span>`;

    item.innerHTML = `
      <div style="display: flex; align-items: center; margin-bottom: 8px;">
        ${imgHtml}
        <div class="summary-item-prompt" style="margin-bottom: 0; flex: 1; text-align: left;">${promptText}</div>
      </div>
      <div class="summary-item-details">
        ${playerVotesHtml}
      </div>
      ${statsHtml}
    `;

    if (hasImage) {
      const imgContainer = item.querySelector('.summary-card-img-container');
      if (imgContainer) {
        imgContainer.addEventListener('click', () => {
          openCardImageZoom(res.image, res.prompt);
        });
      }
    }
    el.summaryCardsList.appendChild(item);
  });

  // Controlli Host per riavvio
  if (state.isHost) {
    el.summaryHostControls.style.display = 'block';
    el.summaryPlayerWaiting.style.display = 'none';
    const btnRestartSpan = el.btnRestart ? el.btnRestart.querySelector('span') : null;
    if (btnRestartSpan) {
      btnRestartSpan.textContent = state.isSoloMode ? "TORNA AL MENU" : "RICOMINCIA";
    }
  } else {
    el.summaryHostControls.style.display = 'none';
    el.summaryPlayerWaiting.style.display = 'block';
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
        }
        state.roomIsPremium = true;
        showError("Pagamento confermato! Modalità \"Judgement Day\" sbloccata per sempre! 👑");
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
  
  // Interroga il server per recuperare la modalità della stanza e mostra automaticamente il Modal Onboarding per i Guest
  fetchAndApplyRoomInfo(cleanCode, true);

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
    el.joinNameInput.value = '';
  }
  if (el.nameErrorMsg) el.nameErrorMsg.style.display = 'none';
  
  // Mostra la schermata di onboarding con il modulo di ingresso attivo
  showScreen(el.screenOnboarding);
  if (el.screenOnboarding) {
    try { el.screenOnboarding.scrollTop = 0; } catch (e) {}
  }
  console.log('[INVITE] screenOnboarding attivato con form join');
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

  // Touch & Swipe Support su Mobile
  if (viewport) {
    let touchStartX = 0;
    let touchEndX = 0;

    viewport.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length > 0) {
        touchStartX = e.touches[0].clientX;
      }
    }, { passive: true });

    viewport.addEventListener('touchend', (e) => {
      if (e.changedTouches && e.changedTouches.length > 0) {
        touchEndX = e.changedTouches[0].clientX;
        const diff = touchStartX - touchEndX;
        if (diff > 40) { // Swipe a sinistra -> Avanti
          goToJoinRulesSlide(state.joinRulesCurrentSlide + 1);
        } else if (diff < -40) { // Swipe a destra -> Indietro
          goToJoinRulesSlide(state.joinRulesCurrentSlide - 1);
        }
      }
    }, { passive: true });
  }

  // Pre-render di base
  renderJoinRulesSlides(false);
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

// Eventi e logica per l'editor delle carte Premium personalizzate
function renderCapsules() {
  el.premiumCardsList.innerHTML = '';
  
  state.localPremiumCards.forEach((cardObj, index) => {
    const capsule = document.createElement('div');
    
    const hasImage = cardObj.image ? true : false;
    const imgHtml = hasImage ? `<img src="${cardObj.image}" style="width: 32px; height: 32px; border-radius: 6px; object-fit: cover; margin-right: 8px; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.15);">` : '';
    const textToDisplay = cardObj.image ? (cardObj.text || 'immagine caricata') : cardObj.text;

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

      const saveInlineEdit = () => {
        const newText = input.value.trim();
        if (newText || cardObj.image) {
          state.localPremiumCards[index].text = newText || 'immagine caricata';
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

      const toggleExpandText = () => {
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

          if (activeCropper) activeCropper.destroy();

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
  state.currentCroppedImage = null;
  state.editingPremiumCardIndex = null;
  state.currentUploadedFilename = '';

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
    const val = el.premiumCardInput.value.trim();
    if (!val && !state.currentCroppedImage) return;

    const cardData = {
      text: val || state.currentUploadedFilename || 'immagine caricata',
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

    el.premiumCardInput.value = '';
    
    // Reset image preview state
    state.currentCroppedImage = null;
    state.currentUploadedFilename = '';
    el.premiumImagePreviewContainer.style.display = 'none';
    el.premiumImagePreview.src = '';
    el.premiumCardInput.style.paddingLeft = '42px';
    el.premiumCardInput.disabled = false;
    el.premiumCardInput.placeholder = 'A cosa stai pensando?';
    
    el.premiumCardInput.focus();
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
      
      state.hasSubmittedPremiumCards = true;
      setupLobbyUI();
    });
  }

  // Image upload and Cropper events
  if (el.premiumImageUpload) {
    el.premiumImageUpload.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      state.cropperTarget = 'card';
      state.currentUploadedFilename = file.name;

      const reader = new FileReader();
      reader.onload = (event) => {
        el.cropperImageTarget.src = event.target.result;
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
      };
      reader.readAsDataURL(file);
    });
  }

  if (el.btnCropperConfirm) {
    el.btnCropperConfirm.addEventListener('click', async () => {
      if (!activeCropper) return;

      // Compressione HD Client-Side: 800x800 pixel
      const canvas = activeCropper.getCroppedCanvas({
        width: 800,
        height: 800,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high'
      });

      if (canvas) {
        const confirmBtn = el.btnCropperConfirm;
        confirmBtn.disabled = true;
        const oldText = confirmBtn.textContent;
        confirmBtn.textContent = 'Caricamento...';

        // WebP con fallback a JPEG al 85% di qualità
        let mimeType = 'image/webp';
        let dataUrl = canvas.toDataURL(mimeType, 0.85);
        if (!dataUrl.startsWith('data:image/webp')) {
          mimeType = 'image/jpeg';
          dataUrl = canvas.toDataURL(mimeType, 0.85);
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
                // Caricamento nuova immagine
                state.currentCroppedImage = uploadUrl;
                el.premiumImagePreview.src = uploadUrl;
                el.premiumImagePreviewContainer.style.display = 'flex';
                el.premiumCardInput.style.paddingLeft = '48px';
                el.premiumCardInput.value = '';
                el.premiumCardInput.placeholder = state.currentUploadedFilename || 'immagine caricata';
                el.premiumCardInput.disabled = true;
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
      el.premiumImageUpload.value = '';
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

  if (el.btnCropperCancel) {
    el.btnCropperCancel.addEventListener('click', () => {
      el.cropperModal.classList.remove('active');
      el.cropperModal.style.display = 'none';
      if (activeCropper) {
        activeCropper.destroy();
        activeCropper = null;
      }
      el.premiumImageUpload.value = '';
      if (el.inputAvatarGallery) el.inputAvatarGallery.value = '';
      if (el.inputAvatarCamera) el.inputAvatarCamera.value = '';
      state.editingPremiumCardIndex = null;
      
      const wasCamera = state.cropperSource === 'camera';
      state.cropperTarget = null;
      state.cropperSource = null;

      if (wasCamera && openInAppCamera) {
        openInAppCamera();
      }
    });
  }

  if (el.btnClearImage) {
    el.btnClearImage.addEventListener('click', (e) => {
      e.stopPropagation();
      state.currentCroppedImage = null;
      state.currentUploadedFilename = '';
      el.premiumImagePreviewContainer.style.display = 'none';
      el.premiumImagePreview.src = '';
      el.premiumCardInput.style.paddingLeft = '42px';
      el.premiumCardInput.disabled = false;
      el.premiumCardInput.placeholder = 'A cosa stai pensando?';
      el.premiumCardInput.focus();
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

function setupAvatarEvents() {
  const savedAvatar = localStorage.getItem('overunder_avatarUrl');
  if (savedAvatar) {
    state.playerAvatarUrl = savedAvatar;
    if (el.avatarDefaultSvg) el.avatarDefaultSvg.style.display = 'none';
    if (el.avatarPreviewImg) {
      el.avatarPreviewImg.src = savedAvatar;
      el.avatarPreviewImg.style.display = 'block';
    }
    const box = document.getElementById('avatar-preview-box');
    if (box) box.classList.add('has-image');
  }

  const isInAppBrowser = /Instagram|FBAN|FBAV|TikTok|WhatsApp/i.test(navigator.userAgent);
  let cameraStream = null;

  const closeCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      cameraStream = null;
    }
    if (el.cameraModal) {
      el.cameraModal.classList.remove('active');
      el.cameraModal.style.display = 'none';
    }
    if (el.cameraVideo) {
      el.cameraVideo.srcObject = null;
    }
  };

  openInAppCamera = async () => {
    if (el.avatarOptionsPopover) el.avatarOptionsPopover.style.display = 'none';

    if (isInAppBrowser) {
      if (el.inputAvatarCamera) el.inputAvatarCamera.click();
      return;
    }

    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } },
        audio: false
      });
      if (el.cameraVideo) {
        el.cameraVideo.srcObject = cameraStream;
        el.cameraVideo.play();
      }
      if (el.cameraModal) {
        el.cameraModal.style.display = 'flex';
        el.cameraModal.offsetHeight; // trigger reflow
        el.cameraModal.classList.add('active');
      }
    } catch (err) {
      console.warn("Accesso fotocamera fallito, fallback su input file nativo", err);
      if (el.inputAvatarCamera) el.inputAvatarCamera.click();
    }
  };

  if (el.btnSelectCamera) {
    el.btnSelectCamera.addEventListener('click', (e) => {
      e.stopPropagation();
      openInAppCamera();
    });
  }

  if (el.btnCameraClose) {
    el.btnCameraClose.addEventListener('click', closeCamera);
  }

  if (el.btnCameraCapture) {
    el.btnCameraCapture.addEventListener('click', () => {
      if (!cameraStream || !el.cameraVideo) return;
      const video = el.cameraVideo;
      const canvas = document.createElement('canvas');
      const size = Math.min(video.videoWidth, video.videoHeight);
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const sx = (video.videoWidth - size) / 2;
      const sy = (video.videoHeight - size) / 2;
      ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);

      closeCamera();

      state.cropperTarget = 'avatar';
      state.cropperSource = 'camera';
      el.cropperImageTarget.src = dataUrl;
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
    });
  }

  if (el.btnSelectUpload) {
    el.btnSelectUpload.addEventListener('click', (e) => {
      e.stopPropagation();
      if (el.avatarOptionsPopover) el.avatarOptionsPopover.style.display = 'none';
      if (el.inputAvatarGallery) el.inputAvatarGallery.click();
    });
  }

  if (el.btnTriggerAvatarOptions) {
    el.btnTriggerAvatarOptions.addEventListener('click', (e) => {
      e.stopPropagation();
      if (el.avatarOptionsPopover) {
        const isOpen = el.avatarOptionsPopover.style.display === 'flex';
        el.avatarOptionsPopover.style.display = isOpen ? 'none' : 'flex';
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
      zoomModal.classList.remove('active');
      zoomModal.style.display = 'none';
    });
    zoomModal.addEventListener('click', (e) => {
      if (e.target === zoomModal) {
        zoomModal.classList.remove('active');
        zoomModal.style.display = 'none';
      }
    });
  }

  // Eventi per chiudere lo zoom dell'immagine della carta (Gogna)
  const cardZoomModal = el.cardImageZoomModal;
  const btnCardZoomClose = el.btnCardImageZoomClose;
  if (cardZoomModal && btnCardZoomClose) {
    btnCardZoomClose.addEventListener('click', () => {
      cardZoomModal.classList.remove('active');
      cardZoomModal.style.display = 'none';
    });
    cardZoomModal.addEventListener('click', (e) => {
      if (e.target === cardZoomModal) {
        cardZoomModal.classList.remove('active');
        cardZoomModal.style.display = 'none';
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
      const initials = player.name ? player.name.substring(0, 2).toUpperCase() : '??';
      const bgColor = getAvatarBgColor(player.name);
      avatarContainer.innerHTML = `<div class="avatar-initials-fallback" style="background-color:${bgColor};">${initials}</div>`;
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
      const initials = player.name ? player.name.substring(0, 2).toUpperCase() : '??';
      const bgColor = getAvatarBgColor(player.name);
      avatarHtml = `<div class="modal-player-avatar-fallback" style="background-color:${bgColor}; cursor: pointer;">${initials}</div>`;
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
      zoomFallback.textContent = player.name ? player.name.substring(0, 2).toUpperCase() : '??';
      zoomFallback.style.backgroundColor = getAvatarBgColor(player.name);
      zoomFallback.style.display = 'flex';
    }
  }

  if (zoomName) {
    zoomName.textContent = player.name || '';
  }

  zoomModal.style.display = 'flex';
  zoomModal.offsetHeight;
  zoomModal.classList.add('active');
}

function openCardImageZoom(imageSrc, promptText) {
  if (!imageSrc) return;
  const zoomModal = el.cardImageZoomModal;
  const zoomImage = el.cardImageZoomImage;
  const zoomPrompt = el.cardImageZoomPrompt;

  if (!zoomModal) return;

  if (zoomImage) {
    zoomImage.src = imageSrc;
    zoomImage.style.display = 'block';
  }

  if (zoomPrompt) {
    let cleanPrompt = (promptText || '').trim();
    const cleanLower = cleanPrompt.toLowerCase();
    
    // Controlla se il prompt è un nome file o la stringa di fallback di sistema
    const isFilename = /\.(png|jpg|jpeg|gif|webp)$/i.test(cleanLower) || 
                       cleanLower === 'immagine caricata' ||
                       cleanLower.includes('gemini_generated') ||
                       cleanLower.includes('/uploads/');
                       
    if (isFilename) {
      cleanPrompt = '';
    }
    
    zoomPrompt.textContent = cleanPrompt;
    zoomPrompt.style.display = cleanPrompt ? 'block' : 'none';
  }

  zoomModal.style.display = 'flex';
  zoomModal.offsetHeight;
  zoomModal.classList.add('active');
}

