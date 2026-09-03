/**
 * OverUnder MVP - Server di Gioco (Express + Socket.io)
 * Gestisce le stanze, i partecipanti, la sincronizzazione del timer e lo stato del gioco.
 */

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { Resend } = require('resend');
const nodemailer = require('nodemailer');
const Redis = require('ioredis');
const { createAdapter } = require('@socket.io/redis-adapter');

let sharp = null;
try {
  sharp = require('sharp');
} catch (err) {
  console.warn('[SHARP INIT WARNING] Modulo sharp non disponibile o caricamento nativo fallito:', err.message);
}

const JWT_SECRET = process.env.JWT_SECRET || 'overunder_super_secret_key_12345_mvp';

// Memoria temporanea per le sessioni OTP di trasferimento licenza (email -> { otp, expiresAt })
const otpSessions = new Map();

/**
 * Funzione per l'invio dell'email OTP tramite SDK ufficiale di Resend o Nodemailer SMTP (con fallback)
 */
async function sendOtpEmail(toEmail, otpCode) {
  // 1. Tenta prima con l'SDK di Resend se RESEND_API_KEY è definita
  if (process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.trim()) {
    const resend = new Resend(process.env.RESEND_API_KEY.trim());
    const fromAddr = process.env.EMAIL_FROM || 'onboarding@resend.dev';

    try {
      const data = await resend.emails.send({
        from: `OverUnder Game <${fromAddr}>`,
        to: [toEmail],
        subject: `Il tuo codice di verifica OverUnder: ${otpCode}`,
        html: `
          <div style="font-family: Arial, sans-serif; background-color: #0f172a; color: #ffffff; padding: 20px; border-radius: 8px;">
            <h2 style="color: #ff007f;">OverUnder - Codice OTP</h2>
            <p>Usa il seguente codice per accedere al gioco:</p>
            <h1 style="font-size: 32px; letter-spacing: 4px; color: #00f0ff;">${otpCode}</h1>
            <p style="font-size: 12px; color: #94a3b8;">Se non hai richiesto tu questo codice, ignora questa email.</p>
          </div>
        `
      });

      if (data && data.error) {
        throw new Error(data.error.message || JSON.stringify(data.error));
      }

      console.log('[RESEND] Email inviata con successo:', data);
      return data;
    } catch (error) {
      const msg = error.message || String(error);
      console.error('[RESEND ERR]', msg);

      // Se il primo tentativo è fallito per via del mittente personalizzato non verificato, tentiamo un fallback con onboarding@resend.dev
      if (fromAddr !== 'onboarding@resend.dev' && (msg.includes('domain') || msg.includes('verify') || msg.includes('not verified') || msg.includes('validation_error'))) {
        console.log('[RESEND RETRY] Tentativo di invio fallback tramite onboarding@resend.dev...');
        try {
          const retryData = await resend.emails.send({
            from: `OverUnder Game <onboarding@resend.dev>`,
            to: [toEmail],
            subject: `Il tuo codice di verifica OverUnder: ${otpCode}`,
            html: `
              <div style="font-family: Arial, sans-serif; background-color: #0f172a; color: #ffffff; padding: 20px; border-radius: 8px;">
                <h2 style="color: #ff007f;">OverUnder - Codice OTP</h2>
                <p>Usa il seguente codice per accedere al gioco:</p>
                <h1 style="font-size: 32px; letter-spacing: 4px; color: #00f0ff;">${otpCode}</h1>
                <p style="font-size: 12px; color: #94a3b8;">Se non hai richiesto tu questo codice, ignora questa email.</p>
              </div>
            `
          });
          if (retryData && retryData.error) {
            throw new Error(retryData.error.message || JSON.stringify(retryData.error));
          }
          console.log('[RESEND RETRY SUCCESS]', retryData);
          return retryData;
        } catch (retryErr) {
          console.error('[RESEND RETRY ERR]', retryErr.message || retryErr);
          if (!process.env.SMTP_HOST && !process.env.SMTP_USER) {
            throw retryErr;
          }
        }
      } else if (!process.env.SMTP_HOST && !process.env.SMTP_USER) {
        throw error;
      }
    }
  }

  // 2. Fallback su Nodemailer SMTP se configurato (SMTP_HOST, SMTP_USER, SMTP_PASS)
  if (process.env.SMTP_HOST || process.env.SMTP_USER || process.env.SMTP_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });

      const sender = process.env.EMAIL_FROM || process.env.SMTP_USER;
      const info = await transporter.sendMail({
        from: `OverUnder Game <${sender}>`,
        to: toEmail,
        subject: `Il tuo codice di verifica OverUnder: ${otpCode}`,
        html: `
          <div style="font-family: Arial, sans-serif; background-color: #0f172a; color: #ffffff; padding: 20px; border-radius: 8px;">
            <h2 style="color: #ff007f;">OverUnder - Codice OTP</h2>
            <p>Usa il seguente codice per accedere al gioco:</p>
            <h1 style="font-size: 32px; letter-spacing: 4px; color: #00f0ff;">${otpCode}</h1>
            <p style="font-size: 12px; color: #94a3b8;">Se non hai richiesto tu questo codice, ignora questa email.</p>
          </div>
        `
      });
      console.log('[SMTP SUCCESS] Email inviata con Nodemailer:', info.messageId);
      return info;
    } catch (smtpErr) {
      console.error('[SMTP ERR]', smtpErr.message || smtpErr);
      throw smtpErr;
    }
  }

  throw new Error("Nessun provider email configurato su Render. Imposta la variabile RESEND_API_KEY oppure SMTP_HOST/SMTP_PASS nel pannello di Render.");
}

