/**
 * OverUnder MVP - Codice Client (WebSocket Real-time)
 * Gestisce l'interfaccia di rete, la lobby, il timer a 60fps con sfumatura HSL e gli effetti sonori.
 */

// Inizializza Socket.io client con autoConnect disabilitato per evitare timeout prima dell'autenticazione
const socket = io({ autoConnect: false });

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

// Recupera o genera un sessionId persistente per l'utente (Cross-Platform)
let sessionId = localStorage.getItem('overunder_sessionId');
if (!sessionId) {
  sessionId = 'sess_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
  localStorage.setItem('overunder_sessionId', sessionId);
}

// ==========================================================================
// SERVIZI DI AUTENTICAZIONE (JWT)
// ==========================================================================
async function authenticateHost(hostName) {
  const password = "host_" + sessionId;
  try {
    await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: hostName, password, deviceUuid: sessionId, fingerprint: getDeviceFingerprint() })
    });
  } catch (e) {
    console.warn("Registrazione host fallita o utente esistente:", e);
  }

  const logRes = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: hostName, password, deviceUuid: sessionId, fingerprint: getDeviceFingerprint() })
  });

  if (!logRes.ok) {
    const errorData = await logRes.json().catch(() => ({}));
    throw new Error(errorData.error || "Login host fallito");
  }

  const data = await logRes.json();
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
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  },

  playTick(frequency = 800) {
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
  modeTabs: document.querySelector('.mode-tabs'),
  nameErrorMsg: document.getElementById('name-error-msg'),
  
  // Lobby
  lobbyRoomCode: document.getElementById('lobby-room-code'),
  btnLobbyInvite: document.getElementById('btn-lobby-invite'),
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
window.addEventListener('DOMContentLoaded', () => {
  try { initClock(); } catch (e) { console.warn("initClock error:", e); }
  try { setupOnboardingTabs(); } catch (e) { console.warn("setupOnboardingTabs error:", e); }
  try { setupEventListeners(); } catch (e) { console.warn("setupEventListeners error:", e); }
  try { setupSocketListeners(); } catch (e) { console.warn("setupSocketListeners error:", e); }
  try { setupPremiumCreatorEvents(); } catch (e) { console.warn("setupPremiumCreatorEvents error:", e); }
  try { setupAvatarEvents(); } catch (e) { console.warn("setupAvatarEvents error:", e); }
  try { checkUrlParams(); } catch (e) { console.warn("checkUrlParams error:", e); }
  try { updateAudioButtonUI(); } catch (e) { console.warn("updateAudioButtonUI error:", e); }
  try { runSplashScreen(); } catch (e) { console.warn("runSplashScreen error:", e); }
  try { updatePremiumUI(); } catch (e) { console.warn("updatePremiumUI error:", e); }
});

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

function runSplashScreen() {
  // Avvia il fade-out dello splash screen a 1.0s
  setTimeout(() => {
    if (el.screenSplash) {
      el.screenSplash.classList.add('fade-out');
    }
  }, 1000);

  // Nascondi lo splash screen a 1.2s e mostra la schermata principale
  setTimeout(() => {
    if (el.screenSplash) {
      el.screenSplash.style.display = 'none';
      el.screenSplash.classList.remove('active');
    }
    
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
  }, 1200);
}

function showScreen(targetScreen) {
  [el.screenWelcome, el.screenOnboarding, el.screenLobby, el.screenGameplay, el.screenResults, el.screenSummary, el.screenKicked, el.screenRoomFull, el.screenLoading].forEach(screen => {
    if (screen) screen.classList.remove('active');
  });
  targetScreen.classList.add('active');

  // Configura il timer counter cliccabile solo in gameplay per l'host
  if (targetScreen === el.screenGameplay) {
    setupTimerCounterClickable();
  } else {
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
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = "top";
  ctx.font = "14px 'Arial'";
  ctx.fillStyle = "#f60";
  ctx.fillRect(125, 1, 62, 20);
  ctx.fillStyle = "#069";
  ctx.fillText("OverUnderFingerprint", 2, 15);
  ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
  ctx.fillText("OverUnderFingerprint", 4, 17);
  const canvasData = canvas.toDataURL();
  
  const components = [
    navigator.userAgent,
    navigator.language,
    screen.colorDepth,
    screen.width + 'x' + screen.height,
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency || 2,
    navigator.deviceMemory || 4,
    canvasData
  ];
  const str = components.join('###');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return 'fp_' + Math.abs(hash);
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

async function checkTrialStatus() {
  try {
    const fingerprint = getDeviceFingerprint();
    const res = await fetch(`/api/trial/status?deviceUuid=${sessionId}&fingerprint=${fingerprint}`);
    if (res.ok) {
      const data = await res.json();
      if (data.activated) {
        if (data.active) {
          state.trialActivated = true;
          localStorage.setItem('overunder_trial_activated', 'true');
          if (el.onboardingGiftBanner) {
            el.onboardingGiftBanner.style.display = 'none';
          }
        } else {
          state.trialActivated = false;
          localStorage.setItem('overunder_trial_activated', 'expired');
          if (el.onboardingGiftBanner) {
            el.onboardingGiftBanner.style.display = 'none';
          }
        }
      } else {
        state.trialActivated = false;
        localStorage.removeItem('overunder_trial_activated');
        if (el.onboardingGiftBanner) {
          el.onboardingGiftBanner.style.display = 'block';
        }
      }
    }
  } catch (e) {
    console.warn("Errore recupero stato trial:", e);
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
  
  state.trialActivated = true;
  localStorage.setItem('overunder_trial_activated', 'true');
  
  if (el.onboardingGiftBanner) {
    el.onboardingGiftBanner.style.display = 'none';
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

  // === WELCOME START ===
  if (el.btnWelcomeStart) {
    if (process.env.NODE_ENV === 'development') {
      if (el.btnDebugTrial) el.btnDebugTrial.style.display = 'block';
      if (el.btnTestExpired) el.btnTestExpired.style.display = 'block';
      if (el.btnResetNoPremium) el.btnResetNoPremium.style.display = 'block';
    }

    el.btnWelcomeStart.addEventListener('click', () => {
      AudioSynth.init();
      AudioSynth.playConfirm(true);

      const trialActivated = localStorage.getItem('overunder_trial_activated') === 'true';
      const trialExpired = localStorage.getItem('overunder_trial_activated') === 'expired';
      const trialShown = localStorage.getItem('overunder_trial_shown') === 'true';

      if (process.env.NODE_ENV === 'production' && !trialActivated && !trialExpired && !trialShown) {
        if (el.trialGiftModal) {
          el.trialGiftModal.style.display = 'flex';
          el.trialGiftModal.classList.add('active');
          localStorage.setItem('overunder_trial_shown', 'true');
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
      if (el.createPremiumToggle.checked) {
        const isPremium = checkPremiumStatusFromToken();
        if (isPremium) {
          return;
        }
        const trialActivated = localStorage.getItem('overunder_trial_activated') === 'true';
        const trialExpired = localStorage.getItem('overunder_trial_activated') === 'expired';

        if (trialExpired) {
          el.createPremiumToggle.checked = false;
          if (el.trialExpiredModal) {
            el.trialExpiredModal.style.display = 'flex';
            el.trialExpiredModal.classList.add('active');
          }
          showError("Il tuo periodo di prova gratuito è terminato. Sblocca la modalità per continuare.");
        } else if (!trialActivated) {
          el.createPremiumToggle.checked = false;
          const standardModal = document.getElementById('paywall-standard-modal');
          if (standardModal) {
            standardModal.style.display = 'flex';
            standardModal.classList.add('active');
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
      updatePremiumUI();
      showError("Stato Premium resettato a NON ACQUISTATO!");
    });
  }

  // === ATTIVAZIONE REGALO (TRIAL) ===
  if (el.btnActivateTrial) {
    el.btnActivateTrial.addEventListener('click', async () => {
      try {
        el.btnActivateTrial.disabled = true;
        el.btnActivateTrial.innerText = "ATTIVAZIONE...";
        
        triggerParticleExplosion();
        AudioSynth.init();
        AudioSynth.playConfirm(true);
        
        await activateTrialOnServer();
        
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

  // === REGALO PIÙ TARDI ===
  if (el.btnActivateLaterModal) {
    el.btnActivateLaterModal.addEventListener('click', () => {
      localStorage.setItem('overunder_trial_shown', 'true');
      if (el.trialGiftModal) {
        el.trialGiftModal.style.display = 'none';
        el.trialGiftModal.classList.remove('active');
      }
      showScreen(el.screenOnboarding);
    });
  }

  // === BANNER REGALO ONBOARDING ===
  if (el.onboardingGiftBanner) {
    el.onboardingGiftBanner.addEventListener('click', () => {
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

  // === PAYWALL BLOCKER ACQUISTA (Stripe / IAP) ===
  if (el.btnPaywallBuy) {
    el.btnPaywallBuy.addEventListener('click', () => handleStripePurchase(el.btnPaywallBuy));
  }

  // === PAYWALL STANDARD BUY (Stripe / IAP) ===
  const btnPaywallStandardBuy = document.getElementById('btn-paywall-standard-buy');
  if (btnPaywallStandardBuy) {
    btnPaywallStandardBuy.addEventListener('click', () => handleStripePurchase(btnPaywallStandardBuy));
  }

  // === PAYWALL STANDARD CLOSE ===
  const btnPaywallStandardClose = document.getElementById('btn-paywall-standard-close');
  if (btnPaywallStandardClose) {
    btnPaywallStandardClose.addEventListener('click', () => {
      const standardModal = document.getElementById('paywall-standard-modal');
      if (standardModal) {
        standardModal.style.display = 'none';
        standardModal.classList.remove('active');
      }
    });
  }

  // === SOLO PLAY ===
  el.btnSoloPlay.addEventListener('click', () => {
    const name = el.soloNameInput.value.trim();
    if (!name) {
      showError('Inserisci il tuo nome!');
      return;
    }
    AudioSynth.init();
    startSoloMode(name);
  });

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
    const isPremium = el.createPremiumToggle ? el.createPremiumToggle.checked : false;
    AudioSynth.init();

    // Definisci l'azione di creazione stanza da eseguire una volta autenticato il socket
    state.pendingSocketAction = {
      type: 'create_room',
      data: { roomCode: code, avatar: state.playerAvatarUrl, isPremium: isPremium }
    };

    if (state.socketAuthenticated) {
      socket.emit('create_room', state.pendingSocketAction.data);
      state.pendingSocketAction = null;
    } else {
      try {
        showError("Autenticazione in corso...");
        const token = await authenticateHost(name);
        sessionStorage.setItem('overunder_token', token);
        socket.connect();
      } catch (err) {
        showError(err.message || "Errore durante l'autenticazione dell'Host.");
        state.pendingSocketAction = null;
      }
    }
  });

  // Pulsante invita in lobby
  el.btnLobbyInvite.addEventListener('click', () => {
    if (!state.roomCode) return;
    const inviteLink = window.location.origin + '/?room=' + state.roomCode;
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

  // Host: Avvio del Gioco (Avvia direttamente con la durata selezionata)
  el.btnHostStartGame.addEventListener('click', () => {
    if (!state.isHost) return;
    
    if (state.isSoloMode) {
      startSoloGame(state.gameLength);
    } else {
      socket.emit('start_game', { gameLength: state.gameLength });
    }
  });

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
  el.btnUnderrated.addEventListener('click', () => submitVote('underrated'));
  el.btnOverrated.addEventListener('click', () => submitVote('overrated'));

  // Host: Aggiunta Bot
  el.btnAddBots.addEventListener('click', () => {
    if (!state.isHost) return;
    socket.emit('add_bots');
  });

  // Host: click per avanzare (PROSSIMA CARTA dall'overlay)
  el.btnNextOverlay.addEventListener('click', () => {
    if (!state.isHost) return;
    socket.emit('next_card');
  });

  // Voto tardivo dall'overlay
  el.btnNextUnder.addEventListener('click', () => submitLateVote('underrated'));
  el.btnNextOver.addEventListener('click', () => submitLateVote('overrated'));

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
  el.btnToggleWorldStats.addEventListener('click', () => {
    state.isWorldStatsVisible = !state.isWorldStatsVisible;
    if (state.isWorldStatsVisible) {
      el.btnToggleWorldStats.classList.add('active');
      el.globalStatsCard.classList.add('active');
      AudioSynth.playConfirm(true);
      setTimeout(() => {
        el.globalStatsCard.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }, 100);
    } else {
      el.btnToggleWorldStats.classList.remove('active');
      el.globalStatsCard.classList.remove('active');
      AudioSynth.playConfirm(false);
    }
  });

  // Host o Solo: Passa alla prossima carta
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

  // Host: Torna al Menu / Reset Lobby
  el.btnRestart.addEventListener('click', () => {
    if (state.isSoloMode) {
      resetToMenu();
      return;
    }
    if (state.isHost) {
      socket.emit('restart_game');
    }
  });

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
  el.btnBackLobby.addEventListener('click', () => {
    AudioSynth.playConfirm(false);
    if (!state.isSoloMode) {
      socket.disconnect();
      socket.connect();
    }
    resetToMenu();
  });

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

  el.btnExitCancel.addEventListener('click', () => {
    AudioSynth.playConfirm(true);
    closeExitModal();
  });

  el.btnExitConfirm.addEventListener('click', () => {
    AudioSynth.playConfirm(false);
    state.isExitModalOpen = false;
    el.exitModal.classList.remove('active');
    el.exitModal.style.display = 'none';
    if (!state.isSoloMode) {
      socket.disconnect();
      socket.connect();
    }
    resetToMenu();
  });

  // Pulsante esci (X) durante gameplay
  el.btnQuitGameplay.addEventListener('click', () => {
    AudioSynth.playConfirm(false);
    openExitModal();
  });

  // Pulsante esci (X) durante i risultati del round
  el.btnQuitResults.addEventListener('click', () => {
    AudioSynth.playConfirm(false);
    openExitModal();
  });

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
  el.btnJoinRoomLink.addEventListener('click', async () => {
    const name = el.joinNameInput.value.trim();
    const code = state.pendingRoomToJoin;
    if (!name) {
      showError("Inserisci il tuo nome!");
      return;
    }
    if (!code) {
      showError("Codice stanza non valido!");
      return;
    }
    AudioSynth.init();
    
    // Salva temporaneamente il nome in sessionStorage (verrà formalizzato su 'room_joined')
    sessionStorage.setItem('overunder_playerName', name);
    
    startConnectionLoading();

    state.pendingSocketAction = {
      type: 'join_room',
      data: { avatar: state.playerAvatarUrl }
    };

    if (state.socketAuthenticated) {
      socket.emit('join_room', state.pendingSocketAction.data);
      state.pendingSocketAction = null;
    } else {
      try {
        const token = await authenticateGuest(code, name);
        sessionStorage.setItem('overunder_token', token);
        socket.connect();
      } catch (err) {
        handleConnectionError('not_found');
        showError(err.message || "Impossibile accedere alla stanza.");
        state.pendingSocketAction = null;
      }
    }
  });

  // Annulla ingresso via Link
  el.btnCancelJoinLink.addEventListener('click', () => {
    AudioSynth.playConfirm(false);
    resetFromJoinLink();
    showScreen(el.screenWelcome);
  });

  // Torna a Benvenuto da Onboarding
  el.btnBackOnboarding.addEventListener('click', () => {
    AudioSynth.playConfirm(false);
    showScreen(el.screenWelcome);
  });

  // Controllo Lucchetto (Lobby Lock)
  if (el.btnLockRoom) {
    el.btnLockRoom.addEventListener('click', () => {
      if (!state.isHost) return;
      AudioSynth.playConfirm(true);
      socket.emit('toggle_room_lock');
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

    const savedToken = sessionStorage.getItem('overunder_token');
    if (savedToken) {
      socket.emit('AUTH', { token: savedToken });
    }
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

    const savedRoom = sessionStorage.getItem('overunder_roomCode');
    const savedName = sessionStorage.getItem('overunder_playerName');
    const savedHost = sessionStorage.getItem('overunder_isHost') === 'true';

    if (savedRoom && savedName) {
      console.log("Tentativo di ripristino sessione:", savedRoom, savedName);
      startConnectionLoading();
      socket.emit('restore_session', { roomCode: savedRoom, playerName: savedName, isHost: savedHost, sessionId: sessionId });
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

  socket.on('session_restored', ({ state: roomState, roomCode, players, isHost, isPremium, isLocked, currentScreen, gameData, assignedName }) => {
    if (state.connectionTimeout) {
      clearTimeout(state.connectionTimeout);
      state.connectionTimeout = null;
    }
    state.connectionLoadingActive = false;

    console.log("Sessione ripristinata con successo!");
    state.isHost = isHost;
    state.roomCode = roomCode;
    state.players = players;
    state.playerName = assignedName || sessionStorage.getItem('overunder_playerName');
    state.roomIsPremium = !!isPremium;
    state.roomIsLocked = !!isLocked;
    state.currentRoundId = gameData.roundId || 0;
    state.gameplayStarted = (roomState === 'playing' || roomState === 'results' || roomState === 'summary');
    updateLockIcon();
    
    sessionStorage.setItem('overunder_playerName', state.playerName);
    sessionStorage.setItem('overunder_isHost', state.isHost ? 'true' : 'false');
    
    const myPlayer = players.find(p => p.name === state.playerName);
    state.hasSubmittedPremiumCards = myPlayer ? !!myPlayer.premiumReady : false;
    state.localPremiumCards = [];
    
    if (currentScreen === 'lobby') {
      setupLobbyUI();
    } else if (currentScreen === 'playing') {
      state.currentDeckName = gameData.deckName;
      state.totalCards = gameData.totalCards;
      state.currentPromptText = gameData.prompt;
      state.currentCardIndex = gameData.cardIndex;
      state.userHasVoted = gameData.userHasVoted;

      // Sincronizza UI gameplay ed eventuale immagine
      el.currentDeckName.textContent = state.currentDeckName;
      el.currentPromptText.textContent = state.currentPromptText;
      
      if (gameData.image) {
        el.gameplayPromptImage.src = gameData.image;
        el.gameplayPromptImageContainer.style.display = 'block';
      } else {
        el.gameplayPromptImageContainer.style.display = 'none';
        el.gameplayPromptImage.src = '';
      }
      
      const totalDisplay = (state.totalCards == 9999 || state.totalCards === '∞') ? '∞' : state.totalCards;
      el.deckProgress.textContent = `Carta ${state.currentCardIndex + 1} / ${totalDisplay}`;
      
      // Aggiorna badge di stato votazioni dei giocatori
      renderGameplayPlayersStatus(gameData.votedPlayers);
      
      if (state.userHasVoted) {
        el.btnUnderrated.classList.add('disabled');
        el.btnOverrated.classList.add('disabled');
      } else {
        el.btnUnderrated.classList.remove('disabled');
        el.btnOverrated.classList.remove('disabled');
      }

      // Sincronizza timer locale
      const elapsed = Date.now() - gameData.roundStartTime;
      const remainingMs = Math.max(0, gameData.timerDurationMs - elapsed);
      
      state.lastTickElapsed = elapsed;
      state.timerStartTime = Date.now() - elapsed;
      state.timerDurationMs = gameData.timerDurationMs;
      
      if (state.timerRequestId) {
        cancelAnimationFrame(state.timerRequestId);
      }
      state.timerRequestId = requestAnimationFrame(gameLoop);
      
      showScreen(el.screenGameplay);
    } else if (currentScreen === 'results') {
      renderRoundResults(gameData.results);
    } else if (currentScreen === 'summary') {
      renderGameOver(gameData.summary);
    }
  });

  socket.on('session_failed', (message) => {
    if (state.connectionLoadingActive) {
      clearTimeout(state.connectionTimeout);
      state.connectionLoadingActive = false;
      handleConnectionError('not_found');
    } else {
      console.warn("Ripristino sessione fallito:", message);
      clearSession();
      resetToMenu();
      alert("La sessione di gioco è scaduta o il server è stato riavviato.");
    }
  });

  // 1. Stanza creata con successo (Host)
  socket.on('room_created', ({ roomCode, players, isPremium, assignedName }) => {
    state.isHost = true;
    state.roomCode = roomCode;
    state.players = players;
    state.playerName = assignedName || players[0].name;
    state.roomIsPremium = !!isPremium;
    state.roomIsLocked = false;
    state.gameplayStarted = false;
    state.hasSubmittedPremiumCards = false;
    state.localPremiumCards = [];

    sessionStorage.setItem('overunder_roomCode', roomCode);
    sessionStorage.setItem('overunder_playerName', state.playerName);
    sessionStorage.setItem('overunder_isHost', 'true');

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
    state.playerName = assignedName || sessionStorage.getItem('overunder_playerName') || 'Giocatore';
    state.roomIsPremium = !!isPremium;
    state.roomIsLocked = !!isLocked;
    state.gameplayStarted = false;
    state.hasSubmittedPremiumCards = false;
    state.localPremiumCards = [];

    sessionStorage.setItem('overunder_roomCode', roomCode);
    sessionStorage.setItem('overunder_playerName', state.playerName);
    sessionStorage.setItem('overunder_isHost', 'false');

    setupLobbyUI();
    updateLockIcon();
  });

  // 3. Errore durante onboarding
  socket.on('trial_expired_error', ({ message }) => {
    if (state.connectionLoadingActive) {
      clearTimeout(state.connectionTimeout);
      state.connectionLoadingActive = false;
    }
    state.roomIsPremium = false;
    if (el.createPremiumToggle) {
      el.createPremiumToggle.checked = false;
    }
    if (el.trialExpiredModal) {
      el.trialExpiredModal.style.display = 'flex';
      el.trialExpiredModal.classList.add('active');
    }
    showError(message || "Il tuo regalo di benvenuto è scaduto!");
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
    } else {
      showError(message);
    }
  });

  // 4. Aggiornamento lista partecipanti lobby e stato host dinamico
  socket.on('player_list_update', ({ players }) => {
    state.players = players;
    
    // Rileva dinamicamente se siamo diventati Host (failover)
    const me = players.find(p => p.name === state.playerName);
    if (me) {
      const wasHost = state.isHost;
      state.isHost = !!me.isHost;
      sessionStorage.setItem('overunder_isHost', state.isHost ? 'true' : 'false');
      
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

  // 12. Host si è scollegato, chiusura stanza
  socket.on('room_closed', (message) => {
    alert(message);
    resetToMenu();
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

  socket.on('kicked_from_room', () => {
    if (state.connectionTimeout) {
      clearTimeout(state.connectionTimeout);
      state.connectionTimeout = null;
    }
    state.connectionLoadingActive = false;
    clearSession();
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
  el.lobbyRoomCode.textContent = state.roomCode;
  
  // Mostra elementi lobby per multiplayer e resetta layout round
  el.lobbyHeader.style.display = 'block';
  el.lobbyPlayersPanel.style.display = 'block';
  el.btnAddBots.style.display = 'block';
  el.roundsSelectorGrid.classList.remove('rounds-vertical');
  
  if (state.isHost) {
    el.lobbyHostControls.style.display = 'block';
    el.lobbyPlayerWaiting.style.display = 'none';
  } else {
    el.lobbyHostControls.style.display = 'none';
    el.lobbyPlayerWaiting.style.display = 'block';
  }

  // Gestione Premium UI
  if (state.roomIsPremium) {
    if (el.roundsSelectorGrid) el.roundsSelectorGrid.style.display = 'none';
    const roundLabel = el.lobbyHostControls ? el.lobbyHostControls.querySelector('.input-label') : null;
    if (roundLabel) roundLabel.style.display = 'none';

    if (state.hasSubmittedPremiumCards) {
      el.lobbyPremiumCreator.style.display = 'none';
      el.lobbyPremiumWaiting.style.display = 'flex';
      if (!state.isHost) {
        el.lobbyPlayerWaiting.style.display = 'none';
      }
    } else {
      el.lobbyPremiumCreator.style.display = 'flex';
      el.lobbyPremiumWaiting.style.display = 'none';
      if (!state.isHost) {
        el.lobbyPlayerWaiting.style.display = 'none';
      }
    }
  } else {
    if (el.roundsSelectorGrid) el.roundsSelectorGrid.style.display = 'grid';
    const roundLabel = el.lobbyHostControls ? el.lobbyHostControls.querySelector('.input-label') : null;
    if (roundLabel) roundLabel.style.display = 'block';
    
    el.lobbyPremiumCreator.style.display = 'none';
    el.lobbyPremiumWaiting.style.display = 'none';
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

    const hasAvatar = player.avatar ? true : false;
    const avatarHtml = hasAvatar
      ? `<img class="lobby-avatar" src="${player.avatar}" style="cursor: pointer;">`
      : `<div class="lobby-avatar-fallback" style="background-color: ${getAvatarBgColor(player.name)}; cursor: pointer;">${player.name.substring(0, 2).toUpperCase()}</div>`;

    const hostBadge = player.isHost ? `<span class="lobby-player-host-badge" style="position: absolute; top: -6px; left: -6px; font-size: 0.7rem;">👑</span>` : '';

    card.innerHTML = `
      <div style="position: relative; display: flex; align-items: center; flex-shrink: 0; margin-right: 8px;">
        ${avatarHtml}
        ${hostBadge}
      </div>
      <span class="lobby-player-name" style="margin-left: 0;">${player.name} ${player.id === socket.id ? '(Tu)' : ''} ${isOffline ? '(Offline)' : ''}</span>
      ${statusDotHtml}
    `;

    // Aggiungiamo i listener per interazione intenzionale (Kick o Zoom)
    if (!state.isHost || player.name === state.playerName || state.gameplayStarted) {
      // Normale comportamento click per non-host, se stessi o in gioco
      card.addEventListener('click', () => {
        openAvatarZoom(player);
      });
      card.style.cursor = 'pointer';
    } else {
      // Comportamento Host: distingue click sinistro corto (zoom) da long press / click destro (kick)
      let pressTimer = null;
      let isLongPress = false;

      const startPress = (e) => {
        isLongPress = false;
        pressTimer = setTimeout(() => {
          isLongPress = true;
          openKickContextMenu(e, player);
        }, 1000);
      };

      const cancelPress = () => {
        if (pressTimer) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
      };

      // Eventi Touch
      card.addEventListener('touchstart', (e) => {
        startPress(e);
      }, { passive: true });

      card.addEventListener('touchend', (e) => {
        cancelPress();
        if (isLongPress) {
          isLongPress = false;
        } else {
          openAvatarZoom(player);
        }
      });

      card.addEventListener('touchmove', cancelPress, { passive: true });
      card.addEventListener('touchcancel', cancelPress, { passive: true });

      // Eventi Mouse
      card.addEventListener('mousedown', (e) => {
        if (e.button === 0) startPress(e);
      });

      card.addEventListener('mouseup', (e) => {
        cancelPress();
        if (e.button === 0) {
          if (isLongPress) {
            isLongPress = false;
          } else {
            openAvatarZoom(player);
          }
        }
      });

      card.addEventListener('mouseleave', cancelPress);

      // Click Destro (onContextMenu)
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        cancelPress();
        openKickContextMenu(e, player);
      });
      
      card.style.cursor = 'pointer';
    }

    el.lobbyPlayersList.appendChild(card);
  });

  // Gestione pulsante di avvio, stili per Host solitario (spento e disabilitato) e animazioni glow quando entra gente
  if (state.isHost) {
    const hasOtherPlayers = state.players.length > 1;

    // Ripristina stili default
    el.btnHostStartGame.style.background = '';
    el.btnHostStartGame.style.color = '';
    el.btnHostStartGame.style.boxShadow = '';

    if (state.isSoloMode) {
      // Abilitato e pulsante attivo in modalità Solo
      el.btnHostStartGame.disabled = false;
      el.btnHostStartGame.classList.remove('btn-pulse-premium', 'full-glow');
      el.btnHostStartGame.classList.add('btn-pulse-blue');
    } else if (!hasOtherPlayers) {
      // Disabilitato e spento (nessun effetto glow) se l'Host è da solo nella stanza
      el.btnHostStartGame.disabled = true;
      el.btnHostStartGame.classList.remove('btn-pulse-blue', 'btn-pulse-premium', 'full-glow');
    } else {
      // C'è almeno un altro partecipante
      if (state.roomIsPremium) {
        const allReady = state.players.every(p => p.premiumReady);
        el.btnHostStartGame.disabled = !allReady;

        if (allReady) {
          el.btnHostStartGame.classList.remove('btn-pulse-blue');
          el.btnHostStartGame.classList.add('btn-pulse-premium');
        } else {
          el.btnHostStartGame.classList.remove('btn-pulse-blue', 'btn-pulse-premium', 'full-glow');
        }
      } else {
        el.btnHostStartGame.disabled = false;
        el.btnHostStartGame.classList.remove('btn-pulse-premium', 'full-glow');
        el.btnHostStartGame.classList.add('btn-pulse-blue');
      }
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

  // Ferma il timer loop locale
  if (state.timerRequestId) {
    cancelAnimationFrame(state.timerRequestId);
    state.timerRequestId = null;
  }

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

function pauseTimer() {
  if (state.timerRequestId) {
    cancelAnimationFrame(state.timerRequestId);
    state.timerRequestId = null;
    state.timerPaused = true;
    state.pausedElapsed = Date.now() - state.timerStartTime;
  }
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
  const elapsed = Date.now() - state.timerStartTime;
  
  if (elapsed >= state.timerDurationMs) {
    updateTimerUI(0);
    el.btnUnderrated.classList.add('disabled');
    el.btnOverrated.classList.add('disabled');
    
    // In multigiocatore, suona il gong localmente a 0.0s esatti
    if (!state.isSoloMode && !state.roundEndActive) {
      state.roundEndActive = true;
      AudioSynth.playGong();
    }
    
    // In solo mode, auto-advance on timer expiry
    if (state.isSoloMode && !state.userHasVoted) {
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
  sessionStorage.removeItem('overunder_roomCode');
  sessionStorage.removeItem('overunder_playerName');
  sessionStorage.removeItem('overunder_isHost');
  sessionStorage.removeItem('overunder_token');
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

  // Carica il mazzo unico dal server
  try {
    const response = await fetch('/api/decks');
    const data = await response.json();
    state.soloAvailableDecks = data.decks;
  } catch (e) {
    showError('Impossibile caricare il mazzo di gioco.');
    return;
  }

  // Mostra la lobby per giocatore singolo
  setupSoloLobbyUI();
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
  const deck = state.soloAvailableDecks[0];
  if (!deck) {
    showError("Mazzo non caricato!");
    return;
  }

  // Clona il mazzo e seleziona 'length' carte casuali
  const clonedDeck = JSON.parse(JSON.stringify(deck));
  const shuffledCards = clonedDeck.cards.sort(() => 0.5 - Math.random());
  clonedDeck.cards = shuffledCards.slice(0, length);

  state.soloDeck = clonedDeck;
  state.currentDeckName = "OverUnder";
  state.totalCards = length;
  state.soloCardIndex = 0;
  state.soloResponses = [];

  AudioSynth.playConfirm(true);
  showScreen(el.screenGameplay);
  showSoloCard();
}

function showSoloCard() {
  const card = state.soloDeck.cards[state.soloCardIndex];
  state.userHasVoted = false;
  state.currentPromptText = card.prompt;
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

  // Reset timer bar
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

function startConnectionLoading() {
  state.connectionLoadingActive = true;
  state.connectionStartTime = Date.now();
  
  showScreen(el.screenLoading);
  
  if (el.loadingSpinnerContainer) el.loadingSpinnerContainer.style.display = 'flex';
  if (el.btnLoadingHome) el.btnLoadingHome.style.display = 'none';
  if (el.loadingStatusText) {
    el.loadingStatusText.textContent = "Connessione alla stanza in corso...";
    el.loadingStatusText.style.opacity = 1;
  }
  
  if (state.connectionTimeout) {
    clearTimeout(state.connectionTimeout);
  }
  
  setTimeout(() => {
    if (state.connectionLoadingActive) {
      updateLoadingText("Recupero partecipanti connessi...");
    }
  }, 1000);
  
  state.connectionTimeout = setTimeout(() => {
    if (state.connectionLoadingActive) {
      handleConnectionError('timeout');
    }
  }, 10000);
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
    el.btnLockRoom.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
      </svg>
    `;
  } else {
    el.btnLockRoom.className = 'btn-lock-room unlocked';
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
  const sessionId = params.get('session_id');

  if (payment === 'success' && sessionId) {
    const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
    window.history.replaceState({ path: cleanUrl }, '', cleanUrl);

    try {
      let token = sessionStorage.getItem('overunder_token');
      if (!token) {
        token = await authenticateHost("host_player");
        sessionStorage.setItem('overunder_token', token);
      }

      const res = await fetch(`/api/stripe/verify-session?session_id=${sessionId}`, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.token) {
          sessionStorage.setItem('overunder_token', data.token);
        }
        state.roomIsPremium = true;
        showError("Pagamento confermato! Modalità \"Judgement Day\" sbloccata per sempre! 👑");
        updatePremiumUI();
      }
    } catch (e) {
      console.error("Errore verifica pagamento:", e);
    }
  }

  const room = params.get('room');
  if (room) {
    const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
    window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
    showJoinFromLink(room.toUpperCase());
  }
}

function showJoinFromLink(roomCode) {
  state.pendingRoomToJoin = roomCode;
  
  // Nascondi le schede standard
  el.modeTabs.style.display = 'none';
  el.formSoloPlay.style.display = 'none';
  el.formCreateRoom.style.display = 'none';
  
  // Mostra il form dedicato
  el.joinRoomCodeDisplay.textContent = roomCode;
  el.formJoinRoomLink.style.display = 'block';
  
  // Resetta input ed errori
  el.joinNameInput.value = '';
  el.nameErrorMsg.style.display = 'none';
  
  // Mostra la schermata di onboarding con il modulo di ingresso attivo
  showScreen(el.screenOnboarding);
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

// Eventi e logica per l'editor delle carte Premium personalizzate
function renderCapsules() {
  el.premiumCardsList.innerHTML = '';
  
  state.localPremiumCards.forEach((cardObj, index) => {
    const capsule = document.createElement('div');
    capsule.className = 'premium-card-capsule';
    
    const hasImage = cardObj.image ? true : false;
    const imgHtml = hasImage ? `<img src="${cardObj.image}" style="width: 32px; height: 32px; border-radius: 6px; object-fit: cover; margin-right: 8px; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.15);">` : '';
    const textToDisplay = cardObj.image ? (cardObj.text || 'immagine caricata') : cardObj.text;

    capsule.innerHTML = `
      <div style="display: flex; align-items: center; flex: 1; min-width: 0;">
        ${imgHtml}
        <span class="capsule-text" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${textToDisplay}</span>
      </div>
      <div class="capsule-menu-container">
        <button class="capsule-menu-trigger">...</button>
        <div class="capsule-menu-dropdown">
          <button class="capsule-menu-item edit">Modifica</button>
          <button class="capsule-menu-item delete">Elimina</button>
        </div>
      </div>
    `;

    const trigger = capsule.querySelector('.capsule-menu-trigger');
    const dropdown = capsule.querySelector('.capsule-menu-dropdown');
    
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.capsule-menu-dropdown').forEach(d => {
        if (d !== dropdown) d.classList.remove('active');
      });
      dropdown.classList.toggle('active');
    });

    capsule.querySelector('.capsule-menu-item.edit').addEventListener('click', () => {
      if (cardObj.image) {
        // Carica l'immagine nel target e apri modal di crop
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
        el.premiumCardInput.value = cardObj.text;
        state.currentCroppedImage = null;
        el.premiumImagePreviewContainer.style.display = 'none';
        el.premiumImagePreview.src = '';
        el.premiumCardInput.style.paddingLeft = '42px';
        el.premiumCardInput.disabled = false;
        el.premiumCardInput.placeholder = 'A cosa stai pensando?';
        state.localPremiumCards.splice(index, 1);
        renderCapsules();
        el.premiumCardInput.focus();
      }
    });

    // Elimina
    capsule.querySelector('.capsule-menu-item.delete').addEventListener('click', () => {
      state.localPremiumCards.splice(index, 1);
      renderCapsules();
    });

    el.premiumCardsList.appendChild(capsule);
  });

  el.btnPremiumCardsSubmit.disabled = state.localPremiumCards.length === 0;
}

function setupPremiumCreatorEvents() {
  state.localPremiumCards = [];
  state.currentCroppedImage = null;
  state.editingPremiumCardIndex = null;
  state.currentUploadedFilename = '';

  document.addEventListener('click', () => {
    document.querySelectorAll('.capsule-menu-dropdown').forEach(d => d.classList.remove('active'));
  });

  const addCard = () => {
    const val = el.premiumCardInput.value.trim();
    if (!val && !state.currentCroppedImage) return;
    
    const exists = state.localPremiumCards.some(c => {
      if (state.currentCroppedImage) {
        return c.image === state.currentCroppedImage;
      }
      return c.text === val;
    });
    
    if (!exists) {
      state.localPremiumCards.push({
        text: val || state.currentUploadedFilename || 'immagine caricata',
        image: state.currentCroppedImage || null
      });
      renderCapsules();
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
      <div class="modal-player-left">
        ${avatarHtml}
        <span class="modal-player-name">${player.name} ${isMe ? '(Tu)' : ''}</span>
      </div>
      ${roleBadge}
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

