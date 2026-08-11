/**
 * Script di Generazione Massiva Descrizioni via Gemini API (Step 4 - 10.000 Carte)
 * 
 * Esegue l'arricchimento completo di tutte le 10.000 carte in decks.json
 * chiamando Google Gemini con worker pool ultra-veloce basato su Flash-Lite.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.GEMINI_API_KEY || '';
const MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-flash-latest'];
const DECKS_PATH = path.join(__dirname, 'decks.json');
const CACHE_PATH = path.join(__dirname, 'descriptions_cache.json');
const BATCH_SIZE = 50;
const CONCURRENCY = 4;

// Carica la cache persistente se presente
let cache = {};
if (fs.existsSync(CACHE_PATH)) {
  try {
    cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    console.log(`[CACHE] Caricate ${Object.keys(cache).length} descrizioni salvate in cache.`);
  } catch (e) {
    cache = {};
  }
}

function saveCache() {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
}

/**
 * Pulisce ed estrae l'array JSON da testo grezzo
 */
function cleanJsonText(raw) {
  if (!raw) return '[]';
  let str = raw.trim();
  const startIdx = str.indexOf('[');
  const endIdx = str.lastIndexOf(']');
  if (startIdx !== -1 && endIdx !== -1 && endIdx >= startIdx) {
    return str.substring(startIdx, endIdx + 1);
  }
  return str;
}

/**
 * Invia un batch di titoli a Gemini
 */