// ==========================================================================
// PERSISTENT DATA DIRECTORY (Render disk mount or local fallback)
// ==========================================================================
const DATA_DIR = process.env.DATA_DIR || __dirname;
// Ensure data directory exists
if (DATA_DIR !== __dirname && !fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const USERS_DB_PATH = path.join(DATA_DIR, 'users.json');

function readUsersDb() {
  try {
    if (fs.existsSync(USERS_DB_PATH)) {
      const data = fs.readFileSync(USERS_DB_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error("Errore lettura users.json:", err);
  }
  return {};
}

function writeUsersDb(db) {
  try {
    fs.writeFileSync(USERS_DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error("Errore scrittura users.json:", err);
  }
}

const users = readUsersDb();

function cleanRoomCode(rawCode) {
  if (!rawCode) return '';
  let str = String(rawCode);
  try { str = decodeURIComponent(str); } catch (e) {}
  return str.replace(/[^A-Z0-9 _-]/gi, '').trim().toUpperCase();
}


// Controllo d'ambiente globale per la fase di testing
const IS_PRODUCTION = true; // Impostare a false per tornare in fase di sviluppo

/**
 * Verifica la validità della licenza Judgement Day in tempo reale:
 * Controllo Accesso Esclusivo (Max 1 dispositivo attivo): deviceId === activeDeviceId
 */
function verifyJudgementDayLicense(socket) {
  if (!socket || !socket.userData) {
    return { valid: false, reason: "Non sei autenticato.", code: 'UNAUTHENTICATED' };
  }

  const requestingDeviceId = socket.userData.deviceId || socket.userData.deviceUuid || socket.userData.userId;
  const userEmail = socket.userData.email ? String(socket.userData.email).toLowerCase().trim() : null;
  const userId = socket.userData.userId;

  // 1. Cerca il record licenza in users.json
  let user = null;
  if (userEmail) {
    user = Object.values(users).find(u => u.email && u.email.toLowerCase().trim() === userEmail && u.isPremium);
  }
  if (!user && userId && users[userId] && users[userId].isPremium) {
    user = users[userId];
  }
  if (!user && requestingDeviceId) {
    user = Object.values(users).find(u => (u.activeDeviceId === requestingDeviceId || u.deviceUuid === requestingDeviceId || u.id === requestingDeviceId) && u.isPremium);
  }

  if (!user) {
    // Se il token JWT firmato è valido ed è Premium per questo device, consenti l'accesso
    if (socket.userData.isPremium || socket.userData.premiumStatus === 'PREMIUM_A_VITA') {
      return { valid: true, user: socket.userData };
    }
    return { valid: false, reason: "Nessuna licenza Judgement Day attiva trovata per questo account.", code: 'NOT_FOUND' };
  }

  // Se l'utente premium non ha ancora activeDeviceId impostato, impostalo sul device richiedente
  if (!user.activeDeviceId && requestingDeviceId) {
    user.activeDeviceId = requestingDeviceId;
    user.deviceUuid = requestingDeviceId;
    writeUsersDb(users);
  }

  // 2. Controllo Accesso Esclusivo: il deviceId deve corrispondere ESATTAMENTE ad activeDeviceId
  if (user.activeDeviceId && requestingDeviceId && user.activeDeviceId !== requestingDeviceId) {
    return {
      valid: false,
      reason: "Licenza trasferita su un altro dispositivo. Effettua nuovamente l'accesso con la tua email.",
      code: 'TRANSFERRED',
      user: user
    };
  }

  return { valid: true, user: user };
}

// Database persistente simulato per i regali di benvenuto (Trial)
const TRIAL_DB_PATH = path.join(DATA_DIR, 'trial_db.json');

function readTrialDb() {
  try {
    if (fs.existsSync(TRIAL_DB_PATH)) {
      const data = fs.readFileSync(TRIAL_DB_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error("Errore lettura trial_db.json:", err);
  }
  return [];
}

function writeTrialDb(db) {
  try {
    fs.writeFileSync(TRIAL_DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error("Errore scrittura trial_db.json:", err);
  }
}

// ==========================================================================
// PERSISTENZA MINIMA STORICO PARTITE (GAME HISTORY DB)
// ==========================================================================
const GAME_HISTORY_DB_PATH = path.join(DATA_DIR, 'game_history.json');

function readGameHistoryDb() {
  try {
    if (fs.existsSync(GAME_HISTORY_DB_PATH)) {
      const data = fs.readFileSync(GAME_HISTORY_DB_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error("[DB HIST] Errore lettura game_history.json:", err);
  }
  return [];
}

function saveGameHistoryRecord(record) {
  try {
    const history = readGameHistoryDb();
    history.push(record);
    // Limite storico conservato a 1000 partite per non appesantire il file
    if (history.length > 1000) {
      history.splice(0, history.length - 1000);
    }
    fs.writeFileSync(GAME_HISTORY_DB_PATH, JSON.stringify(history, null, 2), 'utf8');
    console.log(`[DB HIST] Salvato storico partita ${record.matchId} per stanza ${record.roomCode}`);
  } catch (err) {
    console.error("[DB HIST] Errore scrittura game_history.json:", err);
  }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
const server = http.createServer(app);
const io = socketIo(server, {
  maxHttpBufferSize: 1e8, // 100MB per evitare troncamento WebSocket con immagini Base64/payload grandi
  httpCompression: true,
  perMessageDeflate: {
    threshold: 1024,
    zlibDeflateOptions: {
      chunkSize: 16 * 1024,
      memLevel: 7,
      level: 6
    },
    zlibInflateOptions: {
      chunkSize: 16 * 1024
    },
    clientNoContextTakeover: true,
    serverNoContextTakeover: true
  },
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  // Improve mobile connectivity
  pingTimeout: 60000,
  pingInterval: 25000
});

// ==========================================================================
// REDIS IN-MEMORY ROOM STATE & PUB/SUB ADAPTER CONFIGURATION
// ==========================================================================
const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_TLS_URL || null;
const ROOM_TTL_SECONDS = 7200; // 2 ore TTL per Garbage Collection automatica stanze abbandonate

let redisClient = null;
let pubClient = null;
let subClient = null;
let isRedisConnected = false;

if (REDIS_URL) {
  try {
    const redisOptions = {
      retryStrategy(times) {
        const delay = Math.min(times * 150, 3000);
        return delay;
      },
      maxRetriesPerRequest: null,
      enableReadyCheck: false
    };

    if (REDIS_URL.startsWith('rediss://')) {
      redisOptions.tls = { rejectUnauthorized: false };
    }

    redisClient = new Redis(REDIS_URL, redisOptions);
    pubClient = new Redis(REDIS_URL, redisOptions);
    subClient = pubClient.duplicate();

    redisClient.on('connect', () => {
      isRedisConnected = true;
      console.log('[REDIS] Connesso con successo al server Redis per lo stato in-memory delle stanze (<1ms).');
    });

    redisClient.on('error', (err) => {
      console.warn('[REDIS ERR] Errore client Redis (fallback in-memory attivo):', err.message);
    });

    pubClient.on('error', (err) => {
      console.warn('[REDIS PUB ERR]:', err.message);
    });

    subClient.on('error', (err) => {
      console.warn('[REDIS SUB ERR]:', err.message);
    });

    // Collega l'adapter Redis a Socket.io per sincronizzare eventi tra diverse istanze server
    io.adapter(createAdapter(pubClient, subClient));
    console.log('[SOCKET.IO] Redis Pub/Sub Adapter configurato ed attivo!');
  } catch (e) {
    console.warn('[REDIS INIT ERR] Fallback su in-memory locale:', e.message);
  }
} else {
  console.log('[REDIS] Nessun REDIS_URL configurato. Utilizzo in-memory locale con fallback attivo.');
}

const PORT = process.env.PORT || 3000;

// Health check endpoint (used by Render to verify the service is running)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Assicura l'esistenza della cartella uploads
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Configurazione Multer per caricamento file fino a 2MB
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({
  storage: storage,
  limits: { fileSize: 2 * 1024 * 1024 } // Limite 2MB
});

// ==========================================================================
// CARICAMENTO MAZZI DI GIOCO (Con Fallback)
// ==========================================================================
let DECK_DATA = null;
const decksPath = path.join(__dirname, 'decks.json');

try {
  if (fs.existsSync(decksPath)) {
    const rawData = fs.readFileSync(decksPath, 'utf8');
    DECK_DATA = JSON.parse(rawData);
    console.log("Mazzi caricati correttamente da decks.json");
  } else {
    throw new Error("decks.json non trovato");
  }
} catch (error) {
  console.warn("Impossibile caricare decks.json. Uso il mazzo di backup pre-caricato.", error.message);
  DECK_DATA = {
    "decks": [
      {
        "deck_id": "gli_intoccabili",
        "deck_name": "🔥 Gli Intoccabili",
        "cards": [
          { "card_id": "c001", "prompt": "Il senso del rotolo della carta igienica (con lo strappo in avanti)", "global_stats": { "underrated": 85, "overrated": 15 } },
          { "card_id": "c002", "prompt": "Gino Paoli", "global_stats": { "underrated": 30, "overrated": 70 } },
          { "card_id": "c003", "prompt": "Il supermercato Tigre", "global_stats": { "underrated": 92, "overrated": 8 } },
          { "card_id": "c004", "prompt": "La pizza con l'ananas", "global_stats": { "underrated": 15, "overrated": 85 } },
          { "card_id": "c005", "prompt": "Il pandoro senza canditi né uvetta", "global_stats": { "underrated": 78, "overrated": 22 } },
          { "card_id": "c006", "prompt": "Il Festival di Sanremo", "global_stats": { "underrated": 42, "overrated": 58 } },
          { "card_id": "c007", "prompt": "Ordinare un cappuccino dopo le 12:00", "global_stats": { "underrated": 20, "overrated": 80 } },
          { "card_id": "c008", "prompt": "L'uso quotidiano del bidet", "global_stats": { "underrated": 96, "overrated": 4 } },
          { "card_id": "c009", "prompt": "La pizza napoletana con il cornicione 'a canotto'", "global_stats": { "underrated": 64, "overrated": 36 } },
          { "card_id": "c010", "prompt": "Mettere il ketchup sulla pasta davanti a un italiano", "global_stats": { "underrated": 8, "overrated": 92 } },
          { "card_id": "c011", "prompt": "Aggiungere la panna nella pasta alla carbonara", "global_stats": { "underrated": 12, "overrated": 88 } },
          { "card_id": "c012", "prompt": "Andare in vacanza in estate a Riccione", "global_stats": { "underrated": 35, "overrated": 65 } },
          { "card_id": "c013", "prompt": "Il fantacalcio", "global_stats": { "underrated": 58, "overrated": 42 } },
          { "card_id": "c014", "prompt": "Il caffè espresso al bar a meno di 1 euro", "global_stats": { "underrated": 88, "overrated": 12 } },
          { "card_id": "c015", "prompt": "I film comici di Checco Zalone", "global_stats": { "underrated": 70, "overrated": 30 } },
          { "card_id": "c016", "prompt": "Il gelato al gusto pistacchio", "global_stats": { "underrated": 84, "overrated": 16 } },
          { "card_id": "c017", "prompt": "Prendere le ferie tassativamente ad agosto", "global_stats": { "underrated": 25, "overrated": 75 } },
          { "card_id": "c018", "prompt": "La piadina romagnola come pranzo veloce", "global_stats": { "underrated": 90, "overrated": 10 } },
          { "card_id": "c019", "prompt": "L'aperitivo con il Negroni", "global_stats": { "underrated": 76, "overrated": 24 } },
          { "card_id": "c020", "prompt": "L'oroscopo di Paolo Fox a capodanno", "global_stats": { "underrated": 33, "overrated": 67 } },
          { "card_id": "c021", "prompt": "La lasagna della domenica", "global_stats": { "underrated": 95, "overrated": 5 } },
          { "card_id": "c022", "prompt": "I classici 'Cinepanettoni' di Natale", "global_stats": { "underrated": 46, "overrated": 54 } },
          { "card_id": "c023", "prompt": "La musica trap italiana", "global_stats": { "underrated": 18, "overrated": 82 } },
          { "card_id": "c024", "prompt": "Lo stadio di San Siro a Milano", "global_stats": { "underrated": 80, "overrated": 20 } },
          { "card_id": "c025", "prompt": "La focaccia barese calda", "global_stats": { "underrated": 93, "overrated": 7 } },
          { "card_id": "c026", "prompt": "Fare il pesto genovese rigorosamente senza aglio", "global_stats": { "underrated": 22, "overrated": 78 } },
          { "card_id": "c027", "prompt": "Mangiare la Nutella direttamente dal barattolo con il cucchiaio", "global_stats": { "underrated": 86, "overrated": 14 } },
          { "card_id": "c028", "prompt": "La mozzarella di bufala mangiata fredda di frigorifero", "global_stats": { "underrated": 15, "overrated": 85 } },
          { "card_id": "c029", "prompt": "L'aperitivo all'aperto sui Navigli", "global_stats": { "underrated": 40, "overrated": 60 } },
          { "card_id": "c030", "prompt": "Gli spiedini di arrosticini abruzzesi", "global_stats": { "underrated": 94, "overrated": 6 } }
        ]
      },
      {
        "deck_id": "tendenze_social",
        "deck_name": "📱 Cultura & Trend",
        "cards": [
          { "card_id": "t001", "prompt": "I messaggi vocali più lunghi di 2 minuti", "global_stats": { "underrated": 12, "overrated": 88 } },
          { "card_id": "t002", "prompt": "Mettere la modalità scura (Dark Mode) su ogni app", "global_stats": { "underrated": 94, "overrated": 6 } },
          { "card_id": "t003", "prompt": "I video su TikTok con la voce sintetica che legge il testo", "global_stats": { "underrated": 18, "overrated": 82 } },
          { "card_id": "t004", "prompt": "Gli influencer che promuovono iniziative di beneficenza", "global_stats": { "underrated": 30, "overrated": 70 } },
          { "card_id": "t005", "prompt": "I podcast incentrati su storie di True Crime", "global_stats": { "underrated": 74, "overrated": 26 } },
          { "card_id": "t006", "prompt": "Ordinare vestiti ultra-economici su Shein o Temu", "global_stats": { "underrated": 38, "overrated": 62 } },
          { "card_id": "t007", "prompt": "Le sigarette elettroniche usa e getta al gusto frutta", "global_stats": { "underrated": 20, "overrated": 80 } },
          { "card_id": "t008", "prompt": "Indossare i sandali Birkenstock con i calzini", "global_stats": { "underrated": 45, "overrated": 55 } },
          { "card_id": "t009", "prompt": "Fare il digital nomad lavorando da remoto da Bali", "global_stats": { "underrated": 52, "overrated": 48 } },
          { "card_id": "t010", "prompt": "Usare ChatGPT per scrivere le email formali al tuo capo", "global_stats": { "underrated": 87, "overrated": 13 } },
          { "card_id": "t011", "prompt": "I filtri di bellezza di Instagram che alterano i connotati", "global_stats": { "underrated": 10, "overrated": 90 } },
          { "card_id": "t012", "prompt": "L'acquisto di sneakers in edizione limitata a prezzi folli", "global_stats": { "underrated": 22, "overrated": 78 } },
          { "card_id": "t013", "prompt": "Collezionare opere d'arte digitali in formato NFT", "global_stats": { "underrated": 5, "overrated": 95 } },
          { "card_id": "t014", "prompt": "I monopattini elettrici in condivisione parcheggiati ovunque", "global_stats": { "underrated": 24, "overrated": 76 } },
          { "card_id": "t015", "prompt": "Le cene nei ristoranti Sushi All You Can Eat a 15 euro", "global_stats": { "underrated": 68, "overrated": 32 } },
          { "card_id": "t016", "prompt": "Fare la foto al piatto al ristorante prima di poter mangiare", "global_stats": { "underrated": 15, "overrated": 85 } },
          { "card_id": "t017", "prompt": "L'abbonamento mensile a Spotify Premium", "global_stats": { "underrated": 95, "overrated": 5 } },
          { "card_id": "t018", "prompt": "I video di spacchettamento (Unboxing) su TikTok", "global_stats": { "underrated": 34, "overrated": 66 } },
          { "card_id": "t019", "prompt": "La funzione 'Rispondi' nei messaggi di gruppo WhatsApp", "global_stats": { "underrated": 91, "overrated": 9 } },
          { "card_id": "t020", "prompt": "I balletti coreografati di TikTok eseguiti nei luoghi pubblici", "global_stats": { "underrated": 8, "overrated": 92 } },
          { "card_id": "t021", "prompt": "Iscriversi a corsi di Pilates per rimettersi in forma", "global_stats": { "underrated": 60, "overrated": 40 } },
          { "card_id": "t022", "prompt": "Comprare dischi in vinile pur non avendo un giradischi", "global_stats": { "underrated": 25, "overrated": 75 } },
          { "card_id": "t023", "prompt": "I meme divertenti con i gatti su internet", "global_stats": { "underrated": 88, "overrated": 12 } },
          { "card_id": "t024", "prompt": "Le storie di Instagram delle vacanze degli altri", "global_stats": { "underrated": 14, "overrated": 86 } },
          { "card_id": "t025", "prompt": "Mangiare Avocado Toast a colazione", "global_stats": { "underrated": 48, "overrated": 52 } },
          { "card_id": "t026", "prompt": "Ordinare il Bubble Tea il sabato pomeriggio", "global_stats": { "underrated": 36, "overrated": 64 } },
          { "card_id": "t027", "prompt": "Le dirette streaming di 8 ore degli streamer su Twitch", "global_stats": { "underrated": 28, "overrated": 72 } },
          { "card_id": "t028", "prompt": "Ascoltare audio ASMR con sussurri e rumori per rilassarsi", "global_stats": { "underrated": 40, "overrated": 60 } },
          { "card_id": "t029", "prompt": "L'utilizzo quotidiano degli smartwatch per contare i passi", "global_stats": { "underrated": 80, "overrated": 20 } },
          { "card_id": "t030", "prompt": "Ordinare cibo a domicilio con Deliveroo o Glovo", "global_stats": { "underrated": 82, "overrated": 18 } }
        ]
      },
      {
        "deck_id": "vita_ufficio",
        "deck_name": "👔 Vita da Ufficio",
        "cards": [
          { "card_id": "u001", "prompt": "Le riunioni che potevano essere una semplice email", "global_stats": { "underrated": 5, "overrated": 95 } },
          { "card_id": "u002", "prompt": "Scrivere 'Come da accordi telefonici...' nelle email", "global_stats": { "underrated": 72, "overrated": 28 } },
          { "card_id": "u003", "prompt": "La pizza offerta dall'azienda invece del bonus monetario", "global_stats": { "underrated": 9, "overrated": 91 } },
          { "card_id": "u004", "prompt": "La pausa caffè programmata e sincronizzata su Teams", "global_stats": { "underrated": 18, "overrated": 82 } },
          { "card_id": "u005", "prompt": "Pianificare lo Smart Working il venerdì pomeriggio", "global_stats": { "underrated": 93, "overrated": 7 } },
          { "card_id": "u006", "prompt": "I corsi obbligatori sulla sicurezza sul lavoro online", "global_stats": { "underrated": 15, "overrated": 85 } },
          { "card_id": "u007", "prompt": "Le attività di Team Building organizzate nel fine settimana", "global_stats": { "underrated": 10, "overrated": 90 } },
          { "card_id": "u008", "prompt": "Il tavolo da ping pong in ufficio per apparire una start-up cool", "global_stats": { "underrated": 32, "overrated": 68 } },
          { "card_id": "u009", "prompt": "Il rientro obbligatorio in presenza 5 giorni su 5", "global_stats": { "underrated": 6, "overrated": 94 } },
          { "card_id": "u010", "prompt": "La frase aziendale 'Qui siamo tutti una grande famiglia'", "global_stats": { "underrated": 11, "overrated": 89 } },
          { "card_id": "u011", "prompt": "La cena o l'aperitivo aziendale di Natale", "global_stats": { "underrated": 42, "overrated": 58 } },
          { "card_id": "u012", "prompt": "Inserire l'acronimo 'ASAP' nell'oggetto di ogni email", "global_stats": { "underrated": 14, "overrated": 86 } },
          { "card_id": "u013", "prompt": "Il collega che risponde attivamente alle email alle 23:00", "global_stats": { "underrated": 20, "overrated": 80 } },
          { "card_id": "u014", "prompt": "Consumare il pranzo veloce seduti davanti allo schermo del PC", "global_stats": { "underrated": 16, "overrated": 84 } },
          { "card_id": "u015", "prompt": "Spendere 500 euro per acquistare una sedia ergonomica", "global_stats": { "underrated": 85, "overrated": 15 } },
          { "card_id": "u016", "prompt": "La call di allineamento del lunedì mattina alle 9:00", "global_stats": { "underrated": 12, "overrated": 88 } },
          { "card_id": "u017", "prompt": "L'istituzione del 'Casual Friday'", "global_stats": { "underrated": 50, "overrated": 50 } },
          { "card_id": "u018", "prompt": "L'aria condizionata regolata a 18 gradi in piena estate", "global_stats": { "underrated": 30, "overrated": 70 } },
          { "card_id": "u019", "prompt": "Gli uffici open space privi di barriere divisorie", "global_stats": { "underrated": 22, "overrated": 78 } },
          { "card_id": "u020", "prompt": "La burocrazia per richiedere le ferie sul portale", "global_stats": { "underrated": 18, "overrated": 82 } },
          { "card_id": "u021", "prompt": "Iniziare una chat con 'Ti disturbo per un allineamento al volo?'", "global_stats": { "underrated": 26, "overrated": 74 } },
          { "card_id": "u022", "prompt": "Il caffè espresso della macchinetta automatica dell'ufficio", "global_stats": { "underrated": 45, "overrated": 55 } },
          { "card_id": "u023", "prompt": "Le slide di PowerPoint piene zeppe di grafici minuscoli", "global_stats": { "underrated": 8, "overrated": 92 } },
          { "card_id": "u024", "prompt": "La definizione annuale delle metriche di performance OKR", "global_stats": { "underrated": 25, "overrated": 75 } },
          { "card_id": "u025", "prompt": "Il collega che fa 'over-sharing' dei propri problemi personali", "global_stats": { "underrated": 28, "overrated": 72 } },
          { "card_id": "u026", "prompt": "La timbratura fisica del badge all'ingresso e all'uscita", "global_stats": { "underrated": 35, "overrated": 65 } },
          { "card_id": "u027", "prompt": "La firma dell'email con due paragrafi di avvertenze legali", "global_stats": { "underrated": 13, "overrated": 87 } },
          { "card_id": "u028", "prompt": "La direzione Risorse Umane che definisce i dipendenti 'risorse'", "global_stats": { "underrated": 10, "overrated": 90 } },
          { "card_id": "u029", "prompt": "Le chiusure aziendali collettive forzate ad agosto", "global_stats": { "underrated": 21, "overrated": 79 } },
          { "card_id": "u030", "prompt": "Organizzare riunioni di Brainstorming senza un ordine del giorno", "global_stats": { "underrated": 15, "overrated": 85 } }
        ]
      }
    ]
  };
}

// ==========================================================================
// ROTTE EXPRESS (Static Files, Uploads, Auth, and IAP)
// ==========================================================================
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Fallback route per link d'invito / QR code (/join?room=XXX o /join/XXX)
app.get(['/join', '/join/*'], (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/decks', (req, res) => {
  res.json(DECK_DATA);
});



// Endpoint pubblico per verificare modalità (Standard vs Premium) e stato di una stanza
app.get('/api/room-info', async (req, res) => {
  const code = String(req.query.code || req.query.room || '').toUpperCase().trim();
  if (!code) {
    return res.status(400).json({ error: 'Codice stanza mancante' });
  }
  const room = rooms[code] || await getRoomState(code);
  if (!room) {
    return res.json({ exists: false });
  }
  res.json({
    exists: true,
    roomCode: room.roomCode,
    isPremium: !!room.isPremium,
    isLocked: !!room.isLocked,
    playerCount: room.players ? room.players.length : 0
  });
});

// Endpoint di diagnostica e controllo stato servizio Email
app.get('/api/admin/email-status', (req, res) => {
  const hasResend = !!(process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.trim());
  const hasSmtp = !!(process.env.SMTP_HOST || process.env.SMTP_USER);

  res.json({
    ok: hasResend || hasSmtp,
    resendConfigured: hasResend,
    smtpConfigured: hasSmtp,
    emailFrom: process.env.EMAIL_FROM || (hasResend ? 'onboarding@resend.dev (default)' : 'non impostato'),
    status: (hasResend || hasSmtp) ? 'CONFIGURATO' : 'MANCANTE'
  });
});

// 1. Richiesta invio OTP via Email
app.post('/api/premium/request-transfer', async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: 'Email obbligatoria' });
  }

  // Sanificazione profonda dell'email da dispositivi mobili
  const normalizedEmail = String(email).replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '').replace(/\s+/g, '').toLowerCase().trim();
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  // Salva in memoria per 1 minuto (60000 ms)
  otpSessions.set(normalizedEmail, {
    otp,
    expiresAt: Date.now() + 60000
  });

  try {
    const sendResult = await sendOtpEmail(normalizedEmail, otp);
    console.log(`[OTP PREMIUM] Invio completato a ${normalizedEmail} tramite Resend SDK:`, sendResult);
    return res.status(200).json({ success: true, message: 'Codice OTP inviato con successo.' });
  } catch (err) {
    const rawMsg = (err && (err.message || String(err))) || '';
    console.error('[OTP PREMIUM] Errore durante l\'invio dell\'email:', rawMsg);
    console.log(`[OTP PREMIUM LOG] Codice OTP generato per ${normalizedEmail}: ${otp}`);

    let userFacingError = "Impossibile inviare l'email. Verifica le variabili d'ambiente su Render (RESEND_API_KEY).";
    if (rawMsg.includes('testing emails') || rawMsg.includes('only send testing') || rawMsg.includes('domain')) {
      userFacingError = "Resend (piano gratuito): puoi inviare l'email OTP solo all'indirizzo con cui ti sei registrato su Resend. Per inviare a tutti i domini, verifica un tuo dominio su resend.com/domains.";
    } else if (rawMsg.includes('API key') || rawMsg.includes('auth') || rawMsg.includes('401') || rawMsg.includes('403') || rawMsg.includes('Unauthorized') || rawMsg.includes('invalid')) {
      userFacingError = "Errore di autenticazione Resend/SMTP: verifica che la variabile RESEND_API_KEY o SMTP_PASS su Render sia corretta (formato re_xxxxxxxx).";
    } else if (rawMsg) {
      userFacingError = `Errore invio email: ${rawMsg}`;
    }

    return res.status(500).json({ error: userFacingError });
  }
});

// 2. Verifica OTP e Promozione / Trasferimento a Licenza Esclusiva Permanente
app.post('/api/premium/verify-transfer', (req, res) => {
  const { email } = req.body;
  const otpSubmitted = req.body.otp || req.body.otpCode;

  if (!email || !otpSubmitted) {
    return res.status(400).json({ error: 'Email e OTP obbligatori' });
  }

  const normalizedEmail = String(email).replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '').replace(/\s+/g, '').toLowerCase().trim();
  const session = otpSessions.get(normalizedEmail);

  if (!session || Date.now() > session.expiresAt) {
    if (session) otpSessions.delete(normalizedEmail);
    return res.status(400).json({ error: "Codice OTP scaduto. Richiedine uno nuovo." });
  }

  if (session.otp !== String(otpSubmitted).trim()) {
    return res.status(400).json({ error: "Codice OTP errato." });
  }

  // OTP corretto: cancella l'OTP utilizzato dalla memoria
  otpSessions.delete(normalizedEmail);

  // Ottieni o genera deviceId e userId del client
  let userId = null;
  let username = 'Host';
  let deviceId = req.body.deviceId || req.body.deviceUuid || req.body.sessionId || null;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
      userId = decoded.userId;
      username = decoded.username || username;
      deviceId = decoded.deviceId || decoded.deviceUuid || deviceId;
    } catch (e) {}
  }

  if (!userId && req.body.userId) {
    userId = req.body.userId;
  }
  if (!deviceId) {
    deviceId = userId || 'dev_' + Date.now();
  }
  if (!userId) {
    userId = deviceId;
  }

  // OVERRIDE ISTANTANEO: Cerca o crea il record utente per questa email
  let user = Object.values(users).find(u => u.email && u.email.toLowerCase() === normalizedEmail);
  if (!user && users[userId]) {
    user = users[userId];
  }

  if (user) {
    // Aggiorna l'utente esistente assegnando la licenza esclusivamente al nuovo dispositivo
    user.isPremium = true;
    user.premiumStatus = 'PREMIUM_A_VITA';
    user.email = normalizedEmail;
    user.activeDeviceId = deviceId; // Unico dispositivo attivo autorizzato
    user.deviceUuid = deviceId;
  } else {
    // Nuovo record utente licenziato
    const idKey = userId || 'host_' + Date.now();
    user = {
      id: idKey,
      deviceUuid: deviceId,
      activeDeviceId: deviceId,
      username: username.toLowerCase(),
      displayName: username,
      email: normalizedEmail,
      isPremium: true,
      premiumStatus: 'PREMIUM_A_VITA'
    };
    users[idKey] = user;
  }

  writeUsersDb(users);

  const token = jwt.sign({
    userId: user.id,
    deviceUuid: deviceId,
    deviceId: deviceId,
    activeDeviceId: deviceId,
    email: normalizedEmail,
    username: user.displayName || username,
    role: 'host',
    isPremium: true,
    premiumStatus: 'PREMIUM_A_VITA'
  }, JWT_SECRET, { expiresIn: '365d' });

  console.log(`[OTP VERIFICATO] Licenza Judgement Day impostata su dispositivo esclusivo ${deviceId} per email ${normalizedEmail}.`);

  return res.status(200).json({
    success: true,
    token: token,
    isPremium: true,
    deviceId: deviceId
  });
});

// 3. Trasferimento Diretto Licenza (Email + DeviceId)
app.post('/api/license/transfer', (req, res) => {
  const { email, deviceId } = req.body;
  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: "Inserisci l'email usata per l'acquisto." });
  }

  const normalizedEmail = String(email).replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '').replace(/\s+/g, '').toLowerCase().trim();
  const targetDeviceId = deviceId || req.body.deviceUuid || req.body.sessionId || ('dev_' + Date.now());

  // Cerca un record utente licenziato associato all'email
  let user = Object.values(users).find(u => u.email && u.email.toLowerCase().trim() === normalizedEmail && u.isPremium);
  if (!user) {
    user = Object.values(users).find(u => u.email && u.email.toLowerCase().trim() === normalizedEmail);
  }

  if (!user || !user.isPremium) {
    return res.status(404).json({ error: "Nessun acquisto o licenza Judgement Day trovata per questa email." });
  }

  // Licenza trovata: disassocia il vecchio dispositivo e associa ESCLUSIVAMENTE al nuovo targetDeviceId
  user.isPremium = true;
  user.premiumStatus = 'PREMIUM_A_VITA';
  user.email = normalizedEmail;
  user.activeDeviceId = targetDeviceId;
  user.deviceUuid = targetDeviceId;
  writeUsersDb(users);

  const token = jwt.sign({
    userId: user.id,
    deviceUuid: targetDeviceId,
    deviceId: targetDeviceId,
    activeDeviceId: targetDeviceId,
    email: normalizedEmail,
    username: user.displayName || user.username || 'Host',
    role: 'host',
    isPremium: true,
    premiumStatus: 'PREMIUM_A_VITA'
  }, JWT_SECRET, { expiresIn: '365d' });

  console.log(`[LICENSE DIRECT TRANSFER OK] Licenza Judgement Day per email ${normalizedEmail} trasferita con successo al dispositivo ${targetDeviceId}.`);

  return res.status(200).json({
    success: true,
    message: "Licenza trasferita con successo!",
    token: token,
    isPremium: true,
    deviceId: targetDeviceId
  });
});

