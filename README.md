# OverUnder - Party Game Mobile (MVP)

Benvenuto in **OverUnder**, un party game mobile ultra-veloce e polarizzante progettato per animare le serate tra amici. Questa è la versione MVP (Minimum Viable Product) funzionante in modalità locale "Passamano" (Single Device / Local Multiplayer).

Il gioco elimina le complessità ponendo domande irriverenti a risposta secca. Hai solo 10 secondi per prendere una decisione d'istinto: **Sottovalutato** o **Sopravvalutato**?

---

## 🌟 Caratteristiche Principali

- **Estetica Premium Glassmorphism**: Interfaccia scura opaca responsiva, ottimizzata sia per schermi mobili che desktop (con visualizzazione a scocca di smartphone).
- **Sfondo Dinamico**: Glowing orbs animati che fluttuano sullo sfondo.
- **Timer di Precisione a 60 FPS**: Barra temporale ad alta fedeltà che cambia colore e pulsa (Verde -> Arancione -> Rosso) all'avvicinarsi dello scadere del tempo.
- **Motore di Animazioni Sussultorie**: Zoom-in alternato dei pulsanti durante la "Fase Panico" (secondi 5.0 - 10.0) a intervalli di 1.5s.
- **Sintetizzatore Audio (Web Audio API)**:
  - Ticchettio orologio accelerato nella fase di panico.
  - Suoni di feedback chimes differenziati per le scelte.
  - Buzzer calante in caso di timeout.
  *Non richiede file audio esterni, funziona interamente via codice!*
- **Rivelazione delle Statistiche Globali**: Transizione fluida che mostra le percentuali storiche globali aggregate.
- **Riepilogo del Mazzo**: Visualizzazione finale dei verdetti espressi dal giocatore a completamento del mazzo tematico.

---

## 📂 Struttura del Progetto

- `index.html`: La struttura DOM dell'applicazione e delle sue 4 schermate.
- `style.css`: Il sistema di design, variabili di colore, layout responsivo e le animazioni CSS.
- `app.js`: Il motore logico in JavaScript, la gestione dello stato e del timer a 60 FPS.
- `decks.json`: Il database mock contenente le carte e i mazzi di gioco.
- `package.json`: Configurazione per abilitare il server di sviluppo locale.

---

## 🚀 Come Eseguire il Gioco

### Opzione 1: Server di Sviluppo Locale (Raccomandata)
Questa opzione è ideale per lo sviluppo e la simulazione realistica, in quanto carica dinamicamente i mazzi dal file `decks.json`.

1. Assicurati di avere [Node.js](https://nodejs.org/) installato sul PC.
2. Apri il terminale nella cartella `overunder-mvp`.
3. Installa le dipendenze di sviluppo (installa `lite-server`):
   ```bash
   npm install
   ```
4. Avvia il server:
   ```bash
   npm start
   ```
5. Il browser si aprirà automaticamente su `http://localhost:3000`.

### Opzione 2: Apertura Diretta (Nessuna Installazione Richiesta)
Se vuoi avviare il gioco all'istante senza installare nulla:
1. Fai semplicemente doppio clic sul file `index.html` per aprirlo nel browser (Chrome, Edge, Firefox, Safari).
2. *Nota di compatibilità*: Poiché i browser bloccano le chiamate fetch locali (CORS) quando si usa il protocollo `file://`, il gioco attiverà automaticamente un **meccanismo di fallback locale**, caricando i mazzi pre-caricati all'interno di `app.js`. Il funzionamento del gioco sarà comunque completo e identico in ogni aspetto!

---

## 🎮 Regole del Gioco

1. Inserisci il tuo nome nella schermata iniziale (campo obbligatorio).
2. Seleziona uno dei tre mazzi tematici disponibili:
   - **🔥 Gli Intoccabili**
   - **📱 Cultura & Trend**
   - **👔 Vita da Ufficio**
3. Clicca su **START GAME**.
4. Hai 10 secondi a disposizione:
   - **Da 0.0s a 5.0s (Fase Statica)**: Elabora il testo.
   - **Da 5.0s a 10.0s (Fase Panico)**: I tasti inizieranno a zoomare alternativamente per indurti all'errore o alla fretta.
5. Se voti in tempo, il verdetto viene registrato e si entra nello stato di **Freeze**. Clicca su "VEDI RISULTATI".
6. Se scade il tempo, vieni punito dal sistema ed eletto come **"Giustamente Valutato (Tempo Scaduto)"** in grigio asfalto.
7. Nella schermata dei risultati, clicca su *"E il resto del mondo?"* per svelare se sei d'accordo con la maggior parte della popolazione mondiale.
8. Premi *"Prossima Carta"* per continuare. Alla fine del mazzo, potrai visualizzare il riepilogo finale delle tue risposte.