async function generateBatchWithGemini(prompts, modelIndex = 0, retries = 5) {
  const modelName = MODELS[modelIndex % MODELS.length];

  const promptText = `Sei un'enciclopedia sintetica e rigorosa per un gioco da tavolo (stile Wikipedia / AI Overview).
Per ciascuno dei seguenti ${prompts.length} argomenti, genera una definizione enciclopedica in italiano, REALE, ACCURATA, SPECIFICA e SINTETICA (massimo 15-20 parole).
IMPORTANTE: Evita formule generiche o ripetitive. Ogni voce deve spiegare nello specifico cos'è, chi è o cosa rappresenta il soggetto.

Restituisci ESCLUSIVAMENTE un array JSON valido con questo schema:
[
  {"prompt": "Titolo originale esatto", "description": "Definizione enciclopedica specifica in italiano"}
]

Elenco carte:
${prompts.map((p, i) => `${i + 1}. ${p}`).join('\n')}`;

  const payload = JSON.stringify({
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1
    }
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${modelName}:generateContent?key=${API_KEY}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', async () => {
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(body);
            const rawText = parsed.candidates[0].content.parts[0].text;
            const cleaned = cleanJsonText(rawText);
            const items = JSON.parse(cleaned);
            resolve(items);
          } catch (err) {
            console.warn(`[WARN JSON] Errore parsing da ${modelName}, riprovo...`, err.message);
            if (retries > 0) {
              await new Promise(r => setTimeout(r, 1000));
              return resolve(await generateBatchWithGemini(prompts, modelIndex + 1, retries - 1));
            }
            reject(err);
          }
        } else if (res.statusCode === 429) {
          const waitSec = (6 - retries) * 3;
          console.warn(`[QUOTA 429 (${modelName})] Attesa ${waitSec}s...`);
          if (retries > 0) {
            await new Promise(r => setTimeout(r, waitSec * 1000));
            return resolve(await generateBatchWithGemini(prompts, modelIndex + 1, retries - 1));
          }
          reject(new Error(`API Error ${res.statusCode}: ${body}`));
        } else if (res.statusCode >= 500) {
          console.warn(`[SERVER ${res.statusCode} (${modelName})] Attesa 3s...`);
          if (retries > 0) {
            await new Promise(r => setTimeout(r, 3000));
            return resolve(await generateBatchWithGemini(prompts, modelIndex + 1, retries - 1));
          }
          reject(new Error(`API Error ${res.statusCode}: ${body}`));
        } else {
          console.error(`[ERRORE API ${res.statusCode}]`, body);
          if (retries > 0) {
            await new Promise(r => setTimeout(r, 2000));
            return resolve(await generateBatchWithGemini(prompts, modelIndex + 1, retries - 1));
          }
          reject(new Error(`API Error ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', async (err) => {
      console.warn(`[NETWORK ERROR] ${err.message}, riprovo...`);
      if (retries > 0) {
        await new Promise(r => setTimeout(r, 2000));
        return resolve(await generateBatchWithGemini(prompts, modelIndex, retries - 1));
      }
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Worker pool per esecuzione concorrente
 */
async function main() {
  console.log('====================================================');
  console.log('🚀 AVVIO GENERAZIONE MASSIVA FLASH-LITE (C=4, B=50)');
  console.log('====================================================');

  const deckData = JSON.parse(fs.readFileSync(DECKS_PATH, 'utf8'));
  const cards = deckData.decks[0].cards;
  console.log(`[DATASET] Totale carte presenti: ${cards.length}`);

  // Trova le carte senza descrizione in cache
  const missingPrompts = [];
  cards.forEach(card => {
    const prompt = card.prompt ? card.prompt.trim() : '';
    if (!cache[prompt] || cache[prompt].length < 15 || cache[prompt].includes('Riferimento ed elemento culturale legato a')) {
      missingPrompts.push(prompt);
    }
  });

  console.log(`[STATO] Carte già in cache valida: ${cards.length - missingPrompts.length}`);
  console.log(`[STATO] Carte da generare con Gemini: ${missingPrompts.length}`);

  if (missingPrompts.length > 0) {
    const batches = [];
    for (let i = 0; i < missingPrompts.length; i += BATCH_SIZE) {
      batches.push(missingPrompts.slice(i, i + BATCH_SIZE));
    }

    console.log(`[BATCHES] Creati ${batches.length} batch da ${BATCH_SIZE} carte (Concorrenza: ${CONCURRENCY})`);

    let nextBatchIdx = 0;
    let completedBatches = 0;

    async function worker(workerId) {
      while (nextBatchIdx < batches.length) {
        const currentIdx = nextBatchIdx++;
        const currentBatch = batches[currentIdx];
        const startT = Date.now();
        try {
          const results = await generateBatchWithGemini(currentBatch, workerId);
          if (Array.isArray(results)) {
            results.forEach(res => {
              if (res && res.prompt && res.description) {
                cache[res.prompt.trim()] = res.description.trim();
              }
            });
          }
          completedBatches++;
          const elapsed = ((Date.now() - startT) / 1000).toFixed(1);
          console.log(`[Worker ${workerId}] Batch ${completedBatches}/${batches.length} completato in ${elapsed}s (In cache: ${Object.keys(cache).length})`);

          if (completedBatches % 3 === 0 || completedBatches === batches.length) {
            saveCache();
          }

          // Piccolo pacing
          await new Promise(r => setTimeout(r, 800));
        } catch (err) {
          console.error(`[Worker ${workerId} ERRORE BATCH ${currentIdx + 1}]:`, err.message);
        }
      }
    }

    const workers = [];
    for (let w = 0; w < CONCURRENCY; w++) {
      workers.push(worker(w + 1));
    }

    await Promise.all(workers);
    saveCache();
  }

  // Sincronizza decks.json con tutte le descrizioni da cache
  console.log('\n[SINCRONIZZAZIONE] Applicazione descrizioni a decks.json...');
  let updatedCount = 0;
  cards.forEach(card => {
    const prompt = card.prompt ? card.prompt.trim() : '';
    if (cache[prompt]) {
      card.description = cache[prompt];
      updatedCount++;
    }
  });

  fs.writeFileSync(DECKS_PATH, JSON.stringify(deckData, null, 2), 'utf8');
  console.log(`[COMPLETATO] Aggiornate ${updatedCount}/${cards.length} carte in decks.json!`);
  console.log('====================================================');
}

main().catch(err => {
  console.error('[ERRORE CRITICO]', err);
  process.exit(1);
});