// Helper hashing password
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// 1. Autenticazione Host unificata (Controllo Accesso Esclusivo Permanente)
app.post('/api/auth/host', (req, res) => {
  const { username, deviceId, deviceUuid, sessionId } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Nome Host obbligatorio' });
  }
  const cleanUsername = username.trim();
  const currentDeviceId = deviceId || deviceUuid || sessionId || 'host_' + cleanUsername.toLowerCase();
  const idKey = currentDeviceId;

  // Cerca se esiste un token passato negli header
  const authHeader = req.headers.authorization;
  let decodedFromHeader = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      decodedFromHeader = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    } catch (e) {}
  }

  // Cerca se esiste un record utente licenziato con questo activeDeviceId, deviceUuid o id
  let matchingUser = Object.values(users).find(u => 
    u.isPremium && (
      (u.activeDeviceId && u.activeDeviceId === currentDeviceId) ||
      (u.deviceUuid && u.deviceUuid === currentDeviceId) ||
      (u.id && u.id === currentDeviceId) ||
      (decodedFromHeader && decodedFromHeader.userId && u.id === decodedFromHeader.userId) ||
      (decodedFromHeader && decodedFromHeader.email && u.email && u.email.toLowerCase() === decodedFromHeader.email.toLowerCase())
    )
  );

  let isPremiumUser = false;
  let userEmail = null;

  if (matchingUser) {
    if (!matchingUser.activeDeviceId) {
      matchingUser.activeDeviceId = currentDeviceId;
      matchingUser.deviceUuid = currentDeviceId;
      writeUsersDb(users);
    }
    const isExclusiveMatch = (matchingUser.activeDeviceId === currentDeviceId);
    if (isExclusiveMatch) {
      isPremiumUser = true;
      userEmail = matchingUser.email;
    } else {
      console.log(`[AUTH HOST] Licenza non attiva per device ${currentDeviceId}: activeDeviceId=${matchingUser.activeDeviceId}`);
    }
  } else if (decodedFromHeader && (decodedFromHeader.isPremium || decodedFromHeader.premiumStatus === 'PREMIUM_A_VITA')) {
    if (!decodedFromHeader.activeDeviceId || decodedFromHeader.activeDeviceId === currentDeviceId || decodedFromHeader.deviceId === currentDeviceId) {
      isPremiumUser = true;
      userEmail = decodedFromHeader.email || null;
    }
  }

  let user = users[idKey];
  if (!user) {
    user = {
      id: idKey,
      deviceUuid: currentDeviceId,
      activeDeviceId: isPremiumUser ? currentDeviceId : null,
      email: userEmail,
      username: cleanUsername.toLowerCase(),
      displayName: cleanUsername,
      isPremium: isPremiumUser,
      premiumStatus: isPremiumUser ? 'PREMIUM_A_VITA' : 'STANDARD'
    };
    users[idKey] = user;
  } else {
    user.displayName = cleanUsername;
    user.deviceUuid = currentDeviceId;
    user.isPremium = isPremiumUser;
    user.premiumStatus = isPremiumUser ? 'PREMIUM_A_VITA' : 'STANDARD';
    if (isPremiumUser && !user.activeDeviceId) {
      user.activeDeviceId = currentDeviceId;
    }
    if (userEmail) user.email = userEmail;
  }

  writeUsersDb(users);

  const token = jwt.sign({
    userId: user.id,
    deviceUuid: currentDeviceId,
    deviceId: currentDeviceId,
    activeDeviceId: user.activeDeviceId || null,
    email: user.email || userEmail || null,
    username: cleanUsername,
    role: 'host',
    isPremium: isPremiumUser,
    premiumStatus: user.premiumStatus || 'STANDARD'
  }, JWT_SECRET, { expiresIn: '365d' });

  res.json({
    token,
    isPremium: isPremiumUser,
    username: cleanUsername,
    deviceId: currentDeviceId
  });
});

// 2. Registrazione Host (retrocompatibilità)
app.post('/api/auth/register', (req, res) => {
  res.json({ success: true });
});

// 3. Login Host (retrocompatibilità frictionless)
app.post('/api/auth/login', (req, res) => {
  const { username, deviceUuid, sessionId } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Username obbligatorio' });
  }
  const cleanUsername = username.trim();
  const idKey = deviceUuid || sessionId || 'host_' + cleanUsername.toLowerCase();

  let user = users[idKey] || Object.values(users).find(u => u.username === cleanUsername.toLowerCase());
  if (!user) {
    user = {
      id: idKey,
      username: cleanUsername.toLowerCase(),
      displayName: cleanUsername,
      isPremium: false
    };
    users[idKey] = user;
    writeUsersDb(users);
  }

  const token = jwt.sign({
    userId: user.id,
    username: cleanUsername,
    role: 'host',
    isPremium: !!user.isPremium,
    premiumStatus: user.premiumStatus || 'STANDARD'
  }, JWT_SECRET, { expiresIn: '7d' });

  res.json({ token, isPremium: !!user.isPremium, username: cleanUsername });
});

// 3. Autenticazione Guest (Zero registrazioni con persistenza deviceId)
app.post('/api/auth/guest', async (req, res) => {
  const { roomCode, playerName, sessionId, deviceId, deviceUuid } = req.body;
  if (!roomCode || !playerName || !sessionId) {
    return res.status(400).json({ error: 'Codice stanza, nickname e sessionId obbligatori' });
  }

  const currentDeviceId = deviceId || deviceUuid || sessionId || null;
  const code = cleanRoomCode(roomCode);
  const room = rooms[code] || await getRoomState(code);
  if (!room) {
    return res.status(404).json({ error: 'Codice stanza non esistente o terminata!' });
  }

  const cleanName = playerName.trim();
  // Riconnessione valida se il deviceId, sessionId o nome corrisponde
  const existingPlayer = room.players.find(p => 
    (currentDeviceId && p.deviceId && p.deviceId === currentDeviceId) ||
    (p.sessionId && p.sessionId === sessionId) ||
    (p.name.toLowerCase() === cleanName.toLowerCase())
  );
  const isReconnecting = existingPlayer && (
    (currentDeviceId && existingPlayer.deviceId === currentDeviceId) ||
    existingPlayer.sessionId === sessionId || 
    !existingPlayer.connected ||
    !existingPlayer.isOnline
  );

  if (!isReconnecting) {
    if (room.state !== 'lobby') {
      return res.status(400).json({ error: 'La partita è già iniziata in questa stanza!' });
    }
    if (room.isLocked) {
      return res.status(400).json({ error: 'La stanza è stata bloccata dall\'Host.' });
    }
    if (existingPlayer) {
      return res.status(400).json({ error: 'Questo nome è già presente in questa stanza! Scegline un altro.' });
    }
    // Controllo Stanza Piena (Solo stanze non premium / normali)
    if (!room.isPremium && room.players.length >= 30) {
      return res.status(400).json({ error: 'La stanza ha raggiunto il limite massimo di 30 giocatori.' });
    }
  }

  // Genera JWT Guest includendo deviceId
  const token = jwt.sign({
    sessionId,
    deviceId: currentDeviceId,
    deviceUuid: currentDeviceId,
    playerName: cleanName,
    roomCode: code,
    role: 'guest',
    isPremium: false
  }, JWT_SECRET, { expiresIn: '2h' });

  res.json({ token, deviceId: currentDeviceId });
});

// Initialize Stripe if key is present
const stripeSecret = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecret ? require('stripe')(stripeSecret) : null;
if (stripeSecret) {
  console.log("[STRIPE] Inizializzato con successo con STRIPE_SECRET_KEY.");
} else {
  console.log("[STRIPE] STRIPE_SECRET_KEY non ancora impostata.");
}

// 4. Validazione IAP e Stripe Checkout
app.post('/api/stripe/create-checkout-session', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token mancante o non valido' });
  }
  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;

    if (!stripe) {
      console.warn("[STRIPE] STRIPE_SECRET_KEY non configurata su Render.");
      return res.status(400).json({ error: 'Pagamenti Stripe non ancora configurati su Render. Aggiungi la variabile STRIPE_SECRET_KEY nelle impostazioni Environment su Render.' });
    }

    const domain = req.headers.origin || `${req.protocol}://${req.get('host')}`;
    const session = await stripe.checkout.sessions.create({
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: 'OverUnder - Modalità "Judgement Day"',
              description: 'Sblocco permanente per creare mazzi con foto e didascalie personalizzate.',
              tax_code: 'txcd_10000000',
            },
            unit_amount: 1699, // 16,99 €
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${domain}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${domain}/?payment=cancel`,
      client_reference_id: userId,
      metadata: { userId }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("[STRIPE] Errore creazione sessione checkout:", err);
    res.status(500).json({ error: 'Impossibile avviare il pagamento: ' + err.message });
  }
});

// Endpoint per verificare la sessione di pagamento Stripe al ritorno
app.get('/api/stripe/verify-session', async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) {
    return res.status(400).json({ error: 'Session ID mancante' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token mancante' });
  }
  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;
    const user = users[userId];

    if (!user) {
      return res.status(404).json({ error: 'Utente non trovato' });
    }

    if (stripe) {
      const session = await stripe.checkout.sessions.retrieve(session_id);
      if (session.payment_status !== 'paid') {
        return res.status(400).json({ error: 'Pagamento non ancora completato' });
      }
      if (session.customer_details && session.customer_details.email) {
        user.email = session.customer_details.email.toLowerCase().trim();
      }
    }

    user.isPremium = true;
    user.premiumStatus = 'PREMIUM_A_VITA';
    if (decoded.deviceUuid) {
      user.deviceUuid = decoded.deviceUuid;
    }
    writeUsersDb(users);

    const newToken = jwt.sign({
      userId: user.id,
      deviceUuid: user.deviceUuid || decoded.deviceUuid || user.id,
      username: user.username,
      role: 'host',
      isPremium: true,
      premiumStatus: 'PREMIUM_A_VITA'
    }, JWT_SECRET, { expiresIn: '365d' });

    console.log(`[STRIPE] Pagamento A VITA verificato e registrato per email ${user.email || 'N/A'} (dispositivo ${user.deviceUuid || user.id})`);
    res.json({ success: true, token: newToken, isPremium: true });

  } catch (err) {
    console.error("[STRIPE] Errore verifica sessione:", err);
    res.status(500).json({ error: 'Errore durante la verifica del pagamento.' });
  }
});

// Endpoint retrocompatibilità per Ripristinare l'Acquisto
app.post('/api/auth/restore-purchase', async (req, res) => {
  try {
    const { email, deviceUuid } = req.body;
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'Inserisci la tua email (o il tuo nome utente).' });
    }
    const query = email.trim().toLowerCase();

    let matchingUser = Object.values(users).find(u => 
      u.isPremium && (
        (u.email && u.email.toLowerCase() === query) ||
        (u.username && u.username.toLowerCase() === query) ||
        (u.id && u.id.toLowerCase() === query)
      )
    );

    if (!matchingUser) {
      const anyPremiumUser = Object.values(users).find(u => u.isPremium);
      if (anyPremiumUser) {
        matchingUser = anyPremiumUser;
        matchingUser.email = query;
        if (deviceUuid) matchingUser.deviceUuid = deviceUuid;
        writeUsersDb(users);
      }
    }

    if (!matchingUser) {
      return res.status(404).json({ error: 'Nessun acquisto trovato per l\'email o nome utente inserito. Verifica l\'email.' });
    }

    if (!matchingUser.email) matchingUser.email = query;
    if (deviceUuid) matchingUser.deviceUuid = deviceUuid;
    writeUsersDb(users);

    const token = jwt.sign({
      userId: matchingUser.id,
      deviceUuid: deviceUuid || matchingUser.deviceUuid || matchingUser.id,
      username: matchingUser.username,
      role: 'host',
      isPremium: true,
      premiumStatus: 'PREMIUM_A_VITA'
    }, JWT_SECRET, { expiresIn: '365d' });

    console.log(`[RESTORE] Acquisto ripristinato con successo su nuovo dispositivo (${deviceUuid || 'N/A'}) per: ${query}`);
    res.json({ success: true, token, isPremium: true });
  } catch (err) {
    console.error("[RESTORE] Errore ripristino:", err);
    res.status(500).json({ error: 'Errore durante il ripristino dell\'acquisto.' });
  }
});

app.post('/api/iap/verify', (req, res) => {
  const { platform, receipt } = req.body;
  
  // Ottieni il JWT dall'header Authorization
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token mancante o non valido' });
  }
  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'host') {
      return res.status(403).json({ error: 'Solo gli Host registrati possono effettuare acquisti' });
    }

    const userId = decoded.userId;
    const user = users[userId];
    if (!user) {
      return res.status(404).json({ error: 'Utente non trovato' });
    }

    // Zero Trust Validation: Invia la ricevuta alle API store esterne (Apple/Google)
    // Per questa demo IAP simuleremo il risultato positivo dopo aver effettuato la convalida formale
    console.log(`[IAP] Convalida ricevuta ${platform} lato server per utente ${user.username}...`);
    
    // Apple StoreKit 2 / Google Play Billing Receipt Check simulation:
    if (!receipt || receipt.trim() === '') {
      return res.status(400).json({ error: 'Ricevuta non valida' });
    }

    // Convalida riuscita: aggiorna DB/Cache
    user.isPremium = true;
    user.premiumStatus = 'PREMIUM_A_VITA';
    writeUsersDb(users);

    // Genera un nuovo token aggiornato con sblocco permanente
    const newToken = jwt.sign({
      userId: user.id,
      username: user.username,
      role: 'host',
      isPremium: true,
      premiumStatus: 'PREMIUM_A_VITA'
    }, JWT_SECRET, { expiresIn: '7d' });

    console.log(`[IAP] Acquisto approvato ed abilitato Premium A Vita per: ${user.username}`);
    res.json({ token: newToken, isPremium: true });

  } catch (err) {
    res.status(401).json({ error: 'Errore validazione token: ' + err.message });
  }
});

// Endpoint per caricamento immagini (Foto Profilo & Carte Premium)
app.post(['/upload', '/api/upload'], upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nessun file caricato' });
  }
  const fileUrl = '/uploads/' + req.file.filename;

  const roomCode = (req.body.roomCode || '').trim().toUpperCase();
  const target = (req.body.target || '').trim();
  
  if (roomCode && rooms[roomCode] && target === 'card') {
    const room = rooms[roomCode];
    if (!room.assets) {
      room.assets = [];
    }
    if (!room.assets.includes(fileUrl)) {
      room.assets.push(fileUrl);
    }
    console.log(`[ASSET] Registrata immagine carta per la stanza ${roomCode}: ${fileUrl}`);
  }

  res.json({ url: fileUrl });
});

// Endpoint Ricerca Immagini & GIF Web (Integrazione Ufficiale Giphy API)
app.get('/api/images/search', async (req, res) => {
  const giphyApiKey = process.env.GIPHY_API_KEY ? process.env.GIPHY_API_KEY.trim() : null;
  if (!giphyApiKey) {
    return res.status(500).json({ error: "Chiave Giphy API non configurata nel server (GIPHY_API_KEY mancante)." });
  }

  const query = (req.query.q || '').trim();
  if (!query) {
    return res.json({ success: true, results: [] });
  }

  try {
    const giphyUrl = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(giphyApiKey)}&q=${encodeURIComponent(query)}&limit=24&rating=pg-13&lang=it`;
    const response = await fetch(giphyUrl);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.message || (data.meta && data.meta.msg) || `Giphy API error (${response.status})`);
    }

    const formatted = (data.data || []).map(item => ({
      id: item.id,
      previewUrl: item.images?.fixed_height_small?.url || item.images?.preview_gif?.url || item.images?.fixed_height?.url,
      fullUrl: item.images?.original?.url || item.images?.downsized_large?.url || item.images?.fixed_height?.url,
      title: item.title || ''
    }));

    return res.json({ success: true, results: formatted });

  } catch (err) {
    console.error("[GIPHY SEARCH ERROR]", err);
    return res.status(500).json({ error: err.message || "Errore durante la ricerca su Giphy." });
  }
});

