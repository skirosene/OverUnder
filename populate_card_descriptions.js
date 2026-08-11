/**
 * Script di Utilità: Popolamento Descrizioni Carte Standard (Step 1)
 * 
 * Questo script arricchisce gli oggetti carta in decks.json aggiungendo
 * il campo 'description' con spiegazioni concise e accurate (max 20-25 parole).
 */

const fs = require('fs');
const path = require('path');

const DECKS_PATH = path.join(__dirname, 'decks.json');

// Mappa delle descrizioni per le prime carte standard
const INITIAL_DESCRIPTIONS = {
  // Mazzo Unico (decks.json)
  "c1": "Pratica pseudoscientifica che sfrutta gli aromi degli oli essenziali per favorire il rilassamento e il benessere psicofisico.",
  "c2": "Dispositivo domotico connesso a Internet per programmare e gestire il riscaldamento di casa direttamente da smartphone.",
  "c3": "Celebre bevanda calda simbolo di accoglienza e convivialità nel Maghreb, preparata con tè verde, menta e zucchero.",
  "c4": "Mercato della moda circolare dedicato all'acquisto di capi e accessori firmati usati, tra sostenibilità e status symbol.",
  "c5": "Acclamato manga e anime giapponese ambientato in una società cinta da mura assediata da giganteschi umanoidi carnivori.",
  "c6": "Forma espressiva ed estetica della creatività umana, capace di suscitare profonde emozioni ed accesi dibattiti culturali.",
  "c7": "Comportamento poco rispettoso consistente nell'effettuare chiamate o ascoltare musica ad alto volume nei trasporti pubblici senza cuffie.",
  "c8": "Primo piatto tipico della cucina valtellinese a base di tagliatelle di grano saraceno, verze, patate e formaggio Casera.",
  "c9": "Classico momento conviviale all'aperto dedicato alla cottura di carne, pesce o verdure alla brace in compagnia di amici.",
  "c10": "Dispositivo riscaldante elettrico da posizionare tra lenzuolo e materasso per mantenere il letto caldo durante le notti invernali.",

  // Prompt basati sul testo per compatibilità con tutti i mazzi
  "L'aromaterapia": "Pratica pseudoscientifica che sfrutta gli aromi degli oli essenziali per favorire il rilassamento e il benessere psicofisico.",
  "Il termostato smart": "Dispositivo domotico connesso a Internet per programmare e gestire il riscaldamento di casa direttamente da smartphone.",
  "Il tè alla menta marocchino": "Celebre bevanda calda simbolo di accoglienza e convivialità nel Maghreb, preparata con tè verde, menta e zucchero.",
  "Il second hand di lusso": "Mercato della moda circolare dedicato all'acquisto di capi e accessori firmati usati, tra sostenibilità e status symbol.",
  "Attack on Titan": "Acclamato manga e anime giapponese ambientato in una società cinta da mura assediata da giganteschi umanoidi carnivori.",
  "L'arte": "Forma espressiva ed estetica della creatività umana, capace di suscitare profonde emozioni ed accesi dibattiti culturali.",
  "Il vivavoce in treno": "Comportamento poco rispettoso consistente nell'effettuare chiamate o ascoltare musica ad alto volume nei trasporti pubblici senza cuffie.",
  "I pizzoccheri valtellinesi": "Primo piatto tipico della cucina valtellinese a base di tagliatelle di grano saraceno, verze, patate e formaggio Casera.",
  "La grigliata in giardino": "Classico momento conviviale all'aperto dedicato alla cottura di carne, pesce o verdure alla brace in compagnia di amici.",
  "Lo scaldaletto": "Dispositivo riscaldante elettrico da posizionare tra lenzuolo e materasso per mantenere il letto caldo durante le notti invernali.",
  "La pizza con l'ananas": "Controversa pizza con pomodoro, formaggio e fette di ananas, al centro di infiniti dibattiti gastronomici mondiali.",
  "L'applauso all'atterraggio dell'aereo": "Abitudine tipicamente italiana di applaudire l'equipaggio non appena le ruote dell'aereo toccano la pista di atterraggio.",
  "Ordinare un cappuccino dopo le 12:00": "Tabù della cultura culinaria italiana, che riserva la bevanda al latte e caffè esclusivamente alla prima colazione.",
  "L'uso quotidiano del bidet": "Sanitario indispensabile nelle case italiane per la cura dell'igiene personale intima quotidiana, raro in molti paesi esteri.",
  "Aggiungere la panna nella carbonara": "Eresia per i puristi della ricetta romana, che richiede rigorosamente uova, guanciale, pecorino e pepe nero.",
  "Inviare messaggi vocali di oltre 3 minuti": "Monologhi vocali su WhatsApp che sostituiscono una vera telefonata, spesso fonte di disperazione per chi li riceve.",
  "Arrivare 15 minuti in anticipo ad un appuntamento": "Rara dimostrazione di puntualità e rispetto del tempo altrui, talvolta al confine con l'ansia sociale anticipatoria.",
  "Mettere i calzini con i sandali in estate": "Abbinamento a lungo deriso come anti-estetico ma recentemente sdoganato nel mondo della moda da trendsetter internazionali.",
  "Mangiare la pasta riscaldata il giorno dopo": "Abitudine culinaria domestica in cui la pasta avanzata guadagna sapore e croccantezza venendo ripassata in padella.",
  "Fare spoiler di serie TV senza preavviso": "Rivelare a tradimento colpi di scena o finali di film e serie prima che gli altri abbiano potuto guardarli."
};

function populateDescriptions() {
  console.log(`[SCRIPT] Caricamento file: ${DECKS_PATH}`);
  
  if (!fs.existsSync(DECKS_PATH)) {
    console.error(`[ERRORE] File non trovato: ${DECKS_PATH}`);
    process.exit(1);
  }

  const rawData = fs.readFileSync(DECKS_PATH, 'utf8');
  const deckData = JSON.parse(rawData);

  let updatedCount = 0;

  if (deckData.decks && Array.isArray(deckData.decks)) {
    deckData.decks.forEach(deck => {
      if (deck.cards && Array.isArray(deck.cards)) {
        deck.cards.forEach((card, index) => {
          const prompt = card.prompt ? card.prompt.trim() : '';
          const cardId = card.card_id || '';

          if (INITIAL_DESCRIPTIONS[cardId]) {
            card.description = INITIAL_DESCRIPTIONS[cardId];
            updatedCount++;
          } else if (INITIAL_DESCRIPTIONS[prompt]) {
            card.description = INITIAL_DESCRIPTIONS[prompt];
            updatedCount++;
          }
        });
      }
    });
  }

  fs.writeFileSync(DECKS_PATH, JSON.stringify(deckData, null, 2), 'utf8');
  console.log(`[SUCCESSO] Popolamento completato! Aggiornate ${updatedCount} carte con descrizione reale in decks.json.`);
}

populateDescriptions();