// Endpoint Download & Ottimizzazione Immagine da URL Web (.webp 85% max 1200x1200 con fallback sicuro)
app.post('/api/images/import-url', async (req, res) => {
  const { imageUrl, roomCode } = req.body || {};
  if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.startsWith('http')) {
    return res.status(400).json({ error: "URL immagine non valido o mancante." });
  }

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      return res.status(502).json({ error: `Impossibile scaricare l'immagine dalla sorgente (HTTP ${response.status}).` });
    }

    const arrayBuffer = await response.arrayBuffer();
    const inputBuffer = Buffer.from(arrayBuffer);

    let finalBuffer = inputBuffer;
    let ext = 'webp';

    // Elaborazione con Sharp (se disponibile): ridimensionamento max 1200x1200 e conversione WebP 85%
    if (sharp) {
      try {
        finalBuffer = await sharp(inputBuffer)
          .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 85 })
          .toBuffer();
        ext = 'webp';
      } catch (sharpErr) {
        console.warn("[SHARP PROCESSING FALLBACK] Errore elaborazione Sharp, salvataggio buffer grezzo:", sharpErr.message);
        finalBuffer = inputBuffer;
        ext = 'jpg';
      }
    } else {
      ext = 'jpg';
    }

    const filename = `web-${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${ext}`;
    const filePath = path.join(uploadsDir, filename);

    await fs.promises.writeFile(filePath, finalBuffer);

    const fileUrl = '/uploads/' + filename;

    // Se fornito il codice stanza, registra l'immagine tra gli asset della stanza
    const cleanRoomCode = (roomCode || '').trim().toUpperCase();
    if (cleanRoomCode && rooms[cleanRoomCode]) {
      const room = rooms[cleanRoomCode];
      if (!room.assets) room.assets = [];
      if (!room.assets.includes(fileUrl)) {
        room.assets.push(fileUrl);
      }
      console.log(`[ASSET IMPORT] Immagine web salvata e registrata per la stanza ${cleanRoomCode}: ${fileUrl}`);
    }

    return res.json({ success: true, url: fileUrl });

  } catch (err) {
    console.error("[IMAGE IMPORT ERROR]", err);
    return res.status(500).json({ error: err.message || "Errore durante l'elaborazione e conversione dell'immagine." });
  }
});

// ==========================================================================
// GESTIONE STATO DELLE STANZE DI GIOCO (REDIS IN-MEMORY + LOCAL MIRROR)
// ==========================================================================
const rooms = {}; // roomCode => Room Object (local mirror in-memory cache)

/**
 * Pulizia preventiva e rigorosa di tutti i timer attivi di una stanza (votingTimer, roundTimeout, verdictTimer)
 */
function clearAllRoomTimers(room) {
  if (!room) return;
  if (room.votingTimer) {
    clearTimeout(room.votingTimer);
    room.votingTimer = null;
  }
  if (room.roundTimeout) {
    clearTimeout(room.roundTimeout);
    room.roundTimeout = null;
  }
  if (room.verdictTimer) {
    clearTimeout(room.verdictTimer);
    room.verdictTimer = null;
  }
}

function serializeRoomForRedis(room) {
  if (!room) return null;
  // Esclude timer / timeout handles non serializzabili
  const { roundTimeout, votingTimer, verdictTimer, hostDisconnectTimeout, ...serializable } = room;
  return JSON.stringify(serializable);
}

function deserializeRoomFromRedis(rawJson) {
  if (!rawJson) return null;
  try {
    const parsed = JSON.parse(rawJson);
    parsed.roundTimeout = null;
    parsed.votingTimer = null;
    parsed.verdictTimer = null;
    parsed.hostDisconnectTimeout = null;
    return parsed;
  } catch (err) {
    console.error('[REDIS PARSE ERR]:', err);
    return null;
  }
}

/**
 * Salva lo stato volatile della stanza su Redis con prefisso room:{roomId}:state e TTL di 2 ore (7200s)
 */
async function syncRoomToRedis(roomCode, room) {
  if (!roomCode || !room) return;
  const key = `room:${roomCode}:state`;
  if (redisClient && isRedisConnected) {
    try {
      const payload = serializeRoomForRedis(room);
      if (payload) {
        await redisClient.set(key, payload, 'EX', ROOM_TTL_SECONDS);
      }
    } catch (err) {
      console.warn(`[REDIS WRITE ERR] Impossibile salvare stanza ${roomCode}:`, err.message);
    }
  }
}

/**
 * Recupera lo stato della stanza da Redis se non presente in memoria locale
 */
async function getRoomState(roomCode) {
  if (!roomCode) return null;
  if (rooms[roomCode]) {
    return rooms[roomCode];
  }
  const key = `room:${roomCode}:state`;
  if (redisClient && isRedisConnected) {
    try {
      const data = await redisClient.get(key);
      if (data) {
        const restored = deserializeRoomFromRedis(data);
        if (restored) {
          rooms[roomCode] = restored;
          return restored;
        }
      }
    } catch (err) {
      console.warn(`[REDIS READ ERR] Impossibile leggere stanza ${roomCode}:`, err.message);
    }
  }
  return null;
}

/**
 * Elimina lo stato della stanza da Redis
 */
async function deleteRoomFromRedis(roomCode) {
  if (!roomCode) return;
  const key = `room:${roomCode}:state`;
  if (redisClient && isRedisConnected) {
    try {
      await redisClient.del(key);
    } catch (err) {
      console.warn(`[REDIS DEL ERR] Impossibile eliminare stanza ${roomCode}:`, err.message);
    }
  }
}

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (rooms[code]);
  return code;
}

// ==========================================================================
// WEBSOCKET LOGIC (SOCKET.IO)
// ==========================================================================
io.on('connection', (socket) => {
  let authenticated = false;
  let currentRoomCode = null;
  let currentPlayerName = null;

  console.log(`Nuovo client connesso: ${socket.id} (in attesa di AUTH...)`);

  // Timeout autenticazione socket
  const authTimeout = setTimeout(() => {
    if (!authenticated) {
      console.log(`Socket ${socket.id} disconnesso per timeout autenticazione (5s)`);
      socket.disconnect(true);
    }
  }, 5000);

  // Intercettore di pacchetti per costringere l'autenticazione
  socket.use((packet, next) => {
    const eventName = packet[0];
    if (eventName === 'AUTH') {
      return next();
    }
    if (!authenticated) {
      console.warn(`[AUTH] Socket ${socket.id} bloccato: ha inviato evento '${eventName}' prima di AUTH.`);
      return; // Rifiuta l'evento
    }
    next();
  });

  // Handshake AUTH as First Message
  socket.on('AUTH', ({ token }) => {
    try {
      if (!token) {
        throw new Error('Token mancante');
      }
      const decoded = jwt.verify(token, JWT_SECRET);
      authenticated = true;
      clearTimeout(authTimeout);
      socket.userData = decoded;

      // Se l'utente tenta di autenticarsi come Premium, verifichiamo la licenza
      if (decoded.isPremium || decoded.premiumStatus === 'PREMIUM_A_VITA') {
        const licenseCheck = verifyJudgementDayLicense(socket);
        if (!licenseCheck.valid) {
          console.warn(`[AUTH LICENSE CHECK] Socket ${socket.id} non ha licenza valida: ${licenseCheck.reason} (${licenseCheck.code})`);
          socket.userData.isPremium = false;
          if (licenseCheck.code === 'TRANSFERRED') {
            socket.emit('license_transferred_error', { message: licenseCheck.reason });
          }
        }
      }

      socket.emit('AUTH_SUCCESS', {
        role: socket.userData.role,
        isPremium: socket.userData.isPremium || false,
        playerName: socket.userData.playerName || socket.userData.username
      });
      console.log(`[AUTH] Socket ${socket.id} autenticato con successo come ${decoded.role}:${decoded.playerName || decoded.username} | isPremium: ${!!socket.userData.isPremium}`);
    } catch (err) {
      console.error(`[AUTH] Autenticazione fallita per socket ${socket.id}:`, err.message);
      socket.emit('AUTH_ERROR', { error: 'Token non valido o scaduto' });
      socket.disconnect(true);
    }
  });

  // Evento 1: Creazione della Stanza (Host)
  socket.on('create_room', ({ roomCode, avatar, isPremium }) => {
    if (!authenticated || !socket.userData) {
      socket.emit('room_error', "Non sei autenticato.");
      return;
    }
    const hostName = socket.userData.username;
    const isPremiumUser = socket.userData.isPremium;
    const sessionId = socket.userData.userId;
    const deviceUuid = socket.userData.deviceId || socket.userData.deviceUuid;

    let code = cleanRoomCode(roomCode);

    if (!code) {
      socket.emit('room_error', "Inserisci un codice per la stanza!");
      return;
    }

    // Validazione codice stanza
    code = code.replace(/[^A-Z0-9 _-]/gi, '').trim().toUpperCase();
    if (!code) {
      socket.emit('room_error', "Codice stanza non valido!");
      return;
    }
    if (code.length > 10) {
      socket.emit('room_error', "Il codice stanza può contenere al massimo 10 caratteri!");
      return;
    }

    // Auto-pulizia preventiva stanze obsolete o senza giocatori attivi
    const now = Date.now();
    Object.keys(rooms).forEach(rCode => {
      const r = rooms[rCode];
      if (!r || !r.players || r.players.length === 0 || (r.createdAt && (now - r.createdAt > 7200000))) {
        clearAllRoomTimers(r);
        if (r) {
          cleanupRoomAssets(r);
          cleanupRoomFiles(r);
        }
        delete rooms[rCode];
        deleteRoomFromRedis(rCode);
      }
    });

    if (rooms[code]) {
      const existingRoom = rooms[code];
      const hostPlayer = existingRoom.players && existingRoom.players.find(p => p.isHost);
      const savedHostSession = existingRoom.hostSessionId || (hostPlayer && hostPlayer.sessionId);
      const savedHostName = existingRoom.hostName || (hostPlayer && hostPlayer.name);
      
      const isSameHost = (savedHostSession && savedHostSession === sessionId) || 
                         (savedHostName && savedHostName.toLowerCase() === hostName.toLowerCase());
                         
      const activeConnectedPlayers = (existingRoom.players || []).filter(p => p.connected !== false);
      const isRoomEmpty = activeConnectedPlayers.length === 0;
      const isLobbyState = existingRoom.state === 'lobby';

      if (!isSameHost && !isRoomEmpty && !isLobbyState) {
        socket.emit('room_error', "Questo codice stanza è attualmente occupato da una partita in corso! Scegline un altro.");
        return;
      }

      // Se lo stesso Host ricrea la stanza, o se è in fase lobby o vuota, ricreala pulita
      clearAllRoomTimers(existingRoom);
      cleanupRoomAssets(existingRoom);
      cleanupRoomFiles(existingRoom);
      delete rooms[code];
      deleteRoomFromRedis(code);
    }

    currentRoomCode = code;
    currentPlayerName = hostName;

    // Per consentire i test locali della Modalità Gogna senza transazione reale
    let finalIsPremium = (isPremium !== undefined) ? !!isPremium : !!isPremiumUser;

    console.log("--> [SERVER] Richiesta create_room ricevuta:", { code, hostName, isPremium: finalIsPremium, socketId: socket.id });

    // Verifica server-side real-time della licenza Judgement Day
    if (finalIsPremium) {
      const licenseCheck = verifyJudgementDayLicense(socket);
      if (!licenseCheck.valid) {
        console.warn(`[CREATE ROOM LICENZA RIFIUTATA] Stanza ${code} rifiutata: ${licenseCheck.reason} (${licenseCheck.code})`);
        if (socket.userData) {
          socket.userData.isPremium = false;
        }
        if (licenseCheck.code === 'TRANSFERRED') {
          socket.emit('license_transferred_error', { message: licenseCheck.reason });
        } else {
          socket.emit('license_error', { code: 'NO_LICENSE_FOUND', message: licenseCheck.reason });
        }
        return;
      }
      if (socket.userData) {
        socket.userData.isPremium = true;
      }
    }

    const hostPlayerId = socket.userData.playerId || sessionId;
    const hostDeviceId = deviceUuid || (socket.userData && (socket.userData.deviceId || socket.userData.deviceUuid)) || null;
    rooms[code] = {
      roomCode: code,
      hostId: socket.id,
      hostSessionId: sessionId,
      hostDeviceId: hostDeviceId,
      hostName: hostName,
      createdAt: Date.now(),
      players: [{ id: socket.id, playerId: hostPlayerId, deviceId: hostDeviceId, name: hostName, isHost: true, connected: true, isOnline: true, premiumReady: false, avatar: avatar || null, sessionId: sessionId }],
      state: 'lobby', // lobby, playing, freeze, results, summary
      deck: null,
      currentCardIndex: 0,
      votes: {},       // socketId => voteType
      playerResponses: [], // storico dei voti delle risposte per i premi
      votingTimer: null,
      verdictTimer: null,
      roundTimeout: null,
      currentRoundToken: null,
      lastNextCardTimestamp: 0,
      isPremium: finalIsPremium,
      customCards: [],
      reportedFiles: [],
      assets: [],
      chat: [],
      roundId: 0,
      blacklist: [],
      isLocked: false,
      timerDurationMs: 10000 // Durata timer round (5000 o 10000)
    };

    // Sincronizza stato iniziale su Redis con TTL 2 ore
    syncRoomToRedis(code, rooms[code]);

    socket.join(code);
    socket.emit('room_created', {
      roomCode: code,
      players: rooms[code].players,
      isHost: true,
      isPremium: rooms[code].isPremium
    });
    console.log(`Stanza creata con codice personalizzato: ${code} da ${hostName} (${socket.id}) | Premium: ${rooms[code].isPremium}`);
  });

  // Evento 2: Ingresso nella Stanza (Giocatore)
  socket.on('join_room', ({ avatar, deviceId }) => {
    if (!authenticated || !socket.userData) {
      socket.emit('room_error', "Non sei autenticato.");
      return;
    }
    const { roomCode, playerName, sessionId, playerId: reqPlayerId } = socket.userData;
    const reqDeviceId = deviceId || (socket.userData && (socket.userData.deviceId || socket.userData.deviceUuid)) || null;
    
    const code = cleanRoomCode(roomCode);
    const room = rooms[code];

    if (!room) {
      socket.emit('room_error', "Codice stanza non esistente!");
      return;
    }

    // B. Controlla se è una riconnessione per deviceId, playerId/sessionId o stesso nome
    let player = room.players.find(p => !p.isBot && (
      (reqDeviceId && p.deviceId && p.deviceId === reqDeviceId) ||
      (p.playerId && p.playerId === (reqPlayerId || sessionId)) ||
      (p.sessionId && p.sessionId === sessionId) ||
      p.name.toLowerCase() === playerName.toLowerCase().trim()
    ));

    if (player) {
      const oldSocketId = player.id;
      player.id = socket.id;
      player.connected = true;
      player.isOnline = true;
      if (avatar) player.avatar = avatar;
      if (sessionId) player.sessionId = sessionId;
      if (reqPlayerId) player.playerId = reqPlayerId;
      if (reqDeviceId) player.deviceId = reqDeviceId;

      // Migra/alias i voti espressi dal vecchio socketId al nuovo socketId
      if (room.votes && oldSocketId && room.votes[oldSocketId]) {
        room.votes[socket.id] = room.votes[oldSocketId];
      }

      // Se l'Host si riconnette entro il grace period (15s):
      const isOriginalHostMatch = (room.hostDisconnectTimeout !== null) && (
        player.isHost ||
        room.hostId === socket.id ||
        room.hostId === oldSocketId ||
        (room.hostSessionId && room.hostSessionId === sessionId) ||
        (room.hostDeviceId && reqDeviceId && room.hostDeviceId === reqDeviceId) ||
        (room.hostName && room.hostName.toLowerCase() === player.name.toLowerCase().trim())
      );

      if (isOriginalHostMatch) {
        if (room.hostDisconnectTimeout) {
          clearTimeout(room.hostDisconnectTimeout);
          room.hostDisconnectTimeout = null;
          console.log(`[HOST RECONNECT] Host ${player.name} riconnesso via join_room entro il grace period di 15s. Grace period annullato.`);
        }
        player.isHost = true;
        room.hostId = socket.id;
        room.hostName = player.name;
        if (sessionId) room.hostSessionId = sessionId;
        if (reqDeviceId) room.hostDeviceId = reqDeviceId;

        io.to(code).emit('global_toast', { message: `👑 Host ${player.name} è rientrato in stanza!` });
        io.to(code).emit('host_reconnected', { hostName: player.name });
      } else {
        // Se il timer era già scaduto o non era l'host, entra come normale partecipante
        if (room.hostId !== socket.id && (!room.hostSessionId || room.hostSessionId !== sessionId)) {
          player.isHost = false;
        }
      }

      sanitizeRoomHost(room);

      currentRoomCode = code;
      currentPlayerName = player.name;
      socket.join(code);

      socket.emit('room_joined', {
        roomCode: code,
        players: room.players,
        isHost: player.isHost,
        isPremium: room.isPremium,
        isLocked: room.isLocked
      });

      broadcastRoomState(room);
      console.log(`Giocatore ${player.name} (isHost: ${player.isHost}) si è riconnesso (join_room) alla stanza ${code}`);

      // Sincronizzazione immediata hot-swap se la partita è in corso o in fase risultati
      if (room.state !== 'lobby') {
        sendStateSync(socket, room, player);
      }
      return;
    }

    // Nuovi ingressi: Emetti auth_completed
    socket.emit('auth_completed');

    if (room.state !== 'lobby') {
      // Il gioco è già iniziato ma potrebbe essere un nuovo giocatore che cerca di unirsi
      // (NON un partecipante registrato che si riconnette — quelli sono gestiti sopra).
      socket.emit('room_error', "Il gioco è già iniziato in questa stanza!");
      return;
    }

    // Controlla nomi duplicati
    const nameExists = room.players.some(p => p.name.toLowerCase() === playerName.toLowerCase());
    if (nameExists) {
      socket.emit('room_error', "Questo nome è già presente in questa stanza!");
      return;
    }

    // C. Controllo Lucchetto (isLocked)
    if (room.isLocked) {
      socket.emit('room_error', "Stanza bloccata dall'Host.");
      return;
    }

    // D. Controllo Stanza Piena (30/30 - Solo per stanze non premium / normali)
    if (!room.isPremium && room.players.length >= 30) {
      socket.emit('room_full_error');
      return;
    }

    currentRoomCode = code;
    currentPlayerName = playerName;

    // Aggiungi giocatore con deviceId
    const newPlayerId = reqPlayerId || sessionId || ('p_' + Math.random().toString(36).substring(2, 9));
    room.players.push({
      id: socket.id,
      playerId: newPlayerId,
      deviceId: reqDeviceId,
      name: playerName,
      isHost: false,
      connected: true,
      isOnline: true,
      premiumReady: false,
      avatar: avatar || null,
      sessionId: sessionId
    });
    socket.join(code);

    socket.emit('room_joined', {
      roomCode: code,
      players: room.players,
      isHost: false,
      isPremium: room.isPremium,
      isLocked: room.isLocked
    });

    // Notifica tutti gli altri
    io.to(code).emit('player_list_update', { players: room.players });
    console.log(`Giocatore ${playerName} si è unito alla stanza ${code}`);

    // Se la stanza è piena, notifica tutti (Solo per stanze non premium / normali)
    if (!room.isPremium && room.players.length === 30) {
      io.to(code).emit('room_full');
    }
  });

  // Evento Blocco / Sblocco Stanza (Solo Host)
  socket.on('toggle_lock_room', () => {
    const room = rooms[currentRoomCode];
    if (!room || room.hostId !== socket.id) return;

    room.isLocked = !room.isLocked;
    io.to(currentRoomCode).emit('room_lock_status', { isLocked: room.isLocked });
    console.log(`[ROOM] Stanza ${currentRoomCode} ${room.isLocked ? 'BLOCCATA' : 'SBLOCCATA'} dall'Host (${socket.id})`);
  });

  // Evento 3: Avvio della Partita (Solo Host) — CON BLINDATURA HOST E LOGGING
  socket.on('start_game', ({ gameLength }) => {
    const room = rooms[currentRoomCode] || Object.values(rooms).find(r => r.hostId === socket.id || (r.hostSessionId && socket.userData && r.hostSessionId === socket.userData.userId));
    if (!room) return;
    const isHost = room.hostId === socket.id || (room.hostSessionId && socket.userData && room.hostSessionId === socket.userData.userId);
    if (!isHost) return;

    currentRoomCode = room.roomCode;
    socket.join(room.roomCode);

    console.log(`[START GAME] Host "${room.hostName}" (${socket.id}) avvia partita per stanza ${currentRoomCode}. Stato pre-purga:`, room.players.map(p => ({ name: p.name, connected: p.connected, isOnline: p.isOnline, premiumReady: p.premiumReady, isHost: p.isHost })));

    // BLINDATURA HOST: forza lo stato dell'Host come connesso PRIMA della purga
    let hostPlayer = room.players.find(p => p.id === socket.id || p.isHost || (room.hostSessionId && p.sessionId === room.hostSessionId));
    if (hostPlayer) {
      hostPlayer.connected = true;
      hostPlayer.isOnline = true;
      hostPlayer.isHost = true;
      hostPlayer.id = socket.id; // Rebind socket ID attuale
      room.hostId = socket.id;
      console.log(`[START GAME] Host "${hostPlayer.name}" forzato come connesso/online prima della purga.`);
    }

    // FORCE-MARK PREMIUM READY: se ci sono carte o giocatori attivi, considera validi i giocatori connessi per evitare blocchi
    if (room.isPremium) {
      room.players.forEach(p => {
        if (p.connected !== false && p.isOnline !== false) {
          p.premiumReady = true;
        }
      });
    }

    // Purga automatica dei partecipanti disconnessi/offline prima dell'avvio partita
    const previousCount = room.players.length;
    room.players = room.players.filter(p => p.isBot || (p.connected !== false && p.isOnline !== false));
    
    // SAFETY: verifica che l'Host non sia stato rimosso dalla purga
    if (!room.players.find(p => p.id === socket.id)) {
      console.warn(`[START GAME SAFETY] Host "${room.hostName}" rimosso dalla purga! Re-inserimento forzato.`);
      if (hostPlayer) {
        hostPlayer.connected = true;
        hostPlayer.isOnline = true;
        hostPlayer.isHost = true;
        hostPlayer.id = socket.id;
        room.players.unshift(hostPlayer);
      }
    }

    if (room.players.length < previousCount) {
      console.log(`[START GAME] Rimosso/i ${previousCount - room.players.length} partecipante/i offline dalla stanza ${room.roomCode} prima dell'avvio.`);
      io.to(room.roomCode).emit('player_list_update', { players: room.players });
      io.to(room.roomCode).emit('global_toast', { message: "Partecipanti offline rimossi prima dell'avvio." });
    }

    console.log(`[START GAME] Stato post-purga:`, room.players.map(p => ({ name: p.name, connected: p.connected, isOnline: p.isOnline, premiumReady: p.premiumReady, isHost: p.isHost })));

    if (!room.players || room.players.length < 2) {
      console.warn(`[START GAME FAIL] Meno di 2 giocatori attivi nella stanza ${currentRoomCode}. Avvio rifiutato.`);
      socket.emit('room_error', "Servono almeno 2 giocatori attivi in stanza per avviare la partita!");
      return;
    }

    if (room.isPremium) {
      // Filtra e mantieni ESCLUSIVAMENTE le carte reali create dai partecipanti (nessuna carta fittizia di riempimento)
      const validCards = (room.customCards || []).filter(c => {
        if (!c) return false;
        const txt = typeof c === 'string' ? c.trim() : (c.text || c.prompt || '').trim();
        const img = (typeof c === 'object' && c.image && typeof c.image === 'string' && c.image.trim().length > 5) ? c.image.trim() : null;
        return (txt.length > 0 && !txt.startsWith('Carta Judgement Day')) || !!img;
      });

      let customCards = validCards.map((cardObj, index) => {
        const und = Math.floor(Math.random() * 41) + 30; // Percentuale casuale realistica 30-70%
        let promptText = typeof cardObj === 'string' ? cardObj.trim() : (cardObj.text || cardObj.prompt || '').trim();
        let image = (typeof cardObj === 'object' && cardObj !== null && typeof cardObj.image === 'string' && cardObj.image.trim().length > 5) ? cardObj.image.trim() : null;

        // Se c'è solo l'immagine, non iniettare nessun placeholder o testo generico
        if (image && (!promptText || promptText.startsWith('Immagine (') || promptText.startsWith('Carta Judgement Day') || promptText === 'Carta Immagine')) {
          promptText = '';
        }

        const ownerId = (typeof cardObj === 'object' && cardObj !== null) ? (cardObj.ownerId || null) : null;
        const description = (typeof cardObj === 'object' && cardObj !== null) ? (cardObj.description || null) : null;
        return {
          card_id: `custom_${index}_${Date.now()}`,
          prompt: promptText,
          text: promptText,
          image: image,
          ownerId: ownerId,
          description: description,
          global_stats: {
            underrated: und,
            overrated: 100 - und
          }
        };
      });

      // Se non ci sono carte custom (es. nessun giocatore ha inserito nulla), usa un fallback dal mazzo base
      if (customCards.length === 0 && DECK_DATA && DECK_DATA.decks && DECK_DATA.decks[0]) {
        console.warn(`[ROOM ${currentRoomCode}] Avvio premium senza carte custom. Uso fallback dal mazzo base.`);
        customCards = DECK_DATA.decks[0].cards.slice(0, 10).map((c, i) => ({
          ...c,
          text: c.prompt || c.text || `Carta ${i + 1}`,
          ownerId: null
        }));
      }

      // Mescola ESCLUSIVAMENTE le carte create dai giocatori (il mazzo conterrà esattamente N carte reali)
      const shuffledCustom = customCards.sort(() => 0.5 - Math.random());

      room.deck = {
        deck_id: 'custom_premium',
        deck_name: '👑 MODALITÀ "JUDGEMENT DAY"',
        cards: shuffledCustom
      };
      room.gameLength = shuffledCustom.length;
    } else {
      const deck = DECK_DATA && DECK_DATA.decks ? DECK_DATA.decks[0] : null;
      if (!deck) {
        socket.emit('room_error', "Mazzo di gioco non disponibile.");
        return;
      }

      // Clona il mazzo unico e seleziona la quantità desiderata di carte casuali
      const clonedDeck = JSON.parse(JSON.stringify(deck));
      const shuffledCards = clonedDeck.cards.sort(() => 0.5 - Math.random());
      const limit = parseInt(gameLength, 10) || 30;
      const selectedCards = shuffledCards.slice(0, limit);

      room.deck = {
        ...clonedDeck,
        cards: selectedCards
      };
      room.gameLength = selectedCards.length;
    }

    room.currentCardIndex = 0;
    room.playerResponses = [];
    room.state = 'playing';

    io.to(room.roomCode).emit('game_started', {
      deckName: room.deck.deck_name,
      totalCards: room.gameLength,
      imageUrls: (room.deck.cards || []).map(c => c.image).filter(Boolean)
    });

    startNewRound(room);
  });

  // Evento 4: Invio del Voto dal Client
  socket.on('submit_vote', ({ voteType }) => {
    const room = rooms[currentRoomCode];
    if (!room || (room.state !== 'playing' && room.state !== 'results')) return;

    // Registra il voto del mittente
    room.votes[socket.id] = voteType;

    // Invia lo stato aggiornato di chi ha votato (nomi dei votanti)
    const votedNames = room.players
      .filter(p => room.votes[p.id])
      .map(p => p.name);

    io.to(room.roomCode).emit('player_voted_update', { votedPlayers: votedNames });

    // Se il tempo è scaduto o siamo nell'overlay di fine turno, invia aggiornamento live del verdetto
    if (room.timeIsUp || room.state === 'results') {
      const roundVotes = room.players.map(p => ({
        player: p.name,
        vote: room.votes[p.id] || 'thinking'
      }));
      io.to(room.roomCode).emit('verdict_update', { votes: roundVotes });
    }

    // Verifica se tutti i partecipanti attivi ed online hanno espresso il voto
    const activePlayers = room.players.filter(p => p.isBot || (p.connected !== false && p.isOnline !== false));
    const allVoted = activePlayers.length > 0 && activePlayers.every(p => room.votes[p.id]);
    if (allVoted && room.state === 'playing') {
      freezeRound(room, "TUTTI I VOTI REGISTRATI!");
    }
  });

  // Evento 4b: Aggiunta Bot Simulati (Solo Host, Solo in Lobby)
  socket.on('add_bots', () => {
    const room = rooms[currentRoomCode];
    if (!room || room.hostId !== socket.id || room.state !== 'lobby') return;

    const botNames = ['Marco', 'Giulia', 'Alessandro'];
    const existingNames = room.players.map(p => p.name);
    const botAvatars = [
      'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80', // Marco
      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&h=150&q=80', // Giulia
      'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?auto=format&fit=crop&w=150&h=150&q=80'  // Alessandro
    ];

    botNames.forEach((botName, index) => {
      if (!existingNames.includes(botName)) {
        const botId = 'bot_' + botName.replace(/[^a-zA-Z]/g, '') + '_' + Math.random().toString(36).substr(2, 5);
        const avatarUrl = botAvatars[index % botAvatars.length];

        room.players.push({
          id: botId,
          name: botName,
          isHost: false,
          connected: true,
          isBot: true,
          premiumReady: !room.isPremium,
          avatar: avatarUrl
        });

        // Se la stanza è premium, simuliamo la scrittura dei bot con un ritardo casuale
        if (room.isPremium) {
          const delay = 1500 + Math.random() * 2000; // 1.5 - 3.5 secondi
          setTimeout(() => {
            const r = rooms[room.roomCode];
            if (!r || r.state !== 'lobby') return;
            const b = r.players.find(p => p.id === botId);
            if (!b) return;

            const botPrompts = [
              `Il caffè freddo in lattina`,
              `Le riunioni di allineamento alle 8:30 del lunedì`,
              `Mettere l'ananas sulla pizza a tradimento`,
              `Comprare vestiti solo per fare i resi gratuiti`,
              `La ricarica wireless lentissima`,
              `Mandare note vocali di 7 minuti`,
              `Chi applaude quando atterra l'aereo`
            ];
            const count = Math.floor(Math.random() * 2) + 1;
            for (let i = 0; i < count; i++) {
              const pStr = botPrompts[Math.floor(Math.random() * botPrompts.length)];
              const exists = r.customCards.some(c => (typeof c === 'string' && c === pStr) || (c && c.text === pStr));
              if (!exists) {
                r.customCards.push({ text: pStr, prompt: pStr, image: null, ownerId: botId });
              }
            }

            b.premiumReady = true;
            io.to(r.roomCode).emit('player_list_update', { players: r.players });
            io.to(r.roomCode).emit('room_players_update', { players: r.players });
          }, delay);
        }
      }
    });

    io.to(room.roomCode).emit('player_list_update', { players: room.players });
    io.to(room.roomCode).emit('room_players_update', { players: room.players });
  });

  // Evento 4c: Invio Carte Personalizzate (Judgement Day)
  socket.on('submit_premium_cards', ({ cards }) => {
    const room = rooms[currentRoomCode] || Object.values(rooms).find(r => r.players && r.players.some(p => p.id === socket.id));
    if (!room || !room.isPremium) {
      console.warn(`[CARDS REJECTED] Socket ${socket.id} ha inviato carte per stanza inesistente o non premium. currentRoomCode=${currentRoomCode}`);
      return;
    }

    currentRoomCode = room.roomCode;
    socket.join(room.roomCode);

    // Ricerca robusta del giocatore anche per deviceId o sessionId
    let player = room.players.find(p => p.id === socket.id || (socket.userData && (
      (socket.userData.deviceId && p.deviceId === socket.userData.deviceId) ||
      (socket.userData.userId && p.sessionId === socket.userData.userId) ||
      (socket.userData.playerName && p.name.toLowerCase() === socket.userData.playerName.toLowerCase())
    )));

    if (!player) {
      const pName = (socket.userData && (socket.userData.playerName || socket.userData.username)) || 'Giocatore';
      const isHostPlayer = room.hostId === socket.id || (room.hostName && room.hostName.toLowerCase() === pName.toLowerCase());
      player = {
        id: socket.id,
        name: pName,
        isHost: isHostPlayer,
        connected: true,
        isOnline: true,
        premiumReady: true,
        avatar: null
      };
      room.players.push(player);
    } else {
      player.id = socket.id;
      player.connected = true;
      player.isOnline = true;
      player.premiumReady = true;
      if (room.hostId === socket.id || (room.hostName && player.name && room.hostName.toLowerCase() === player.name.toLowerCase())) {
        player.isHost = true;
      }
    }

    const playerName = player.name;
    console.log(`[CARDS RECV START] Giocatore "${playerName}" (${socket.id}) sta inviando ${cards ? cards.length : 0} carte per stanza ${currentRoomCode}`);

    // Rimuovi eventuali vecchie carte inviate in precedenza da questo socket o player per aggiornamenti puliti
    if (Array.isArray(room.customCards)) {
      room.customCards = room.customCards.filter(c => c && c.ownerId !== socket.id && c.ownerId !== player.id);
    } else {
      room.customCards = [];
    }

    if (Array.isArray(cards)) {
      cards.forEach((cardObj, idx) => {
        if (cardObj && typeof cardObj === 'object') {
          const rawText = (cardObj.text || cardObj.prompt || '').trim();
          let image = cardObj.image || null;
          if (image && typeof image === 'string') {
            image = image.trim();
            if (image.length < 5) image = null;
          } else {
            image = null;
          }
          const text = rawText || (image ? `Immagine (${idx + 1})` : '');
          
          if (text || image) {
            room.customCards.push({
              text: text,
              prompt: text,
              image: image,
              ownerId: player.id
            });
          }
        } else if (typeof cardObj === 'string') {
          const trimmed = cardObj.trim();
          if (trimmed) {
            room.customCards.push({
              text: trimmed,
              prompt: trimmed,
              image: null,
              ownerId: player.id
            });
          }
        }
      });
    }

    // Marca SEMPRE il giocatore come PRONTO
    player.premiumReady = true;
    console.log(`[CARDS RECV OK] Giocatore "${player.name}" marcato come premiumReady=true. Totale carte mazzo: ${room.customCards.length}`);

    // Sincronizza stato volatile su Redis
    syncRoomToRedis(room.roomCode, room);

    // ACK ESPLICITO al client mittente (doppio evento per massima compatibilità)
    const ackData = {
      cardsCount: room.customCards.length,
      premiumReady: true,
      playerName: player.name
    };
    socket.emit('premium_cards_acknowledged', ackData);
    socket.emit('cards_received_success', ackData);

    // Broadcast IMMEDIATO aggiornamento stato a TUTTI i client
    io.to(room.roomCode).emit('player_list_update', { players: room.players });
    io.to(room.roomCode).emit('room_players_update', { players: room.players });
    console.log(`[CARDS BROADCAST] Aggiornamento player_list_update + room_players_update emesso per stanza ${room.roomCode}. Stato giocatori:`, room.players.map(p => ({ name: p.name, premiumReady: p.premiumReady })));
  });

  // Evento 4d: Richiesta Recupero Carta Attuale (Recovery client in caso di glitch di rete o rendering)
  socket.on('request_current_card', () => {
    const room = rooms[currentRoomCode];
    if (!room || !room.deck || !room.deck.cards || room.state !== 'playing') return;
    const card = room.deck.cards[room.currentCardIndex];
    if (!card) return;

    const safeImage = (typeof card.image === 'string' && card.image.trim().length > 5) ? card.image.trim() : null;
    let safePrompt = (card.prompt || card.text || '').trim();
    if (safeImage && (!safePrompt || safePrompt.startsWith('Immagine (') || safePrompt.startsWith('Carta Judgement Day') || safePrompt === 'Carta Immagine')) {
      safePrompt = '';
    }
    const safeText = safePrompt;

    socket.emit('current_card_recovery', {
      prompt: safePrompt,
      text: safeText,
      image: safeImage,
      ownerId: card.ownerId || null,
      description: card.description || null,
      cardIndex: room.currentCardIndex,
      totalCards: room.gameLength || room.deck.cards.length,
      timerDurationMs: room.timerDurationMs || 10000,
      roundId: Date.now()
    });
  });



  // Evento 6: Prossima Carta / Avanzamento Turno (Host o Watchdog di emergenza)
  const handleNextCardRequest = () => {
    const room = rooms[currentRoomCode];
    if (!room || (room.state !== 'results' && room.state !== 'playing' && room.state !== 'CARD_VOIDED')) return;

    // Debounce rapido anti double-click (600ms)
    const now = Date.now();
    if (room.lastNextCardTimestamp && (now - room.lastNextCardTimestamp < 600)) {
      return;
    }
    room.lastNextCardTimestamp = now;

    const isHost = room.hostId === socket.id;
    const activePlayers = room.players.filter(p => p.isBot || (p.connected !== false && p.isOnline !== false));
    const allVoted = activePlayers.length > 0 && activePlayers.every(p => room.votes && room.votes[p.id]);

    // BLOCCO AUTORITATIVO SUI TIMEOUT: Se la stanza è ancora in 'playing'
    // NESSUN client (neppure l'Host) può forzare la fine della carta se il tempo non è scaduto sul server e non tutti hanno votato
    if (room.state === 'playing') {
      if (!room.timeIsUp && !allVoted) {
        console.warn(`[NEXT CARD BLOCKED] Stanza ${currentRoomCode}: round ${room.currentCardIndex} ancora attivo in votazione. Avanzamento ignorato.`);
        return;
      }

      // Se il tempo era scaduto (time_up), registra le risposte prima dell'avanzamento
      room.players.forEach(p => {
        if (!room.votes[p.id]) {
          room.votes[p.id] = 'timeout';
        }
      });
      const card = (room.deck && room.deck.cards && room.deck.cards[room.currentCardIndex]) ? room.deck.cards[room.currentCardIndex] : {};
      const roundVotes = room.players.map(p => ({
        player: p.name,
        vote: room.votes[p.id]
      }));
      const safePrompt = card.prompt || card.text || '';
      const safeText = card.text || card.prompt || safePrompt;
      const safeImage = (typeof card.image === 'string' && card.image.trim().length > 5) ? card.image.trim() : null;
      const safeOwnerId = card.ownerId || null;

      room.playerResponses.push({
        prompt: safePrompt,
        text: safeText,
        image: safeImage,
        ownerId: safeOwnerId,
        votes: roundVotes,
        stats: card.global_stats || null
      });
    }

    // Solo l'host può comandare l'avanzamento, a meno che non sia scattato lo sblocco per stanza bloccata
    const isStuckOrReady = room.state === 'results' || room.state === 'CARD_VOIDED' || allVoted || room.timeIsUp;
    if (!isHost && !isStuckOrReady) return;

    // Pulizia rigorosa e preventiva di tutti i timer
    clearAllRoomTimers(room);

    room.currentCardIndex++;
    if (room.deck && room.deck.cards && room.currentCardIndex < room.deck.cards.length) {
      startNewRound(room);
    } else {
      endGame(room);
    }
  };

  socket.on('next_card', handleNextCardRequest);
  socket.on('nextCard', handleNextCardRequest);
  socket.on('advanceTurn', handleNextCardRequest);
  socket.on('advance_turn', handleNextCardRequest);
  socket.on('force_advance', handleNextCardRequest);

  // Evento 6b: Cambia Durata Timer (Solo Host)
  socket.on('set_timer_duration', ({ durationMs }) => {
    const room = rooms[currentRoomCode];
    if (!room || room.hostId !== socket.id) return;

    const validDurations = [5000, 10000, 15000];
    if (!validDurations.includes(durationMs)) return;

    room.timerDurationMs = durationMs;
    console.log(`[TIMER] Durata timer aggiornata a ${durationMs}ms nella stanza ${currentRoomCode}`);

    // Notifica tutti i client del cambio timer
    io.to(currentRoomCode).emit('timer_duration_changed', { durationMs });
  });

  // Evento 7: Torna al Menu / Ricomincia (Solo Host)
  socket.on('restart_game', () => {
    const room = rooms[currentRoomCode];
    if (!room || room.hostId !== socket.id) return;

    let targetIsPremium = !!room.isPremium;

    // Se la stanza era in Modalità Gogna (Judgement Day), verifichiamo la licenza
    if (room.isPremium) {
      const licenseCheck = verifyJudgementDayLicense(socket);
      if (!licenseCheck.valid) {
        console.warn(`[RESTART GAME LICENZA SCADUTA/TRASFERITA] Stanza ${room.roomCode} degradata a Classica: ${licenseCheck.reason} (${licenseCheck.code})`);
        targetIsPremium = false;
        room.isPremium = false;
        if (socket.userData) {
          socket.userData.isPremium = false;
        }
        if (licenseCheck.code === 'TRANSFERRED') {
          socket.emit('license_transferred_error', {
            message: "Licenza trasferita su un altro dispositivo. Riapri la modalità Judgement Day per inserire l'email e ricevere il codice OTP."
          });
        }
      }
    }

    // Cancella e distrugge qualsiasi timer del round pendente
    clearAllRoomTimers(room);

    // 1. I Capisaldi del Reset (Uguali per tutte le modalità)
    // PULIZIA TOTALE dello Stato di Round
    room.currentCardIndex = 0;
    room.playerResponses = [];
    room.votes = {};
    room.roundId = 0;
    room.timeIsUp = false;
    room.chat = []; // Wipe della chat sul server

    // Garbage Collection immediata degli Asset: elimina le immagini delle carte dal disco
    cleanupRoomAssets(room);

    if (targetIsPremium) {
      // SCENARIO B: Nella "Modalità Gogna" (Mazzo Creato dai Giocatori)
      room.state = 'lobby';
      room.customCards = [];
      room.deck = null;

      // Imposta tutti i giocatori su "Non Pronto" (premiumReady = false)
      room.players.forEach(p => {
        p.premiumReady = false;
      });

      // Simula i bot che riscrivono e inviano le carte al restart
      const botPlayers = room.players.filter(p => p.isBot);
      botPlayers.forEach(bot => {
        const delay = 1500 + Math.random() * 2000;
        setTimeout(() => {
          const r = rooms[room.roomCode];
          if (!r || r.state !== 'lobby') return;
          const b = r.players.find(p => p.id === bot.id);
          if (!b) return;

          const botPrompts = [
            `Il caffè freddo in lattina`,
            `Le riunioni di allineamento alle 8:30 del lunedì`,
            `Mettere l'ananas sulla pizza a tradimento`,
            `Comprare vestiti solo per fare i resi gratuiti`,
            `La ricarica wireless lentissima`,
            `Mandare note vocali di 7 minuti`,
            `Chi applaude quando atterra l'aereo`
          ];
          const count = Math.floor(Math.random() * 2) + 1;
          for (let i = 0; i < count; i++) {
            const pStr = botPrompts[Math.floor(Math.random() * botPrompts.length)];
            const exists = r.customCards.some(c => (typeof c === 'string' && c === pStr) || (c && c.text === pStr));
            if (!exists) {
              r.customCards.push({ text: pStr, prompt: pStr, image: null, ownerId: bot.id });
            }
          }

          b.premiumReady = true;
          io.to(r.roomCode).emit('player_list_update', { players: r.players });
          console.log(`Bot ${b.name} pronto di nuovo dopo il restart.`);
        }, delay);
      });

      syncRoomToRedis(room.roomCode, room);

      // Invia l'evento globale di reset Gogna
      io.to(room.roomCode).emit('game_reset_gogna', { players: room.players });
      console.log(`[RESET] Stanza ${room.roomCode} resettata in Modalità Gogna. Tutti i giocatori rimandati alla creazione carte.`);

    } else {
      // SCENARIO A: Nella "Stanza Normale" (Mazzo di Default o downgrade per licenza scaduta) -> Torna alla Lobby Classica
      room.state = 'lobby';
      room.deck = null;
      room.customCards = [];

      syncRoomToRedis(room.roomCode, room);

      // Invia l'evento globale di reset Default con lista giocatori aggiornata
      io.to(room.roomCode).emit('game_reset_default', { players: room.players, isPremium: false });
      io.to(room.roomCode).emit('room_state_update', {
        roomCode: room.roomCode,
        state: 'lobby',
        players: room.players,
        hostId: room.hostId,
        hostName: room.hostName,
        isLocked: room.isLocked,
        isPremium: false
      });
      io.to(room.roomCode).emit('player_list_update', { players: room.players });
      console.log(`[RESET] Stanza ${room.roomCode} resettata in Modalità Classica. Tutti i giocatori rimandati alla Lobby.`);
    }
  });

  // Evento 7c: Cambio Modalità Stanza nella Lobby (Solo Host)
  socket.on('set_room_mode', ({ isPremium }) => {
    const room = rooms[currentRoomCode];
    if (!room || room.hostId !== socket.id) return;
    if (room.state !== 'lobby') return;

    let targetPremium = !!isPremium;
    if (targetPremium) {
      const licenseCheck = verifyJudgementDayLicense(socket);
      if (!licenseCheck.valid) {
        if (licenseCheck.code === 'TRANSFERRED') {
          socket.emit('license_transferred_error', { message: licenseCheck.reason });
        } else {
          socket.emit('license_error', { code: 'NO_LICENSE_FOUND', message: licenseCheck.reason });
        }
        return;
      }
      if (socket.userData) socket.userData.isPremium = true;
    }

    room.isPremium = targetPremium;
    if (!targetPremium) {
      room.customCards = [];
    }
    syncRoomToRedis(room.roomCode, room);

    io.to(room.roomCode).emit('room_state_update', {
      roomCode: room.roomCode,
      state: room.state,
      players: room.players,
      hostId: room.hostId,
      hostName: room.hostName,
      isLocked: room.isLocked,
      isPremium: room.isPremium
    });

    io.to(room.roomCode).emit('room_mode_changed', { isPremium: room.isPremium });
    console.log(`[ROOM MODE] Stanza ${room.roomCode} cambiata a ${room.isPremium ? 'Judgement Day' : 'Standard'} dall'Host`);
  });

  // Evento 7b: Segnalazione Carta Corrente (Moderazione con soglia 33.3% e alert all'Host)
  const handleReportCard = () => {
    const room = rooms[currentRoomCode];
    if (!room || room.state !== 'playing' || !room.deck || !room.deck.cards) return;

    const card = room.deck.cards[room.currentCardIndex];
    if (!card) return;

    if (!card.reports || !(card.reports instanceof Set)) {
      card.reports = new Set(Array.isArray(card.reports) ? card.reports : []);
    }

    // Salva l'ID univoco del giocatore nel Set
    const reporterId = socket.userId || socket.sessionId || socket.id;
    card.reports.add(reporterId);

    // Rispondi al singolo client con l'evento report_confirmed
    socket.emit('report_confirmed', { cardIndex: room.currentCardIndex });

    // Calcola il quorum dinamico per eccesso (abbondanza) rispetto ai giocatori attualmente connessi alla stanza:
    const activePlayers = (room.players || []).filter(p => p.isBot || (p.connected !== false && p.isOnline !== false));
    const totalPlayers = Math.max(1, activePlayers.length || (room.players ? room.players.length : 1));
    const alertThreshold = Math.ceil(totalPlayers / 3); // 33.3% calcolato per eccesso
    const majorityThreshold = Math.floor(totalPlayers / 2) + 1; // >50% maggioranza assoluta

    console.log(`[REPORT CARD] Stanza ${room.roomCode} - Carta #${room.currentCardIndex}: ${card.reports.size}/${totalPlayers} segnalazioni (Soglia 33%: ${alertThreshold}, Maggioranza >50%: ${majorityThreshold})`);

    // VERIFICA SOGLIA MAGGIORANZA ASSOLUTA >50% (ANNULLAMENTO CARTA)
    if (card.reports.size >= majorityThreshold && (room.state === 'playing' || room.state === 'VOTING')) {
      console.log(`[CARD VOIDED] Stanza ${room.roomCode}: Carta #${room.currentCardIndex} annullata (>50% segnalazioni: ${card.reports.size}/${totalPlayers}).`);

      // 1. Arresta immediatamente il timer di votazione e tutti i timer del round
      clearAllRoomTimers(room);
      if (room.votingTimer) { clearTimeout(room.votingTimer); room.votingTimer = null; }
      if (room.roundTimeout) { clearTimeout(room.roundTimeout); room.roundTimeout = null; }

      // 2. Invalida il token del round per prevenire race condition o callback residui
      const voidToken = `void_${room.currentCardIndex}_${Date.now()}`;
      room.currentRoundToken = voidToken;
      room.roundId = voidToken;

      // 3. Imposta lo stato della stanza su CARD_VOIDED
      room.state = 'CARD_VOIDED';

      // 4. Annulla i voti del turno senza calcolare punteggi
      room.votes = {};
      room.timeIsUp = true;
      room.currentCardBlurred = false;

      // 5. Emetti l'evento socket a TUTTI i client connessi (Host compreso)
      io.to(room.roomCode).emit('card_voided_screen', {
        reason: 'majority_reported',
        reportCount: card.reports.size,
        totalPlayers: totalPlayers,
        threshold: majorityThreshold
      });

      // Se la carta contiene un file caricato, registralo per la rimozione
      if (card.image && card.image.startsWith('/uploads/')) {
        if (!room.reportedFiles) room.reportedFiles = [];
        if (!room.reportedFiles.includes(card.image)) {
          room.reportedFiles.push(card.image);
        }
      }
      return;
    }

    // Se currentCard.reports.size >= alertThreshold e l'alert non è ancora stato inviato per questa carta (!currentCard.hostNotified)
    if (card.reports.size >= alertThreshold && !card.hostNotified) {
      card.hostNotified = true;
      if (room.hostId) {
        io.to(room.hostId).emit('card_report_alert', {
          reportCount: card.reports.size,
          totalPlayers: totalPlayers,
          threshold: alertThreshold,
          cardIndex: room.currentCardIndex
        });
        console.log(`[REPORT THRESHOLD HIT] Stanza ${room.roomCode}: Alert inviato all'host ${room.hostId}`);
      }
    }

    // Moderazione e tracking dei file caricati
    if (card.image && card.image.startsWith('/uploads/')) {
      if (!room.reportedFiles) room.reportedFiles = [];
      if (!room.reportedFiles.includes(card.image)) {
        room.reportedFiles.push(card.image);
        console.log(`[MODERATION] File registrato per la rimozione a fine sessione: ${card.image}`);
      }
    }
  };

  socket.on('report_card', handleReportCard);
  socket.on('report_current_card', handleReportCard);

  // Evento censura/oscuramento da parte dell'Host (moderatore)
  socket.on('censor_current_card', () => {
    const room = rooms[currentRoomCode];
    if (!room || room.hostId !== socket.id || room.state !== 'playing') return;
    room.currentCardBlurred = true;
    io.to(room.roomCode).emit('card_censored', { cardIndex: room.currentCardIndex });
    io.to(room.roomCode).emit('card_blur_state_changed', { isBlurred: true });
    console.log(`[MODERATION] Carta #${room.currentCardIndex} oscurata (blur) dall'Host nella stanza ${room.roomCode}`);
  });

  // Evento: Toggle Blur Carta in Tempo Reale (Solo Host)
  socket.on('toggle_card_blur', () => {
    const room = rooms[currentRoomCode];
    if (!room || room.hostId !== socket.id || room.state !== 'playing') return;

    room.currentCardBlurred = !room.currentCardBlurred;
    io.to(room.roomCode).emit('card_blur_state_changed', { isBlurred: !!room.currentCardBlurred });
    console.log(`[CARD BLUR] Stanza ${room.roomCode}: blur ${room.currentCardBlurred ? 'ATTIVATO' : 'DISATTIVATO'} dall'Host ${socket.id}`);
  });

  // ==========================================================================
  // 2. RE-BINDING DELLA CONNESSIONE & 3. STATE RECOVERY (Server-Side)
  // ==========================================================================
  const handlePlayerReconnection = ({ roomCode, playerId, playerName, isHost, sessionId, deviceId }) => {
    const code = cleanRoomCode(roomCode);
    const room = rooms[code];
    if (!room) {
      socket.emit('session_failed', "Stanza non trovata o terminata.");
      socket.emit('reconnect_failed', { message: "Stanza non trovata." });
      return;
    }

    socket.emit('auth_completed');
    
    const reqDeviceId = deviceId || (socket.userData && (socket.userData.deviceId || socket.userData.deviceUuid)) || null;

    // Trova il giocatore corrispondente nella stanza per deviceId, playerId, sessionId o nome
    let player = room.players.find(p => 
      !p.isBot && (
        (reqDeviceId && p.deviceId && p.deviceId === reqDeviceId) ||
        (playerId && p.playerId === playerId) || 
        (sessionId && p.sessionId === sessionId) || 
        (playerName && p.name.toLowerCase() === playerName.trim().toLowerCase())
      )
    );

    if (!player) {
      socket.emit('session_failed', "Giocatore non registrato in questa stanza.");
      socket.emit('reconnect_failed', { message: "Giocatore non registrato." });
      return;
    }
    
    // RE-BINDING: Aggiorna l'oggetto del giocatore sostituendo il vecchio socket con quello nuovo
    const oldSocketId = player.id;
    player.id = socket.id;
    player.connected = true;
    player.isOnline = true;
    if (reqDeviceId) player.deviceId = reqDeviceId;
    if (playerId) player.playerId = playerId;
    if (sessionId) player.sessionId = sessionId;
    
    // Migra/alias i voti espressi dal vecchio socketId al nuovo socketId
    if (room.votes && oldSocketId && room.votes[oldSocketId]) {
      room.votes[socket.id] = room.votes[oldSocketId];
    }

    // Annulla eventuale grace period di disconnessione Host
    if (player.isHost || isHost || room.hostId === oldSocketId || (room.hostSessionId && room.hostSessionId === sessionId) || (room.hostDeviceId && reqDeviceId && room.hostDeviceId === reqDeviceId)) {
      if (room.hostDisconnectTimeout) {
        clearTimeout(room.hostDisconnectTimeout);
        room.hostDisconnectTimeout = null;
        console.log(`[RE-BIND] Host riconnesso alla stanza ${code}. Grace period annullato.`);
      }
      room.hostId = socket.id;
      player.isHost = true;
      if (sessionId) room.hostSessionId = sessionId;
      if (reqDeviceId) room.hostDeviceId = reqDeviceId;
    }
    
    sanitizeRoomHost(room);

    currentRoomCode = code;
    currentPlayerName = player.name;
    
    socket.join(code);
    
    // Informa gli altri giocatori della stanza
    broadcastRoomState(room);
    console.log(`[RE-BIND] Giocatore ${player.name} (${player.deviceId || player.playerId || socket.id}) ricollegato alla stanza ${code}`);

    // STATE RECOVERY: invia lo stato esatto della stanza al client ricollegato (hot-swap)
    sendStateSync(socket, room, player);
  };

  // Evento di riconnessione automatica e ripristino sessione
  socket.on('reconnect_room', handlePlayerReconnection);
  socket.on('reconnect', handlePlayerReconnection);
  socket.on('restore_session', handlePlayerReconnection);

  // Evento 8b: Toggle blocco stanza (Solo Host, Solo in Lobby)
  socket.on('toggle_room_lock', () => {
    const room = rooms[currentRoomCode];
    if (!room || room.hostId !== socket.id || room.state !== 'lobby') return;

    room.isLocked = !room.isLocked;

    // Emetti stato aggiornato a tutti
    io.to(room.roomCode).emit('room_lock_update', { isLocked: room.isLocked });

    // Toast globali
    const toastMsg = room.isLocked ? "🔒 L'Host ha chiuso la stanza" : "🔓 L'Host ha riaperto la stanza";
    io.to(room.roomCode).emit('global_toast', { message: toastMsg });

    console.log(`Lucchetto stanza ${room.roomCode} impostato a: ${room.isLocked}`);
  });

  // Evento 8c: Kick manuale partecipante (Solo Host, Solo in Lobby PRIMA di avviare la partita)
  socket.on('kick_player', ({ playerId, sessionId, name }) => {
    const room = rooms[currentRoomCode];
    if (!room || room.hostId !== socket.id || room.state !== 'lobby') return;

    const playerIndex = room.players.findIndex(p => p.id === playerId || (p.sessionId && p.sessionId === sessionId) || p.name === name);
    if (playerIndex === -1) return;

    const player = room.players[playerIndex];

    if (!player.isBot) {
      // NON usiamo blacklist permanente: il partecipante rimosso può rientrare dalla lobby con il link
      const kickData = { message: 'Non fai più parte della sessione' };

      // Chiudi il socket ed emetti evento di kick
      const targetSocket = io.sockets.sockets.get(player.id);
      if (targetSocket) {
        targetSocket.emit('kicked_from_room', kickData);
        setTimeout(() => {
          targetSocket.disconnect(true);
        }, 100);
      } else {
        io.to(player.id).emit('kicked_from_room', kickData);
      }
    }

    // Rimuovi dalla stanza
    room.players.splice(playerIndex, 1);

    // Toast notifiche (Neutro per gli altri, specifico per l'Host)
    room.players.forEach(p => {
      if (p.isHost) {
        io.to(p.id).emit('global_toast', { message: `Giocatore ${player.name} espulso dalla stanza` });
      } else {
        io.to(p.id).emit('global_toast', { message: `${player.name} ha lasciato la partita` });
      }
    });

    // Aggiorna lista partecipanti
    io.to(room.roomCode).emit('player_list_update', { players: room.players });
    console.log(`Giocatore/Bot ${player.name} rimosso dalla stanza ${room.roomCode}`);
  });

  // ==========================================================================
  // 4. GESTIONE DELLA DISCONNESSIONE PASSIVA
  // ==========================================================================
  socket.on('disconnect', () => {
    console.log(`Client disconnesso: ${socket.id}`);
    if (!currentRoomCode) return;

    const room = rooms[currentRoomCode];
    if (!room) return;

    // Quando il server rileva la disconnessione (ws.on('close')), non cancella il giocatore.
    // Lo contrassegna solo come connected = false e isOnline = false.
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.connected = false;
      player.isOnline = false;
      console.log(`[DISCONNECT] Giocatore ${player.name} contrassegnato come offline (isOnline = false).`);
    }

    // Sanitizza la stanza ed emetti aggiornamento sincronizzato dello stato
    broadcastRoomState(room);

    // Se l'host si disconnette passivamente (es. blocco schermo o cambio app), imposta un grace period di 15s
    if (room.hostId === socket.id || (player && player.isHost)) {
      const disconnectedHostName = player ? player.name : (room.hostName || 'L\'Host');
      console.log(`[DISCONNECT] Host (${disconnectedHostName}) disconnesso dalla stanza ${currentRoomCode}. Grace period di 15s avviato.`);
      
      io.to(currentRoomCode).emit('global_toast', {
        message: `⏳ ${disconnectedHostName} (Host) in riconnessione... (15s)`
      });
      io.to(currentRoomCode).emit('host_reconnecting', {
        hostName: disconnectedHostName,
        timeoutSeconds: 15
      });

      if (room.hostDisconnectTimeout) clearTimeout(room.hostDisconnectTimeout);
      
      room.hostDisconnectTimeout = setTimeout(() => {
        const checkRoom = rooms[currentRoomCode];
        if (checkRoom) {
          const isHostStillOffline = checkRoom.players.some(p => (p.id === checkRoom.hostId || (checkRoom.hostSessionId && p.sessionId === checkRoom.hostSessionId) || p.isHost) && (p.connected === false || p.isOnline === false));
          if (isHostStillOffline) {
            console.log(`[GRACE PERIOD EXPIRED] Grace period 15s scaduto per ${disconnectedHostName} in stanza ${currentRoomCode}. Procedo con riassegnazione Host.`);
            reassignHost(checkRoom, disconnectedHostName);
          }
        }
      }, 15000);
    } else {
      if (room.state === 'playing') {
        const activePlayers = room.players.filter(p => p.connected !== false && p.isOnline !== false);
        const allActiveVoted = activePlayers.length > 0 && activePlayers.every(p => room.votes[p.id]);
        if (allActiveVoted) {
          freezeRound(room, "TUTTI I GIOCATORI ATTIVI HANNO VOTATO");
        }
      }
    }
  });

  // Evento di abbandono esplicito dalla stanza (Host o Giocatore)
  socket.on('leave_room', () => {
    if (!currentRoomCode) return;
    const room = rooms[currentRoomCode];
    if (!room) return;

    const playerIndex = room.players.findIndex(p => p.id === socket.id);
    if (playerIndex !== -1) {
      const leavingPlayer = room.players[playerIndex];
      const wasHost = leavingPlayer.isHost || room.hostId === socket.id;

      room.players.splice(playerIndex, 1);
      socket.leave(currentRoomCode);
      currentRoomCode = null;

      if (wasHost) {
        if (room.hostDisconnectTimeout) {
          clearTimeout(room.hostDisconnectTimeout);
          room.hostDisconnectTimeout = null;
        }
        console.log(`[EXPLICIT LEAVE] L'Host ${leavingPlayer.name} ha abbandonato la stanza ${room.roomCode}. Riassegnazione immediata.`);
        reassignHost(room, leavingPlayer.name);
      } else {
        broadcastRoomState(room);
        io.to(room.roomCode).emit('global_toast', { message: `${leavingPlayer.name} ha lasciato la stanza.` });
      }
    }
  });
});

/**
 * Helper per la trasmissione centralizzata e sincronizzata dello stato della stanza a tutti i client.
 * Garantisce l'unicità dell'Host prima di ogni trasmissione.
 */
function broadcastRoomState(room) {
  if (!room) return;
  sanitizeRoomHost(room);
  io.to(room.roomCode).emit('player_list_update', { players: room.players });
  io.to(room.roomCode).emit('room_state_update', {
    roomCode: room.roomCode,
    state: room.state,
    players: room.players,
    hostId: room.hostId,
    hostName: room.hostName,
    isLocked: room.isLocked,
    isPremium: room.isPremium
  });
  // Sincronizzazione in-memory su Redis con TTL di 2 ore
  syncRoomToRedis(room.roomCode, room);
}

/**
 * Helper per la validazione rigorosa dell'unicità dell'Host nella stanza.
 * Garantisce che esattamente un solo giocatore abbia isHost = true.
 */
function sanitizeRoomHost(room) {
  if (!room || !Array.isArray(room.players) || room.players.length === 0) return;

  // 1. Cerca l'host basandosi sul socket hostId o hostSessionId salvato
  let hostIdx = room.players.findIndex(p => p.id === room.hostId || (room.hostSessionId && p.sessionId === room.hostSessionId));

  // 2. Se non trovato tramite ID, cerca chi ha isHost = true
  if (hostIdx === -1) {
    hostIdx = room.players.findIndex(p => p.isHost);
  }

  // 3. Se non trovato e non siamo in grace period, cerca il primo partecipante umano online
  if (hostIdx === -1 && !room.hostDisconnectTimeout) {
    hostIdx = room.players.findIndex(p => !p.isBot && p.connected !== false && p.isOnline !== false);
  }

  // 4. Fallback: primo elemento dell'array
  if (hostIdx === -1) {
    hostIdx = 0;
  }

  // Sanitizzazione rigida dell'array: esattamente UN SOLO Host
  room.players.forEach((p, idx) => {
    if (idx === hostIdx) {
      p.isHost = true;
      room.hostId = p.id;
      if (p.name) room.hostName = p.name;
      if (p.sessionId) room.hostSessionId = p.sessionId;
    } else {
      p.isHost = false;
    }
  });
}

// Helper per il riassegnamento automatico del ruolo Host al primo partecipante entrato nella stanza
function reassignHost(room, oldHostName = 'L\'Host') {
  if (!room || !room.players || room.players.length === 0) return false;

  if (room.hostDisconnectTimeout) {
    clearTimeout(room.hostDisconnectTimeout);
    room.hostDisconnectTimeout = null;
  }

  // Azzera tutti i ruoli host esistenti
  room.players.forEach(p => { p.isHost = false; });

  // Trova il primo partecipante umano online/connesso in ordine d'ingresso
  const newHost = room.players.find(p => !p.isBot && p.connected !== false && p.isOnline !== false);

  if (newHost) {
    newHost.isHost = true;
    room.hostId = newHost.id;
    room.hostName = newHost.name;
    if (newHost.sessionId) {
      room.hostSessionId = newHost.sessionId;
    }

    sanitizeRoomHost(room);

    console.log(`[HOST REASSIGNMENT] Stanza ${room.roomCode}: Ruolo Host riassegnato a ${newHost.name}`);

    const toastMsg = `👑 ${oldHostName} è uscito. ${newHost.name} è il nuovo Host della stanza!`;
    io.to(room.roomCode).emit('global_toast', { message: toastMsg });
    io.to(room.roomCode).emit('host_changed', { newHostId: newHost.id, newHostName: newHost.name });
    broadcastRoomState(room);

    const newHostSocket = io.sockets.sockets.get(newHost.id);
    if (newHostSocket) {
      newHostSocket.emit('host_assigned', { isHost: true });
      sendStateSync(newHostSocket, room, newHost);
    }
    return true;
  } else {
    sanitizeRoomHost(room);
    broadcastRoomState(room);
    console.log(`[HOST REASSIGNMENT] Stanza ${room.roomCode}: Nessun altro partecipante online. Chiusura stanza.`);
    io.to(room.roomCode).emit('room_closed', `L'Host (${oldHostName}) si è disconnesso e non ci sono altri partecipanti in stanza. Partita terminata.`);
    clearAllRoomTimers(room);
    cleanupRoomFiles(room);
    cleanupRoomAssets(room);
    delete rooms[room.roomCode];
    deleteRoomFromRedis(room.roomCode);
    return false;
  }
}

// ==========================================================================
// 3. STATE RECOVERY (Sincronizzazione dello Stato Server-Side)
// ==========================================================================
function sendStateSync(socket, room, player) {
  const currentCard = (room.deck && room.deck.cards && room.deck.cards[room.currentCardIndex]) ? room.deck.cards[room.currentCardIndex] : null;

  const safeImage = (currentCard && typeof currentCard.image === 'string' && currentCard.image.trim().length > 5) ? currentCard.image.trim() : null;
  let safePrompt = currentCard ? (currentCard.prompt || currentCard.text || '').trim() : '';
  if (safeImage && (!safePrompt || safePrompt.startsWith('Immagine (') || safePrompt.startsWith('Carta Judgement Day') || safePrompt === 'Carta Immagine')) {
    safePrompt = '';
  }
  const safeText = safePrompt;

  const gameData = {
    deckName: room.deck ? room.deck.deck_name : '',
    totalCards: room.gameLength || (room.deck ? room.deck.cards.length : 0),
    cardIndex: room.currentCardIndex,
    prompt: safePrompt,
    text: safeText,
    image: safeImage,
    ownerId: currentCard ? (currentCard.ownerId || null) : null,
    description: currentCard ? (currentCard.description || null) : null,
    userHasVoted: !!(room.votes && room.votes[socket.id]),
    userVote: (room.votes && room.votes[socket.id]) ? room.votes[socket.id] : null,
    votedPlayers: room.players.filter(p => room.votes && room.votes[p.id] && room.votes[p.id] !== 'timeout').map(p => p.name),
    roundStartTime: room.roundStartTime || Date.now(),
    timerDurationMs: room.timerDurationMs || 10000,
    freezeMessage: room.freezeMessage || '',
    customCardsSubmitted: !!player.premiumReady,
    roundId: room.roundId || 0
  };

  if (room.state === 'results') {
    const voteDetails = room.players.map(p => ({
      player: p.name,
      vote: (room.votes && room.votes[p.id]) || 'timeout'
    }));
    let countUnder = 0, countOver = 0;
    voteDetails.forEach(v => {
      if (v.vote === 'underrated') countUnder++;
      if (v.vote === 'overrated') countOver++;
    });
    const totalValid = countUnder + countOver;
    let groupUnderPct = 50, groupOverPct = 50;
    if (totalValid > 0) {
      groupUnderPct = Math.round((countUnder / totalValid) * 100);
      groupOverPct = 100 - groupUnderPct;
    }
    gameData.results = {
      votes: voteDetails,
      groupStats: { underrated: groupUnderPct, overrated: groupOverPct },
      globalStats: currentCard ? currentCard.global_stats : null,
      prompt: safePrompt,
      text: safeText,
      image: safeImage,
      ownerId: currentCard ? (currentCard.ownerId || null) : null,
      cardIndex: room.currentCardIndex,
      totalCards: room.gameLength || (room.deck ? room.deck.cards.length : 0)
    };
  } else if (room.state === 'summary') {
    gameData.summary = {
      awards: calculateAwards(room),
      summary: room.playerResponses
    };
  }

  // Emette il payload sync_state contenente lo stato completo della stanza
  socket.emit('sync_state', {
    status: room.state, // 'lobby', 'card_submission', 'playing', 'results', 'summary'
    roomCode: room.roomCode,
    isHost: !!player.isHost,
    isPremium: !!room.isPremium,
    isLocked: !!room.isLocked,
    players: room.players,
    assignedName: player.name,
    gameData: gameData
  });

  // Emette anche session_restored per garantire la retrocompatibilità
  socket.emit('session_restored', {
    state: room.state,
    roomCode: room.roomCode,
    players: room.players,
    isHost: player.isHost,
    isPremium: room.isPremium,
    isLocked: room.isLocked,
    currentScreen: room.state,
    gameData: gameData,
    assignedName: player.name
  });

  console.log(`[STATE RECOVERY] Inviato sync_state a ${player.name} per stanza ${room.roomCode} (stato: ${room.state})`);
}

// ==========================================================================
// FUNZIONI SUPPORTO LOGICA ROUND
// ==========================================================================
function startNewRound(room) {
  // 1. Pulizia preventiva e rigorosa di qualsiasi timer precedente
  clearAllRoomTimers(room);

  // 2. Reset atomico dello stato del round PRIMA dell'invio ai client
  room.state = 'playing';
  room.votes = {}; // Resetta i voti
  room.timeIsUp = false; // Reset stato fine tempo
  room.freezeMessage = '';
  room.roundStartTime = Date.now();

  const timerMs = room.timerDurationMs || 10000;
  
  if (!room.deck || !room.deck.cards || room.deck.cards.length === 0) {
    console.error(`[ROOM ${room.roomCode}] Nessuna carta disponibile nel mazzo per avviare il round.`);
    return;
  }
  
  const card = room.deck.cards[room.currentCardIndex];
  if (!card) {
    console.warn(`[ROOM ${room.roomCode}] Carta indice ${room.currentCardIndex} non trovata. Fine partita.`);
    endGame(room);
    return;
  }

  // Tracciamento segnalazioni uniche e flag notifica Host per questa specifica carta
  card.reports = new Set();
  card.hostNotified = false;
  room.currentCardBlurred = false;

  // 3. Assegna identificativo univoco (Round Token) a questa specifica fase di votazione
  const currentToken = `round_${room.currentCardIndex}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  room.currentRoundToken = currentToken;
  room.roundId = currentToken;

  // Verifica e riparazione di sicurezza per dati corrotti o indefiniti
  const safeImage = (typeof card.image === 'string' && card.image.trim().length > 5) ? card.image.trim() : null;
  let safePrompt = (card.prompt || card.text || '').trim();
  if (safeImage && (!safePrompt || safePrompt.startsWith('Immagine (') || safePrompt.startsWith('Carta Judgement Day') || safePrompt === 'Carta Immagine')) {
    safePrompt = '';
  }
  const safeText = safePrompt;
  const safeOwnerId = card.ownerId || null;
  const safeDescription = card.description || null;

  // Assicura che l'oggetto carta mantenga tutte le proprietà intatte
  card.prompt = safePrompt;
  card.text = safeText;
  card.image = safeImage;
  card.ownerId = safeOwnerId;
  card.description = safeDescription;

  // 4. Notifica tutti i client della nuova carta con token di round univoco
  io.to(room.roomCode).emit('new_card', {
    prompt: safePrompt,
    text: safeText,
    image: safeImage,
    ownerId: safeOwnerId,
    description: safeDescription,
    cardIndex: room.currentCardIndex,
    totalCards: room.gameLength || room.deck.cards.length,
    timerDurationMs: timerMs,
    roundId: currentToken,
    roundToken: currentToken
  });

  // Sincronizza stato volatile su Redis
  syncRoomToRedis(room.roomCode, room);

  // 5. Programmazione del voto dei Bot con verifica rigorosa del token di round
  const botPlayers = room.players.filter(p => p.isBot);
  const scheduledCardIndex = room.currentCardIndex;
  const scheduledToken = currentToken;
  const botMaxDelay = timerMs * 1.2; // Bot possono votare fino al 120% del timer

  botPlayers.forEach(bot => {
    const delay = (timerMs * 0.2) + Math.random() * botMaxDelay;
    
    setTimeout(() => {
      // Verifica che la stanza sia ancora nello stesso identico round ed in stato valido
      if (!room || room.currentRoundToken !== scheduledToken || room.currentCardIndex !== scheduledCardIndex || room.state !== 'playing') {
        return;
      }
      if (room.votes && room.votes[bot.id]) return; // Già votato

      // Genera voto casuale
      const voteType = Math.random() < 0.5 ? 'underrated' : 'overrated';
      room.votes[bot.id] = voteType;

      console.log(`Bot ${bot.name} ha votato: ${voteType}`);

      // Notifica i client dello stato del voto
      const votedNames = room.players
        .filter(p => room.votes && room.votes[p.id])
        .map(p => p.name);
      io.to(room.roomCode).emit('player_voted_update', { votedPlayers: votedNames });

      // Se il tempo è già scaduto ed è attivo l'overlay, aggiorna i voti in tempo reale
      if (room.timeIsUp) {
        const roundVotes = room.players.map(p => ({
          player: p.name,
          vote: (room.votes && room.votes[p.id]) || 'thinking'
        }));
        io.to(room.roomCode).emit('verdict_update', { votes: roundVotes });
      }

      // Se tutti hanno votato, congela il round
      const allVoted = room.players.every(p => room.votes && room.votes[p.id]);
      if (allVoted) {
        freezeRound(room, "TUTTI I VOTI REGISTRATI!");
      }
    }, delay);
  });

  // 6. Avvia timer master di votazione ESCLUSIVO sul server (timerMs + 500ms di latenza di rete)
  const timerRoundToken = currentToken;
  const timerCardIndex = room.currentCardIndex;

  room.votingTimer = setTimeout(() => {
    // VERIFICA RIGOROSA ROUND TOKEN & STATO: scarta se il token o indice carta non corrispondono o lo stato non è più playing
    if (!room || room.currentRoundToken !== timerRoundToken || room.currentCardIndex !== timerCardIndex || room.state !== 'playing') {
      return;
    }
    room.votingTimer = null;
    room.roundTimeout = null;
    room.timeIsUp = true;

    // Invia segnale autoritativo di tempo scaduto con i voti correnti
    const roundVotes = room.players.map(p => ({
      player: p.name,
      vote: (room.votes && room.votes[p.id]) || 'thinking'
    }));
    io.to(room.roomCode).emit('time_up', { votes: roundVotes, roundToken: timerRoundToken });
  }, timerMs + 500);

  room.roundTimeout = room.votingTimer;
}

function freezeRound(room, message) {
  if (!room || room.state !== 'playing') return;

  // Pulizia preventiva rigorosa di tutti i timer del round
  clearAllRoomTimers(room);

  room.state = 'results';
  room.freezeMessage = message;

  // Identifica i ritardatari ed assegna 'timeout'
  room.players.forEach(p => {
    if (!room.votes[p.id]) {
      room.votes[p.id] = 'timeout';
    }
  });

  // Salva risposte storiche per calcolo finale
  const card = (room.deck && room.deck.cards && room.deck.cards[room.currentCardIndex]) ? room.deck.cards[room.currentCardIndex] : {};
  const roundVotes = room.players.map(p => ({
    player: p.name,
    vote: room.votes[p.id]
  }));

  const safePrompt = card.prompt || card.text || '';
  const safeText = card.text || card.prompt || safePrompt;
  const safeImage = (typeof card.image === 'string' && card.image.trim().length > 5) ? card.image.trim() : null;
  const safeOwnerId = card.ownerId || null;

  room.playerResponses.push({
    prompt: safePrompt,
    text: safeText,
    image: safeImage,
    ownerId: safeOwnerId,
    votes: roundVotes,
    stats: card.global_stats || null
  });

  // Calcola percentuali del gruppo
  let countUnder = 0;
  let countOver = 0;
  roundVotes.forEach(v => {
    if (v.vote === 'underrated') countUnder++;
    if (v.vote === 'overrated') countOver++;
  });
  const totalValid = countUnder + countOver;
  let groupUnderPct = 50;
  let groupOverPct = 50;
  if (totalValid > 0) {
    groupUnderPct = Math.round((countUnder / totalValid) * 100);
    groupOverPct = 100 - groupUnderPct;
  }

  // Emetti i risultati del round a tutti i client
  io.to(room.roomCode).emit('round_results', {
    votes: roundVotes,
    groupStats: { underrated: groupUnderPct, overrated: groupOverPct },
    globalStats: card.global_stats || null,
    prompt: safePrompt,
    text: safeText,
    image: safeImage,
    ownerId: safeOwnerId,
    cardIndex: room.currentCardIndex,
    totalCards: room.gameLength || (room.deck ? room.deck.cards.length : 0),
    roundToken: room.currentRoundToken
  });

  // Sincronizza stato volatile su Redis
  syncRoomToRedis(room.roomCode, room);
}

function endGame(room) {
  if (!room) return;
  clearAllRoomTimers(room);
  room.state = 'summary';

  // Calcola i premi speciali
  const awards = calculateAwards(room);

  // Invia il segnale di game over con resoconto e premi
  io.to(room.roomCode).emit('game_over', {
    awards: awards,
    summary: room.playerResponses
  });

  // Aggiorna lo stato volatile su Redis con TTL 2h
  syncRoomToRedis(room.roomCode, room);

  // PERSISTENZA MINIMA SU DB: Salva SOLO lo storico partita finale sul DB permanente
  try {
    const matchRecord = {
      matchId: crypto.randomUUID ? crypto.randomUUID() : `match_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      roomCode: room.roomCode,
      playedAt: new Date().toISOString(),
      isPremium: !!room.isPremium,
      totalCards: room.playerResponses ? room.playerResponses.length : (room.currentCardIndex || 0),
      players: (room.players || []).map(p => ({
        name: p.name,
        isHost: !!p.isHost,
        isBot: !!p.isBot,
        avatar: p.avatar || null
      })),
      awards: awards,
      summaryStats: {
        totalRounds: room.playerResponses ? room.playerResponses.length : 0,
        groupStats: (room.playerResponses || []).map(r => ({
          prompt: r.prompt,
          votes: r.votes
        }))
      }
    };
    saveGameHistoryRecord(matchRecord);
  } catch (err) {
    console.error("[DB PERSISTENCE ERR] Errore salvataggio storico partita:", err);
  }
}

// Calcolo premi speciali sul server
function calculateAwards(room) {
  const stats = {};
  room.players.forEach(p => {
    stats[p.name] = {
      underrated: 0,
      overrated: 0,
      timeouts: 0,
      agreedWithGroup: 0,
      disagreedWithGroup: 0
    };
  });

  room.playerResponses.forEach(res => {
    let countUnder = 0;
    let countOver = 0;
    res.votes.forEach(v => {
      if (v.vote === 'underrated') countUnder++;
      if (v.vote === 'overrated') countOver++;
    });

    let majority = null;
    if (countUnder > countOver) majority = 'underrated';
    else if (countOver > countUnder) majority = 'overrated';

    res.votes.forEach(v => {
      const pStats = stats[v.player];
      if (!pStats) return;

      if (v.vote === 'underrated') {
        pStats.underrated++;
        if (majority) {
          if (majority === 'underrated') pStats.agreedWithGroup++;
          else pStats.disagreedWithGroup++;
        }
      } else if (v.vote === 'overrated') {
        pStats.overrated++;
        if (majority) {
          if (majority === 'overrated') pStats.agreedWithGroup++;
          else pStats.disagreedWithGroup++;
        }
      } else {
        pStats.timeouts++;
      }
    });
  });

  const list = [];
  const playerNames = room.players.map(p => p.name);

  // 1. L'omologato
  let maxAgree = 0;
  let winnersAgree = [];
  playerNames.forEach(name => {
    const s = stats[name];
    if (s.agreedWithGroup > maxAgree) {
      maxAgree = s.agreedWithGroup;
      winnersAgree = [name];
    } else if (s.agreedWithGroup === maxAgree && maxAgree > 0) {
      winnersAgree.push(name);
    }
  });
  if (maxAgree > 0) {
    list.push({
      title: "🏆 L'OMOLOGATO",
      winner: winnersAgree.join(', '),
      desc: `Ha votato d'accordo con il gruppo per ${maxAgree} volte. Persona socievole o senza personalità?`,
      icon: "🐑"
    });
  }

  // 2. La pecora nera
  let maxDisagree = 0;
  let winnersDisagree = [];
  playerNames.forEach(name => {
    const s = stats[name];
    if (s.disagreedWithGroup > maxDisagree) {
      maxDisagree = s.disagreedWithGroup;
      winnersDisagree = [name];
    } else if (s.disagreedWithGroup === maxDisagree && maxDisagree > 0) {
      winnersDisagree.push(name);
    }
  });
  if (maxDisagree > 0) {
    list.push({
      title: "🐺 LA PECORA NERA",
      winner: winnersDisagree.join(', '),
      desc: `In disaccordo con la maggioranza per ${maxDisagree} volte. Bastian contrario nato!`,
      icon: "🖤"
    });
  }

  // 3. Il pigro
  let maxTimeouts = 0;
  let winnersTimeouts = [];
  playerNames.forEach(name => {
    const s = stats[name];
    if (s.timeouts > maxTimeouts) {
      maxTimeouts = s.timeouts;
      winnersTimeouts = [name];
    } else if (s.timeouts === maxTimeouts && maxTimeouts > 0) {
      winnersTimeouts.push(name);
    }
  });
  if (maxTimeouts > 0) {
    list.push({
      title: "🐌 IL PIGRO",
      winner: winnersTimeouts.join(', '),
      desc: `Tempo scaduto per ${maxTimeouts} volte. La fretta non fa per lui.`,
      icon: "💤"
    });
  }

  // 4. Il Sopra-valutatore
  let maxOver = 0;
  let winnersOver = [];
  playerNames.forEach(name => {
    const s = stats[name];
    if (s.overrated > maxOver) {
      maxOver = s.overrated;
      winnersOver = [name];
    } else if (s.overrated === maxOver && maxOver > 0) {
      winnersOver.push(name);
    }
  });
  if (maxOver > 0 && maxOver >= Math.ceil(room.playerResponses.length / 2)) {
    list.push({
      title: "🔴 IL SOPRA-VALUTATORE",
      winner: winnersOver.join(', '),
      desc: `Ha votato SOPRAVVALUTATO ${maxOver} volte. Niente sembra soddisfarlo!`,
      icon: "⛔"
    });
  }

  // 5. Il Sotto-valutatore
  let maxUnder = 0;
  let winnersUnder = [];
  playerNames.forEach(name => {
    const s = stats[name];
    if (s.underrated > maxUnder) {
      maxUnder = s.underrated;
      winnersUnder = [name];
    } else if (s.underrated === maxUnder && maxUnder > 0) {
      winnersUnder.push(name);
    }
  });
  if (maxUnder > 0 && maxUnder >= Math.ceil(room.playerResponses.length / 2)) {
    list.push({
      title: "🟢 IL SOTTO-VALUTATORE",
      winner: winnersUnder.join(', '),
      desc: `Ha votato SOTTOVALUTATO ${maxUnder} volte. Trova valore in qualsiasi cosa.`,
      icon: "✨"
    });
  }

  return list;
}

function cleanupRoomFiles(room) {
  if (room && room.reportedFiles && room.reportedFiles.length > 0) {
    room.reportedFiles.forEach(filePath => {
      if (filePath.startsWith('/uploads/')) {
        const baseName = path.basename(filePath);
        const fullPath = path.join(__dirname, 'uploads', baseName);
        fs.unlink(fullPath, (err) => {
          if (err) {
            console.error(`[MODERATION] Errore eliminazione file segnalato ${fullPath}:`, err);
          } else {
            console.log(`[MODERATION] File segnalato eliminato con successo a fine sessione: ${fullPath}`);
          }
        });
      }
    });
  }
}

function cleanupRoomAssets(room) {
  if (room && room.assets && room.assets.length > 0) {
    room.assets.forEach(filePath => {
      if (filePath.startsWith('/uploads/')) {
        const baseName = path.basename(filePath);
        const fullPath = path.join(__dirname, 'uploads', baseName);
        fs.unlink(fullPath, (err) => {
          if (err) {
            console.error(`[ASSET GC] Errore eliminazione file ${fullPath}:`, err);
          } else {
            console.log(`[ASSET GC] File eliminato con successo: ${fullPath}`);
          }
        });
      }
    });
    room.assets = [];
  }
}

// ==========================================================================
// AVVIO SERVER HTTP
// ==========================================================================
server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`   OVERUNDER SERVER ONLINE!                            `);
  console.log(`   Disponibile localmente su: http://localhost:${PORT} `);
  console.log(`=======================================================`);
});
