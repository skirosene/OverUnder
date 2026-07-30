#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generatore del Mazzo Unico da 10.000 carte per OverUnder.

REGOLA FONDAMENTALE: Ogni carta deve superare il test
"Per me [X] è sopravvalutato / sottovalutato"

STRUTTURE AMMESSE:
- Sostantivi plurali: "Gli smartwatch", "I tatuaggi"
- Concetti singoli: "Il bidet", "La carbonara", "TikTok"
- Trend/abitudini: "Lavorare da remoto", "Il pisolino pomeridiano"
- Paragoni SENSATI (stessa categoria): "Android vs Apple"

STRUTTURE VIETATE:
- Verbi d'azione complessi: "Mangiare X con Y alle 3 di notte"
- Paragoni assurdi: "Preferire Google alle cuffie wireless"
- Combinazioni template random
"""

import json
import random

DECKS_FILE = r"c:\Users\matteo.sciri\OneDrive - LUTECH SPA\Desktop\overunder-mvp\decks.json"

# ==============================================================================
# MEGA-LISTA DI CONCETTI CURATI A MANO (Ogni voce passa il test "Per me X è sopravvalutato")
# ==============================================================================

CONCETTI = [
    # ─── PERSONAGGI STORICI E FAMOSI ───
    "Napoleone Bonaparte", "Giulio Cesare", "Cleopatra", "Winston Churchill", "Giuseppe Garibaldi",
    "Mahatma Gandhi", "Alessandro Magno", "Maria Antonietta", "Karl Marx", "John F. Kennedy",
    "Elisabetta II", "Barack Obama", "Silvio Berlusconi", "Albert Einstein", "Isaac Newton",
    "Galileo Galilei", "Sigmund Freud", "Friedrich Nietzsche", "Socrate", "Platone",
    "Aristotele", "Marie Curie", "Leonardo da Vinci", "Stephen Hawking", "Alan Turing",
    "Nikola Tesla", "Cristoforo Colombo", "Marco Polo", "Giulio Andreotti", "Che Guevara",
    "Nelson Mandela", "Martin Luther King", "Dalai Lama", "Madre Teresa", "Gengis Khan",
    "Nerone", "Marilyn Monroe", "Lady Diana", "Rosa Parks", "Steve Jobs", "Bill Gates",
    "Elon Musk", "Mark Zuckerberg", "Jeff Bezos", "Warren Buffett", "Henry Ford",
    "Giovanna d'Arco", "George Washington", "William Shakespeare", "Dante Alighieri",
    "Wolfgang Amadeus Mozart", "Ludwig van Beethoven", "Vincent van Gogh", "Pablo Picasso",
    "Michelangelo Buonarroti", "Rita Levi-Montalcini", "Charles Darwin",

    # ─── ATTORI, REGISTI, COMICI ───
    "Leonardo DiCaprio", "Brad Pitt", "Johnny Depp", "Meryl Streep", "Sophia Loren",
    "Al Pacino", "Robert De Niro", "Keanu Reeves", "Jim Carrey", "Checco Zalone",
    "Carlo Verdone", "Christian De Sica", "Quentin Tarantino", "Stanley Kubrick", "Steven Spielberg",
    "Federico Fellini", "Christopher Nolan", "Martin Scorsese", "Alfred Hitchcock", "Woody Allen",
    "Tom Hanks", "Morgan Freeman", "Denzel Washington", "Scarlett Johansson", "Margot Robbie",
    "Timothée Chalamet", "Adam Sandler", "Will Smith", "Dwayne Johnson", "Ryan Gosling",
    "Massimo Troisi", "Roberto Benigni", "Alberto Sordi", "Totò", "Aldo Giovanni e Giacomo",
    "Ficarra e Picone", "Lillo e Greg", "Corrado Guzzanti", "Virginia Raffaele", "Luciana Littizzetto",

    # ─── MUSICISTI E CANTANTI ───
    "The Beatles", "Queen", "Michael Jackson", "Freddie Mercury", "David Bowie",
    "Pink Floyd", "Nirvana", "Eminem", "Daft Punk", "Vasco Rossi", "Ligabue",
    "Adriano Celentano", "Fabrizio De André", "Måneskin", "Sfera Ebbasta", "Fedez",
    "Mina", "Laura Pausini", "Calcutta", "Salmo", "Gigi D'Agostino", "Chiara Ferragni",
    "Taylor Swift", "Beyoncé", "Lady Gaga", "Rihanna", "Billie Eilish",
    "Kanye West", "Drake", "Ed Sheeran", "Justin Bieber", "Ariana Grande", "Dua Lipa",
    "Orietta Berti", "Gianni Morandi", "Max Pezzali", "Caparezza", "Rino Gaetano",
    "Lucio Battisti", "Lucio Dalla", "Claudio Baglioni", "Renato Zero", "Jovanotti",
    "Marracash", "Ghali", "Annalisa", "Elodie", "Angelina Mango", "Geolier",
    "Bob Marley", "Elvis Presley", "Frank Sinatra", "Amy Winehouse", "Adele",
    "Bruno Mars", "The Weeknd", "Kendrick Lamar", "Post Malone", "Travis Scott",
    "Arctic Monkeys", "Radiohead", "Coldplay", "U2", "AC/DC", "Led Zeppelin",
    "Rolling Stones", "Red Hot Chili Peppers", "Foo Fighters", "Gorillaz",

    # ─── CONDUTTORI, INFLUENCER, PERSONAGGI TV ───
    "Khaby Lame", "Luis Sal", "Gerry Scotti", "Amadeus", "Maria De Filippi",
    "Paolo Bonolis", "Piero Angela", "Alberto Angela", "Alessandro Barbero",
    "Cristiano Malgioglio", "Fabio Fazio", "Carlo Conti", "Barbara D'Urso",
    "Mara Venier", "Fiorello", "Pippo Baudo",

    # ─── SPORTIVI ───
    "Diego Armando Maradona", "Pelé", "Lionel Messi", "Cristiano Ronaldo", "Michael Jordan",
    "LeBron James", "Kobe Bryant", "Valentino Rossi", "Lewis Hamilton", "Roger Federer",
    "Rafael Nadal", "Usain Bolt", "Muhammad Ali", "Mike Tyson", "Francesco Totti",
    "Jannik Sinner", "Federica Pellegrini", "Zlatan Ibrahimovic", "Michael Schumacher",
    "Novak Djokovic", "Gianluigi Buffon", "Roberto Baggio", "Alex Del Piero",
    "Bebe Vio", "Serena Williams", "Tiger Woods", "Andrea Pirlo", "Gennaro Gattuso",
    "Marco Pantani", "Ayrton Senna", "Gianmarco Tamberi", "Marcell Jacobs",
    "Filippo Ganna", "Sofia Goggia",

    # ─── FILM, SERIE TV, CARTONI, ANIME ───
    "Il Padrino", "Pulp Fiction", "Forrest Gump", "Titanic", "Inception",
    "Interstellar", "Il Signore degli Anelli", "Harry Potter", "Star Wars", "Matrix",
    "Fight Club", "Il Gladiatore", "Shutter Island", "Avatar", "Il Cavaliere Oscuro",
    "Breaking Bad", "Stranger Things", "Game of Thrones", "Black Mirror", "The Office",
    "Friends", "I Simpson", "I Griffin", "South Park", "Futurama",
    "Squid Game", "La Casa di Carta", "Lost", "How I Met Your Mother", "Sex Education",
    "Gomorra", "Boris", "Suburra", "Mare Fuori", "Nuovo Cinema Paradiso",
    "La vita è bella", "La grande bellezza", "Peppa Pig", "Shrek", "Toy Story",
    "SpongeBob", "Rick and Morty", "BoJack Horseman",
    "Naruto", "Dragon Ball", "One Piece", "Death Note", "Attack on Titan",
    "Neon Genesis Evangelion", "Demon Slayer", "La città incantata",
    "Inside Out", "Monsters & Co.", "Spider-Man", "Batman", "Iron Man",
    "The Mandalorian", "Peaky Blinders", "The Crown", "Euphoria",
    "Succession", "Ted Lasso", "Wednesday", "The Last of Us",

    # ─── CIBO E GASTRONOMIA ───
    "La pizza margherita", "La carbonara", "Il sushi", "Il kebab", "La lasagna della domenica",
    "La pizza con l'ananas", "Il cappuccino dopo pranzo", "La piadina romagnola",
    "La Nutella", "Il gelato al pistacchio", "Il tiramisù", "La Coca-Cola Zero",
    "Il chinotto", "Il pandoro", "Il panettone coi canditi", "Il cornetto al pistacchio",
    "La parmigiana di melanzane", "La frittata di pasta avanzata", "I taralli pugliesi",
    "Il caffè espresso al bar", "Il babà al rum", "La focaccia barese",
    "Il pesto alla genovese", "Il poke hawaiano", "I cannoli siciliani",
    "La cotoletta alla milanese", "La fiorentina al sangue", "L'aperol spritz",
    "Il gin tonic", "L'avocado toast", "Il latte d'avena", "La maionese sulla pizza",
    "Il cibo super piccante", "La burrata pugliese", "La granita siciliana",
    "La sfogliatella napoletana", "Il pasticciotto leccese", "Gli gnocchi alla sorrentina",
    "Le orecchiette alle cime di rapa", "Lo speck altoatesino",
    "La bresaola della Valtellina", "La mortadella di Bologna", "Il prosciutto di Parma",
    "Il Parmigiano Reggiano", "La mozzarella di bufala", "Il gorgonzola",
    "La polenta", "Il risotto ai funghi", "Gli arrosticini abruzzesi",
    "La trippa", "Il lampredotto", "Il cous cous trapanese", "La caponata siciliana",
    "Il supplì romano", "La porchetta", "Il pane carasau", "Il culatello di Zibello",
    "La cacio e pepe", "L'amatriciana", "La gricia", "La pasta e fagioli",
    "Il minestrone", "La ribollita toscana", "La pappa al pomodoro",
    "I tortellini in brodo", "I ravioli fatti a mano", "Le trofie al pesto",
    "La bistecca alla brace", "Il fritto misto", "Le patatine fritte",
    "Gli hamburger gourmet", "I tacos", "Il ramen giapponese", "Il pad thai",
    "La paella spagnola", "Il fish and chips", "Il croissant francese",
    "Il pretzel tedesco", "La feta greca", "Il guacamole", "Il curry indiano",
    "Il kimchi coreano", "Il bubble tea", "Il matcha latte",

    # ─── BRAND, TECH E SOCIAL ───
    "TikTok", "Instagram", "Twitter / X", "WhatsApp", "Tinder",
    "Facebook", "ChatGPT", "Wikipedia", "Linux", "Windows 11",
    "L'iPhone", "I dispositivi Android", "Alexa", "I droni", "Gli smartwatch",
    "Il Metaverso", "I Bitcoin", "Lo smart working", "La realtà virtuale",
    "Le tastiere meccaniche", "Gli NFT", "BeReal", "Duolingo", "Telegram",
    "Spotify Premium", "Netflix", "YouTube", "LinkedIn", "Reddit",
    "Amazon", "Google", "Apple", "Microsoft", "PlayStation 5",
    "Xbox Series X", "Nintendo Switch", "Il PC da gaming", "I visori VR",
    "La domotica", "Il Face ID", "Zoom", "Pinterest", "Canva",
    "Subito.it", "Vinted", "Shein", "Ikea", "Lidl", "Esselunga",
    "McDonald's", "Starbucks", "Zara", "H&M", "Nike", "Adidas",
    "Tesla", "Ferrari", "Fiat Panda", "Vespa",

    # ─── OGGETTI E PRODOTTI ───
    "Il bidet", "Le infradito", "La moka Bialetti", "Lo spazzolino elettrico",
    "Il Nokia 3310", "Le Crocs", "Il Tamagotchi", "Le coperte ponderate",
    "Il robot aspirapolvere", "Le candele profumate", "I calzini coi sandali",
    "La borraccia termica", "La friggitrice ad aria", "La borsa dell'acqua calda",
    "Le cuffie con cancellazione del rumore", "Le fotocamere usa e getta",
    "Il Kindle", "Gli occhiali da sole firmati", "Le sneakers da collezione",
    "Le borse firmate", "I profumi costosi", "Le cover per smartphone",
    "I Power Bank", "Le AirPods", "Le penne stilografiche",
    "I Post-it", "Lo scotch trasparente", "Il giradischi",
    "Le polaroid", "I puzzle da 1000 pezzi", "I Lego da adulti",
    "Le action figure", "Le carte Pokémon", "I vinili in edizione limitata",

    # ─── ABITUDINI, TREND E STILE DI VITA ───
    "Il pisolino pomeridiano", "Svegliarsi alle 5 del mattino",
    "Il detox digitale", "Fare la spesa online", "Rifare il letto ogni mattina",
    "Il digiuno intermittente", "Lo yoga", "La meditazione", "Il crossfit",
    "Andare in palestra", "La corsa mattutina", "Lavorare da remoto",
    "La settimana lavorativa di 4 giorni", "Trasferirsi all'estero",
    "Vivere da soli", "Andare a vivere in campagna", "Vivere in centro città",
    "Tornare a vivere dai genitori", "L'anno sabbatico",
    "Il gap year prima dell'università", "Le vacanze studio all'estero",
    "Il volontariato", "La raccolta differenziata",
    "Il car sharing", "Il carpooling", "Andare a lavoro in bici",
    "L'auto elettrica", "Il monopattino elettrico",
    "Fare jogging col cane", "Portare il pranzo da casa",
    "Il meal prep della domenica", "La dieta vegana", "La dieta chetogenica",
    "Il cibo biologico", "I prodotti a km zero", "Il commercio equo e solidale",
    "Comprare vestiti usati", "Il vintage", "Il minimalismo",
    "Il decluttering", "La slow life", "L'ASMR",
    "Il journaling", "Il bullet journal", "La skincare coreana",
    "I tatuaggi", "I piercing", "Le unghie gel",
    "Le extension per capelli", "L'abbronzatura artificiale",
    "La chirurgia estetica", "Il botox",

    # ─── SITUAZIONI SOCIALI E QUOTIDIANE ───
    "L'applauso all'atterraggio", "Arrivare in aeroporto 4 ore prima",
    "Il buffet della colazione in hotel", "L'aperitivo sui Navigli",
    "Il calcetto del lunedì sera", "Il silenzio in ascensore",
    "Il pranzo della domenica coi parenti", "Le chiamate senza preavviso",
    "I regali dell'ultimo minuto", "I regali fatti a mano",
    "Lo small talk sul meteo", "Dividere il conto alla romana",
    "Lasciare la mancia", "Arrivare sempre in ritardo",
    "I messaggi vocali da 5 minuti", "Le chat di gruppo su WhatsApp",
    "Le riunioni che potevano essere un'email", "Il caffè della macchinetta in ufficio",
    "Lavorare il venerdì pomeriggio", "Le email di lavoro formali",
    "Il colloquio di lavoro", "Il primo giorno di lavoro",
    "Le cene aziendali", "Il Secret Santa in ufficio",
    "Le feste di laurea", "I matrimoni sfarzosi",
    "Le feste di compleanno a sorpresa", "Le cresime e le comunioni",
    "Il battesimo dei figli degli amici", "I pranzi di Natale infiniti",
    "Il cenone di Capodanno", "La tombola a Natale",
    "Il veglione di San Silvestro", "Halloween in Italia",
    "San Valentino", "La Festa della Mamma", "Il Primo Maggio",
    "Il ponte del 25 aprile", "Ferragosto al mare",

    # ─── VIAGGI E VACANZE ───
    "Le vacanze in campeggio", "I voli low cost", "Gli hotel all-inclusive",
    "Disneyland", "I musei d'arte contemporanea", "Le spiagge affollate ad agosto",
    "Le vacanze in montagna d'estate", "I viaggi da soli", "Le crociere",
    "I mercatini di Natale", "Le terme", "I viaggi in pullman",
    "I treni ad alta velocità", "Le code in autostrada",
    "Dormire in ostello", "L'Airbnb", "Il glamping",
    "Il road trip in America", "L'Interrail in Europa",
    "Le vacanze in Grecia", "Le vacanze in Spagna",
    "Il viaggio in Giappone", "New York a Natale",
    "Le Maldive", "Bali", "Londra", "Parigi", "Barcellona",
    "Amsterdam", "Praga", "Istanbul",
    "La Costiera Amalfitana", "Le Cinque Terre", "La Sardegna",
    "La Sicilia", "Le Dolomiti", "Il Lago di Como",
    "Napoli", "Roma", "Firenze", "Venezia", "Milano",

    # ─── INTRATTENIMENTO E CULTURA ───
    "I concerti negli stadi", "I festival musicali", "Il Coachella",
    "Sanremo", "L'Eurovision", "Il Festival di Cannes",
    "I podcast di true crime", "I podcast storici", "I video ASMR",
    "Gli anime giapponesi", "I manga", "I videogiochi open-world",
    "Fortnite", "Minecraft", "GTA", "FIFA / EA FC", "Call of Duty",
    "I cinepanettoni", "I film Marvel", "I film DC",
    "I film horror", "I film d'autore", "Le commedie romantiche",
    "I documentari Netflix", "I reality show",
    "Il Grande Fratello", "L'Isola dei Famosi", "Temptation Island",
    "X Factor", "MasterChef Italia", "Bake Off Italia",
    "Amici di Maria De Filippi", "Uomini e Donne",
    "La musica classica", "Il jazz", "La musica indie italiana",
    "La trap italiana", "Il reggaeton", "L'hip hop",
    "La musica techno", "La musica country", "Il K-pop",
    "Andare al cinema da soli", "Le maratone di serie TV",
    "I libri di self-help", "I libri fantasy", "I fumetti",
    "Gli audiolibri", "I club del libro",
    "I musei", "Le mostre d'arte", "Il teatro", "L'opera lirica",
    "Il circo", "I parchi divertimenti", "I parchi acquatici",
    "Le escape room", "Il karaoke", "Il biliardo",
    "Il bowling", "Il laser tag", "I giochi da tavolo",
    "Dungeons & Dragons", "Il Monopoly", "Risiko",

    # ─── SCUOLA E UNIVERSITÀ ───
    "L'università pubblica", "L'università privata", "L'Erasmus",
    "Il fuoricorso", "La tesi di laurea", "Gli esami universitari",
    "Il liceo classico", "Il liceo scientifico", "Le scuole private",
    "I compiti a casa", "Le interrogazioni a sorpresa",
    "La gita scolastica", "La mensa scolastica",
    "Il professore severo", "La ricreazione",
    "Le ripetizioni private", "I corsi di lingua online",

    # ─── LAVORO E CARRIERA ───
    "Lo stage non retribuito", "Il posto fisso",
    "La libera professione", "La partita IVA",
    "Le startup", "Il networking professionale",
    "I colloqui su Zoom", "Il curriculum creativo",
    "I corsi di formazione aziendali", "Il team building",
    "L'happy hour aziendale", "Lo smartworking in pigiama",

    # ─── CASA E QUOTIDIANITÀ ───
    "I mobili Ikea", "Il divano ad angolo", "La TV da 65 pollici",
    "L'aria condizionata", "Il riscaldamento a pavimento",
    "Le piante d'appartamento", "L'orto sul balcone",
    "La lavastoviglie", "L'aspirapolvere Dyson", "Il Roomba",
    "Le pulizie di primavera", "Il cambio degli armadi",
    "Il trasloco", "La convivenza",
    "Comprare casa", "Stare in affitto",
    "Ristrutturare casa", "Il mutuo trentennale",

    # ─── SPORT E FITNESS ───
    "La Serie A", "La Champions League", "Il Mondiale di calcio",
    "Le Olimpiadi", "Il Super Bowl", "La Formula 1",
    "Il MotoGP", "Il Tour de France", "Il Giro d'Italia",
    "Il tennis", "Il padel", "Il golf", "Il surf",
    "Lo sci", "Lo snowboard", "L'arrampicata sportiva",
    "Il running", "Le maratone", "Il triathlon",
    "La pallavolo", "Il basket", "Il rugby",
    "Le arti marziali", "Il pugilato", "Il nuoto",
    "Lo spinning", "Il pilates", "La zumba",
    "I personal trainer", "Le palestre low cost",
    "Le scarpe da running tecniche",

    # ─── ANIMALI ───
    "I gatti", "I cani", "I cani di piccola taglia",
    "I gatti persiani", "I golden retriever",
    "I pesci rossi", "Le tartarughe domestiche",
    "I pappagalli", "I criceti", "I conigli nani",
    "I rettili come animali domestici", "Adottare un animale dal canile",
    "Il dog sitter", "Il cat café", "Le cucce per cani firmate",

    # ─── SOLDI E FINANZA ───
    "Le criptovalute", "Gli investimenti in borsa",
    "Il conto corrente online", "Le carte prepagate",
    "Il cashback", "I buoni pasto",
    "Le assicurazioni sulla vita", "Il fondo pensione",
    "Pagare col contactless", "Pagare in contanti",
    "La mancia obbligatoria", "Il Black Friday",
    "I saldi di gennaio", "Il Prime Day di Amazon",
    "Le rate a tasso zero", "Il leasing",

    # ─── SALUTE E BENESSERE ───
    "La medicina alternativa", "L'agopuntura", "L'omeopatia",
    "Il fisioterapista", "Lo psicologo",
    "La terapia di coppia", "Il coaching motivazionale",
    "Le app per la meditazione", "I braccialetti fitness",
    "Le vitamine e gli integratori",
    "Il sonno polifasico", "Dormire 8 ore a notte",

    # ─── MODA E STILE ───
    "La moda fast fashion", "La moda sostenibile",
    "Le scarpe col tacco alto", "Le sneakers bianche",
    "Il total black", "I jeans strappati",
    "Il vintage chic", "Lo streetwear",
    "Le borse di lusso", "Gli orologi di lusso",
    "I Rolex", "Le Ray-Ban", "Le Birkenstock",
    "Le New Balance", "Le Stan Smith",
    "Il trench", "Il bomber", "La felpa con cappuccio",
    "I leggins come pantaloni", "Il pigiama fuori casa",

    # ─── PARAGONI SENSATI (stessa categoria) ───
    "Android vs Apple", "Netflix vs Disney+", "Spotify vs Apple Music",
    "PlayStation vs Xbox", "PC vs Console", "Il treno vs l'aereo",
    "Il mare vs la montagna", "Il cane vs il gatto",
    "Il pandoro vs il panettone", "La pizza napoletana vs la pizza romana",
    "La carbonara vs la cacio e pepe", "Il caffè al bar vs il caffè a casa",
    "Il libro cartaceo vs l'ebook", "Il cinema vs lo streaming",
    "Il Natale in famiglia vs Capodanno con gli amici",
    "Comprare casa vs stare in affitto", "L'università vs andare a lavorare subito",
    "Roma vs Milano", "Napoli vs Palermo", "Firenze vs Venezia",
    "La Serie A vs la Premier League", "Il calcio vs il basket",
    "McDonald's vs Burger King", "Coca-Cola vs Pepsi",
    "WhatsApp vs Telegram", "Google vs Bing",
    "Il sushi vs la pizza", "L'estate vs l'inverno",
    "La mattina vs la sera", "Il lunedì vs il venerdì",
    "Viaggiare da soli vs viaggiare in compagnia",
    "La campagna vs la città",

    # ─── TEMI SOCIALI E GENERAZIONALI ───
    "I Millennials", "La Gen Z", "I Boomer",
    "La nostalgia degli anni '90", "La nostalgia degli anni 2000",
    "I meme di internet", "La cancel culture",
    "Il politically correct", "Il femminismo moderno",
    "L'ambientalismo", "Greta Thunberg",
    "Il cambiamento climatico", "L'energia nucleare",
    "I pannelli solari", "Le auto elettriche",
    "La raccolta differenziata estrema",
    "I vegani militanti", "Il body positivity",
    "Il quiet quitting", "Il work-life balance",
    "I nomadi digitali", "La gig economy",
    "Le grandi dimissioni", "La sindrome dell'impostore",

    # ─── CONCETTI E FENOMENI CULTURALI ITALIANI ───
    "Il Made in Italy", "La Dolce Vita", "L'arte di arrangiarsi",
    "Il campanilismo", "La scaramanzia", "Il malocchio",
    "La raccomandazione", "La burocrazia italiana",
    "Le Poste Italiane", "Trenitalia", "L'autostrada italiana",
    "Il telegiornale della sera", "La Gazzetta dello Sport",
    "Il Corriere della Sera", "La Repubblica",
    "Il Festival di Sanremo", "Il Grande Fratello VIP",
    "Le sagre di paese", "Le processioni religiose",
    "Il Palio di Siena", "Il Carnevale di Venezia",
    "Il presepe fatto a mano", "L'albero di Natale",
    "La Befana", "L'uovo di Pasqua",

    # ─── TRASPORTI E MOBILITÀ ───
    "Il motorino a 14 anni", "La patente B", "La macchina usata come prima auto",
    "Il SUV in città", "La smart in doppia fila", "Il parcheggio in centro",
    "Uber", "I taxi", "Flixbus", "Ryanair", "La prima classe in aereo",
    "L'autostop", "Il camper", "La bicicletta elettrica",
    "I parcheggiatori abusivi", "Le ZTL",
    "La metro di Milano", "La metro di Roma", "Il tram",

    # ─── EXTRA CONCETTI POP E QUOTIDIANI ───
    "Le suocere", "I piccioni", "Le zanzare d'estate",
    "La fila alle poste", "La fila al supermercato",
    "Le pubblicità su YouTube", "I cookie dei siti web",
    "Le newsletter via email", "Le telefonate dei call center",
    "Il codice fiscale", "La dichiarazione dei redditi",
    "Il 730 precompilato", "Le bollette del gas",
    "Il condominio", "Le riunioni di condominio",
    "Il vicino rumoroso", "Il parcheggio condominiale",
    "La domenica senza auto", "Le piste ciclabili",
    "Lo sharing delle bici", "I semafori intelligenti",
    "La fibra ottica", "Il 5G",
    "La password complessa", "L'autenticazione a due fattori",
    "Le notifiche push", "Lo spam",
    "Gli influencer", "I micro-influencer", "Gli youtuber",
    "I content creator", "I food blogger",
    "Le foto del cibo su Instagram", "I selfie",
    "I filtri di bellezza", "Le storie di Instagram",
    "I reel", "I TikTok virali",
    "I trend di TikTok", "Le challenge di internet",
    "I tutorial di trucco", "I video unboxing",
    "Le recensioni online", "Le stelle su TripAdvisor",
    "Le recensioni a 1 stella su Google", "Il passaparola",
    "Le app di dating", "Bumble", "Hinge", "Grindr",
    "Le coppie che si conoscono online", "Il primo appuntamento al bar",
    "Il ghosting", "Il breadcrumbing", "La situationship",
    "Il friend zone", "L'amore a distanza",
    "Le vacanze di coppia", "Il viaggio di nozze",
    "La convivenza prima del matrimonio",
    "I figli unici", "Le famiglie numerose",
    "I nonni che viziano i nipoti",

    # ─── MISCELLANEA DI CONCETTI UNIVERSALI ───
    "La fortuna", "Il destino", "Il karma",
    "La superstizione", "L'oroscopo", "I segni zodiacali",
    "I sogni lucidi", "Il déjà vu",
    "La procrastinazione", "Il perfezionismo",
    "L'ansia da prestazione", "La FOMO",
    "Il multitasking", "La produttività tossica",
    "La gratitudine", "La gentilezza con gli sconosciuti",
    "Il volontariato", "La beneficenza",
    "Il gioco d'azzardo", "Le slot machine",
    "Il Superenalotto", "I Gratta e Vinci",
    "Le scommesse sportive", "Il poker texano",
    "Le escape room", "I quiz televisivi",
    "Chi vuol essere milionario", "L'Eredità",
    "La Ruota della Fortuna", "Affari Tuoi",
    "Le parole crociate", "Il Sudoku",
    "Wordle", "Candy Crush",

    # ─── PIATTI E BEVANDE EXTRA ───
    "L'espresso al bancone", "Il caffè americano", "Il cappuccino col latte di soia",
    "Il caffè freddo shakerato", "La cioccolata calda con panna",
    "Il vin brulé", "La grappa", "Il limoncello", "L'amaro del Capo",
    "Il Campari Soda", "Il Negroni", "Il Prosecco", "Lo Champagne",
    "Il vino rosso toscano", "La birra artigianale", "Le IPA",
    "Il mojito", "La sangria", "Il Moscow Mule", "Lo Hugo",
    "Il tè verde", "Il tè nero", "L'acqua frizzante",
    "La spremuta d'arancia", "Il centrifugato",
    "Il frullato proteico", "Gli energy drink",
    "La Red Bull", "Il Monster Energy",
    "I succhi di frutta in brick", "L'acqua del rubinetto",

    # ─── CONCETTI DI TENDENZA ───
    "L'intelligenza artificiale", "I robot domestici",
    "Le stampanti 3D", "I droni per le consegne",
    "La guida autonoma", "Lo spazio commerciale",
    "SpaceX", "La Luna come destinazione turistica",
    "Il turismo spaziale", "Neuralink",
    "Il lavoro da freelance", "Il coworking",
    "Gli spazi di co-living", "Le tiny house",
    "Le case container", "Il van life",
    "Il glamping", "Il workation",
    "Il digital nomad", "Il ritorno alla natura",

    # ─── GIOCHI E PASSATEMPI ───
    "La playstation vintage", "Il Game Boy", "Il Nintendo 64",
    "La Wii", "I giochi arcade", "Il flipper",
    "Il biliardino", "Il ping pong", "Il frisbee",
    "L'aquilone", "I castelli di sabbia", "Le biglie",
    "Le figurine Panini", "Gli album di figurine",
    "Le carte da gioco napoletane", "Il burraco",
    "La briscola", "La scopa", "Il tressette",
    "Gli scacchi", "La dama", "Il backgammon",
    "Il Risiko", "Il Trivial Pursuit", "Il Taboo",
    "Il Pictionary", "Il Dixit", "Il Catan",
    "Uno", "Il Jenga",

    # ─── MOMENTI QUOTIDIANI ───
    "Il caffè della mattina", "La colazione al bar",
    "Il pranzo in pausa lavoro", "L'aperitivo del venerdì",
    "La cena fuori il sabato sera", "La passeggiata dopo cena",
    "La domenica al mare", "Il lunedì mattina",
    "Il venerdì sera", "La notte di Capodanno",
    "Il primo giorno di vacanza", "L'ultimo giorno di vacanza",
    "Il ritorno dalle ferie", "La scuola che ricomincia a settembre",
    "Le giornate di pioggia", "Le giornate di sole in inverno",
    "La prima neve", "Il profumo di pioggia",
    "Il tramonto al mare", "L'alba in montagna",

    # ─── FENOMENI DEL WEB ───
    "Wikipedia", "I tutorial su YouTube",
    "Le teorie del complotto online", "Le fake news",
    "I deepfake", "I bot sui social",
    "Il dark web", "La privacy online",
    "Le VPN", "Gli adblocker",
    "Il GDPR", "I termini e condizioni che nessuno legge",
    "Le password salvate nel browser",
    "Il cloud storage", "Google Drive vs Dropbox",
    "Notion", "Trello", "Slack",

    # ─── TRADIZIONI E RITUALI ───
    "Il caffè offerto al bar", "Il cornetto portafortuna",
    "Il ferro di cavallo", "Il gatto nero che attraversa la strada",
    "Rompere uno specchio", "Il numero 17",
    "Il sale versato", "L'ombrello aperto in casa",
    "Il Capodanno cinese", "Il Ringraziamento americano",
    "Il Super Bowl come evento sociale", "La notte degli Oscar",
]


def generate_deck():
    """Genera il mazzo di 10.000 carte uniche."""
    cards = []
    used_prompts = set()
    card_id = 1

    # Rimuovi duplicati dalla lista base
    unique_concepts = []
    seen = set()
    for c in CONCETTI:
        c_stripped = c.strip()
        if c_stripped and c_stripped.lower() not in seen:
            seen.add(c_stripped.lower())
            unique_concepts.append(c_stripped)

    print(f"Concetti unici curati a mano: {len(unique_concepts)}")

    # Aggiungi tutti i concetti curati a mano
    for concept in unique_concepts:
        if concept.lower() not in used_prompts:
            underrated = random.randint(15, 85)
            cards.append({
                "card_id": f"c{card_id}",
                "prompt": concept,
                "global_stats": {
                    "underrated": underrated,
                    "overrated": 100 - underrated
                }
            })
            used_prompts.add(concept.lower())
            card_id += 1

    print(f"Carte dopo i concetti curati: {len(cards)}")

    # Se non bastano, generiamo altri concetti validi con template SEMPLICI
    # Questi sono tutti nella forma "[Articolo] [Sostantivo] [Qualificatore opzionale]"
    # Ogni carta passa il test: "Per me [X] è sopravvalutato"

    extra_concetti = [
        # ─── CIBI DEL MONDO ───
        "Il chili con carne", "Il gazpacho", "La fondue svizzera", "Il borscht russo",
        "Le empanadas", "Il ceviche", "Il falafel", "L'hummus", "Il gyros greco",
        "Le dim sum", "Gli involtini primavera", "Il pho vietnamita",
        "La zuppa di miso", "Il sashimi", "I nigiri", "I tempura",
        "Il bibimbap coreano", "Il naan indiano", "Il tikka masala",
        "Il döner kebab", "La shakshuka", "La baklava", "Il churro spagnolo",
        "Le crêpes francesi", "Lo strudel", "Il pretzel",
        "Le wonton soup", "Il biryani", "Il satay indonesiano",
        "Le arepas", "Il pão de queijo", "La polenta taragna",

        # ─── PROFESSIONI ───
        "Il medico di base", "L'avvocato", "L'architetto", "Il commercialista",
        "Il notaio", "Il farmacista", "L'ingegnere informatico", "Il data scientist",
        "Il social media manager", "Il giornalista", "Il fotografo professionista",
        "Lo chef stellato", "Il barista", "Il sommelier",
        "Il personal trainer", "Il fisioterapista",
        "L'insegnante di scuola superiore", "Il professore universitario",
        "Il pilota di linea", "Il vigile del fuoco",
        "L'astronauta", "Il poliziotto",
        "Il musicista di strada", "Il deejay",
        "Il tatuatore", "Il barbiere hipster",
        "L'interior designer", "Lo stylist",
        "Il wedding planner", "Il dog sitter professionista",

        # ─── CITTÀ ITALIANE E DEL MONDO ───
        "Torino", "Bologna", "Genova", "Palermo", "Catania", "Bari",
        "Verona", "Trieste", "Perugia", "Cagliari", "Lecce", "Matera",
        "Bergamo", "Brescia", "Padova", "Pisa", "Siena", "Lucca",
        "Amalfi", "Positano", "Capri", "Ischia", "Pantelleria",
        "Tokyo", "Seoul", "Bangkok", "Dubai", "Los Angeles", "San Francisco",
        "Miami", "Chicago", "Toronto", "Sydney", "Melbourne",
        "Rio de Janeiro", "Buenos Aires", "Città del Messico",
        "Berlino", "Vienna", "Zurigo", "Lisbona", "Atene",
        "Marrakech", "Il Cairo", "Cape Town", "Singapore", "Hong Kong",

        # ─── MARCHE E PRODOTTI SPECIFICI ───
        "La Nutella vs la crema Novi", "Barilla vs De Cecco",
        "Mulino Bianco", "Kinder", "Ferrero Rocher",
        "Il Cornetto Algida", "Il Magnum", "Il Cucciolone",
        "La Fanta", "La Sprite", "L'Estathé", "Il Crodino",
        "La San Pellegrino", "La Ferrarelle", "La Levissima",
        "La Peroni", "La Moretti", "L'Ichnusa",
        "Il Parmigiano vs il Grana Padano",

        # ─── ESPERIENZE E MOMENTI DI VITA ───
        "Il primo bacio", "Il primo stipendio",
        "La prima macchina", "La prima casa",
        "Il diploma di maturità", "La laurea",
        "Il matrimonio in spiaggia", "Il matrimonio in chiesa",
        "La nascita del primo figlio", "I 18 anni",
        "I 30 anni", "I 40 anni", "I 50 anni",
        "La pensione", "Il pensionamento anticipato",
        "Cambiare lavoro dopo i 40 anni", "Ricominciare da zero",
        "Il divorzio", "La separazione consensuale",
        "L'amicizia tra uomo e donna", "Gli amici d'infanzia",
        "Gli amici dell'università", "I colleghi che diventano amici",
        "La reunion del liceo dopo 20 anni",

        # ─── MEDIA E INFORMAZIONE ───
        "Il telegiornale delle 20", "Il giornale cartaceo",
        "Le edicole", "I quotidiani online",
        "I giornalisti sportivi", "I commentatori del lunedì",
        "Le pagine di meme su Instagram", "Reddit Italia",
        "I forum online", "I gruppi Facebook di quartiere",
        "I canali Telegram di sconti", "Le newsletter su Substack",
        "I blog personali", "I vlog di viaggio",
        "Le dirette su Twitch", "Lo streaming su Kick",

        # ─── RITUALI E ABITUDINI ITALIANE ───
        "La passeggiata serale in centro", "Lo struscio del sabato",
        "Il gelato dopo cena", "La granita con brioche",
        "Il caffè sospeso", "Il cornetto e cappuccino al bar",
        "La pizza del sabato sera", "L'aperitivo delle 18",
        "La partita allo stadio", "La partita al bar",
        "La schedina del Totocalcio", "Il Fantacalcio",
        "La settimana enigmistica", "Le parole crociate in spiaggia",
        "Il Gratta e Vinci al tabacchino", "Le figurine dei calciatori",

        # ─── OGGETTI NOSTALGICI ───
        "Il walkman", "Il floppy disk", "La cassetta VHS",
        "Il modem 56k", "MSN Messenger", "Il diario scolastico",
        "La penna a 4 colori", "La gomma che bucava i fogli",
        "Gli adesivi dei calciatori", "Le schede telefoniche",
        "Le cabine telefoniche", "Il telefono a gettoni",
        "Il MiniDisc", "L'iPod", "L'iPod Shuffle",
        "Il Motorola Razr", "Il BlackBerry",
        "Il Game Boy Color", "Il Tetris",
        "Snake sul Nokia", "I CD masterizzati",
        "Le musicassette", "Le enciclopedie cartacee",
        "Le Pagine Gialle", "Il videoregistratore",

        # ─── CONCETTI ASTRATTI DISCUSSI ───
        "La meritocrazia", "Il talento naturale vs l'impegno",
        "L'intelligenza emotiva", "Il QI come misura di intelligenza",
        "La felicità come obiettivo di vita", "Il successo professionale",
        "La fama", "I soldi come metro di giudizio",
        "La bellezza come privilegio", "L'età come numero",
        "La libertà di parola senza limiti", "Il diritto all'oblio",
        "La memoria storica", "La tradizione vs l'innovazione",
        "Il progresso tecnologico", "La globalizzazione",
        "Il patriottismo", "L'identità nazionale",
        "La nostalgia", "Il buon tempo andato",

        # ─── TENDENZE ALIMENTARI ───
        "Il brunch", "L'aperitivo all'italiana",
        "La cena a lume di candela", "Lo street food",
        "Il food delivery", "Just Eat vs Deliveroo vs Glovo",
        "I ristoranti stellati", "Le trattorie di paese",
        "Gli all-you-can-eat cinesi", "Il buffet di sushi",
        "Le catene di ristoranti", "I ristoranti vegani",
        "I ristoranti fusion", "Le pizzerie a taglio romane",
        "I ristoranti gourmet", "La cucina molecolare",
        "Il chilometro zero", "I farmer's market",
        "Le box di cibo in abbonamento", "HelloFresh",

        # ─── TECNOLOGIA EXTRA ───
        "Gli AirPods Pro", "Le cuffie over-ear",
        "Il monitor ultrawide", "La standing desk",
        "La sedia ergonomica", "Il mouse ergonomico",
        "Il secondo schermo", "Il proiettore per home cinema",
        "La soundbar", "L'impianto Dolby Atmos in casa",
        "La domotica Alexa vs Google Home", "Il termostato smart",
        "Le lampadine smart", "Le serrature smart",
        "Le telecamere di sicurezza", "Il videocitofono smart",
        "Il NAS personale", "Il backup automatico",
        "Le VPN per lo streaming", "Il jailbreak",

        # ─── HOBBY E CREATIVITÀ ───
        "La fotografia analogica", "La fotografia su smartphone",
        "Il fai da te", "Il bricolage", "La falegnameria amatoriale",
        "Il giardinaggio", "L'acquario tropicale",
        "La cucina come hobby", "La pasticceria fatta in casa",
        "Il pane fatto in casa", "La pasta fresca fatta a mano",
        "Il cucito creativo", "Il lavoro a maglia",
        "L'uncinetto", "Il macramè",
        "La pittura ad acquerello", "Il disegno digitale",
        "La ceramica", "La calligrafia",
        "Lo scrapbooking", "Il modellismo",
        "L'astronomia amatoriale", "Il birdwatching",
        "La pesca sportiva", "La caccia",
        "La raccolta dei funghi", "Le passeggiate in montagna",
        "Il trekking", "L'alpinismo", "Il trail running",

        # ─── ABBIGLIAMENTO E ACCESSORI EXTRA ───
        "Le giacche di pelle", "Il giubbotto di jeans",
        "La camicia hawaiana", "I pantaloni cargo",
        "Le tute da ginnastica come outfit quotidiano",
        "I cappelli di lana", "Le sciarpe di cashmere",
        "Gli zaini vs le borse a tracolla", "I marsupi",
        "Le ciabatte Adidas", "Le Converse All Star",
        "Le Vans Old Skool", "Le Nike Air Max",
        "Le Jordan", "Le Yeezy",
        "Gli occhiali da vista come accessorio moda",
        "I braccialetti portafortuna", "Le collane con iniziale",

        # ─── TRASPORTI E AUTO EXTRA ───
        "La Fiat 500", "La Mini Cooper", "La Jeep Renegade",
        "La Volkswagen Golf", "La Toyota Yaris",
        "Le auto ibride", "Le auto a metano",
        "Le auto d'epoca", "Le supercar",
        "Le Lamborghini", "Le Maserati",
        "Le moto custom", "Le moto da enduro",
        "Gli scooter 125", "Il Ciao Piaggio",
        "La bici da corsa", "La mountain bike",
        "Il monopattino Xiaomi", "Il segway",
        "Lo skateboard", "Il longboard",
        "I roller", "Il pattinaggio su ghiaccio",

        # ─── COSE CHE DIVIDONO ───
        "La pizza alta vs la pizza bassa",
        "Il bidet in casa", "La doccia vs il bagno nella vasca",
        "Il toast con burro di arachidi", "Le uova a colazione",
        "Il porridge", "I cereali col latte",
        "Dormire col pigiama vs dormire senza",
        "Dormire con la finestra aperta", "Il letto rifatto vs il letto disfatto",
        "I calzini bianchi", "I calzini fantasmini",
        "Lo zaino vs la borsa al lavoro",
        "Il quaderno a righe vs a quadretti",
        "La penna blu vs la penna nera",
        "L'acqua naturale vs l'acqua frizzante",
        "Il tè vs il caffè", "La birra vs il vino",
        "La montagna d'inverno vs la montagna d'estate",
        "Le vacanze a luglio vs le vacanze ad agosto",
        "Partire il sabato vs partire la domenica",
    ]

    for concept in extra_concetti:
        c_stripped = concept.strip()
        if c_stripped and c_stripped.lower() not in used_prompts:
            underrated = random.randint(15, 85)
            cards.append({
                "card_id": f"c{card_id}",
                "prompt": c_stripped,
                "global_stats": {
                    "underrated": underrated,
                    "overrated": 100 - underrated
                }
            })
            used_prompts.add(c_stripped.lower())
            card_id += 1

    print(f"Carte dopo concetti extra: {len(cards)}")

    # Se ancora non bastano, aggiungiamo altri concetti ultra-specifici
    ancora_concetti = [
        # ─── PIATTI REGIONALI ITALIANI ───
        "La cassoeula lombarda", "Il bollito misto piemontese",
        "La bagna cauda", "Il vitello tonnato", "Il pesto genovese col mortaio",
        "Le trofie liguri", "I pizzoccheri valtellinesi", "Il casoncello bergamasco",
        "Il tortello di zucca mantovano", "La piadina con squacquerone",
        "L'erbazzone reggiano", "Il panino con la milza", "Il pane cunzato",
        "Le sarde a beccafico", "La pasta alla norma", "La pasta con le sarde",
        "Il ragù napoletano", "La genovese napoletana", "La pastiera napoletana",
        "Gli struffoli", "Le zeppole di San Giuseppe", "Il casatiello napoletano",
        "La vignarola romana", "I carciofi alla giudia", "I rigatoni alla pajata",
        "I bucatini all'amatriciana", "La trippa alla romana",
        "La pappa col pomodoro", "La fiorentina alta 5 dita",
        "I pici cacio e pepe", "La schiacciata fiorentina",
        "Il cacciucco livornese", "La cecina pisana",
        "I culurgiones sardi", "Il porceddu sardo", "La seada sarda",
        "Il frico friulano", "La jota triestina", "I cjarsons",

        # ─── BRAND E CATENE ───
        "Primark", "Decathlon", "Flying Tiger", "Muji", "Uniqlo",
        "Eataly", "Autogrill", "Chef Express",
        "Conad vs Coop", "Eurospin", "Aldi",
        "MediaWorld", "Unieuro", "Expert",
        "Leroy Merlin", "Brico", "OBI",
        "eBay", "Wallapop", "Facebook Marketplace",
        "Booking.com", "Airbnb", "TripAdvisor",
        "Skyscanner", "Google Flights", "Trainline",
        "Uber Eats", "Deliveroo", "Glovo",
        "Satispay", "PayPal", "Revolut",
        "N26", "Hype", "PostePay",

        # ─── PROGRAMMI TV STORICI ───
        "Striscia la Notizia", "Le Iene", "Report",
        "Che tempo che fa", "Porta a Porta",
        "I Soliti Ignoti", "Reazione a Catena",
        "Caduta Libera", "Avanti un Altro",
        "La Corrida", "Zelig", "Colorado",
        "Camera Café", "Un medico in famiglia",
        "Don Matteo", "Montalbano", "Distretto di Polizia",
        "Carosello", "La Piovra", "La Freccia Nera",

        # ─── PERSONAGGI EXTRA ───
        "Papa Francesco", "Donald Trump", "Vladimir Putin",
        "Angela Merkel", "Emmanuel Macron",
        "Volodymyr Zelensky", "Xi Jinping",
        "Jeff Bezos vs Elon Musk", "Zuckerberg vs Elon Musk",
        "Samantha Cristoforetti", "Luca Parmitano",
        "Beppe Grillo", "Giorgia Meloni", "Matteo Salvini",
        "Giuseppe Conte", "Mario Draghi", "Sergio Mattarella",
        "Roberto Saviano", "Ferragnez",
        "Aurora Ramazzotti", "Elettra Lamborghini",
        "Diletta Leotta", "Belen Rodriguez",
        "Valentina Ferragni", "Emma Marrone",
        "Ultimo", "Blanco", "Mahmood",

        # ─── SPORT EXTRA ───
        "Il VAR nel calcio", "I rigori", "Il fuorigioco",
        "Il calciomercato", "Il fantacalcio serio",
        "Le Olimpiadi invernali", "I Giochi Paralimpici",
        "La Ryder Cup", "Il torneo di Wimbledon",
        "Il Roland Garros", "Gli US Open", "Gli Australian Open",
        "La Vuelta a España", "Il Tour de France",
        "La 24 ore di Le Mans", "Il Rally Dakar",
        "La Coppa America di vela", "Le gare di F1 a Monaco",
        "Il GP di Monza", "Il derby della Madonnina",
        "Il derby di Roma", "Juventus-Napoli",
        "La finale di Champions League",

        # ─── FILM EXTRA ───
        "Oppenheimer", "Barbie (il film)", "Dune",
        "Everything Everywhere All at Once", "Parasite",
        "Joker", "1917", "Dunkirk", "Tenet",
        "Django Unchained", "The Revenant", "Gravity",
        "La La Land", "Bohemian Rhapsody", "The Batman",
        "Top Gun: Maverick", "No Time to Die",
        "Mission: Impossible", "Fast and Furious",
        "John Wick", "Deadpool", "Guardiani della Galassia",
        "Black Panther", "Doctor Strange",
        "Jurassic Park", "Indiana Jones", "E.T.",
        "Rocky", "Rambo", "Terminator",
        "Alien", "Blade Runner", "2001: Odissea nello Spazio",
        "Arancia Meccanica", "Taxi Driver", "Scarface",
        "Il Silenzio degli Innocenti", "Seven", "Memento",

        # ─── SERIE TV EXTRA ───
        "Suits", "The Witcher", "Ozark", "Narcos",
        "Dark", "Money Heist", "Lupin", "Emily in Paris",
        "Bridgerton", "The Queen's Gambit", "Chernobyl",
        "True Detective", "Fargo", "Mindhunter",
        "Better Call Saul", "The Sopranos", "The Wire",
        "Dexter", "Sherlock", "Doctor Who",
        "The Walking Dead", "Yellowstone",
        "House of the Dragon", "The Rings of Power",
        "Andor", "The Bear", "White Lotus",
        "Severance", "Fallout", "Shogun",
        "Slow Horses", "Reacher", "Jack Ryan",

        # ─── GIOCHI EXTRA ───
        "The Legend of Zelda", "Mario Kart", "Animal Crossing",
        "Elden Ring", "God of War", "Horizon Zero Dawn",
        "Red Dead Redemption 2", "The Witcher 3",
        "Cyberpunk 2077", "Baldur's Gate 3",
        "Among Us", "Fall Guys", "Rocket League",
        "Valorant", "League of Legends", "Overwatch",
        "Apex Legends", "PUBG", "Roblox",
        "Hogwarts Legacy", "Stardew Valley",
        "The Sims", "SimCity", "Civilization",
        "Age of Empires", "Clash Royale", "Brawl Stars",

        # ─── COSE QUOTIDIANE EXTRA ───
        "Il traffico all'ora di punta", "Il parcheggio in doppia fila",
        "Le rotonde", "Gli autovelox", "I dossi artificiali",
        "Le strisce blu a pagamento", "Il bollo auto",
        "La revisione dell'auto", "L'assicurazione auto",
        "Il tagliando", "La benzina al self-service",
        "Il pedaggio autostradale", "Le aree di servizio in autostrada",
        "L'autogrill", "Il panino dell'Autogrill",
        "I bagni delle stazioni di servizio",
        "La coda al casello", "Il tutor in autostrada",
        "I lavori in corso perenni", "Le buche nelle strade",
        "I cantieri infiniti", "La metro in costruzione da 30 anni",
    ]

    for concept in ancora_concetti:
        c_stripped = concept.strip()
        if c_stripped and c_stripped.lower() not in used_prompts:
            underrated = random.randint(15, 85)
            cards.append({
                "card_id": f"c{card_id}",
                "prompt": c_stripped,
                "global_stats": {
                    "underrated": underrated,
                    "overrated": 100 - underrated
                }
            })
            used_prompts.add(c_stripped.lower())
            card_id += 1

    print(f"Carte dopo ancora_concetti: {len(cards)}")

    # Se ancora non bastano, ulteriori concetti granulari
    micro_concetti = [
        # ─── CUCINA INTERNAZIONALE EXTRA ───
        "Il couscous", "Il taboulé", "Le olive ascolane", "Il fritto misto di pesce",
        "I calamari fritti", "Il baccalà fritto", "Le polpette della nonna",
        "Le melanzane alla parmigiana", "Le zucchine ripiene", "I peperoni imbottiti",
        "La caprese", "La bruschetta al pomodoro", "Le focaccine al formaggio",
        "Il pane toscano senza sale", "Il pane di Altamura",
        "Il tartufo nero", "Il tartufo bianco d'Alba",
        "Le castagne arrosto", "Le fragole con la panna",
        "Il gelato in coppetta vs il gelato in cono",
        "La granita al caffè", "Il sorbetto al limone",
        "La torta della nonna", "La crostata alla marmellata",
        "Il tiramisù al pistacchio", "La panna cotta",
        "Lo zabaione", "Il cantucci e Vin Santo",
        "Le chiacchiere di Carnevale", "Le frappe",

        # ─── ARGOMENTI CHE DIVIDONO ───
        "Le vacanze con i suoceri", "I pranzi coi parenti lontani",
        "Le feste di quartiere", "Le sagre paesane",
        "Le processioni del Venerdì Santo", "La messa la domenica",
        "Il rosario della nonna", "Le catene di Sant'Antonio su WhatsApp",
        "I buongiornissimi su WhatsApp", "Le foto profilo dei genitori",
        "I genitori che controllano i social dei figli",
        "I figli che insegnano la tecnologia ai genitori",
        "Le suonerie del telefono in pubblico",
        "Il vivavoce in treno", "Le videochiamate in pubblico",
        "I selfie ai musei", "Le foto in aeroporto",
        "I check-in su Facebook", "Le dirette Instagram a caso",
        "Il ghosting dopo il primo appuntamento",
        "Il doppio tick blu ignorato", "Lo stato online senza rispondere",
        "Le risposte con il solo like", "Le emoji al posto delle parole",
        "Le GIF nelle conversazioni", "Gli sticker su WhatsApp",

        # ─── CONCETTI MODERNI ───
        "La terapia online", "Il coaching di vita",
        "I corsi di mindfulness", "Le app per il sonno",
        "Il rumore bianco per dormire", "Le weighted blankets",
        "Le candele IKEA", "I diffusori di oli essenziali",
        "Le luci LED colorate in camera", "Il ring light",
        "Lo standing desk", "La sedia gaming",
        "La setup station da gaming", "Il dual monitor",
        "Il secondo telefono per il lavoro",
        "Lo smartwatch per il fitness", "L'anello smart",
        "Gli occhiali smart", "Le cuffie a conduzione ossea",

        # ─── SITUAZIONI UNIVERSALI ───
        "Svegliarsi 5 minuti prima della sveglia",
        "Snooze ripetuto della sveglia",
        "La doccia calda d'inverno", "La doccia fredda d'estate",
        "Trovare parcheggio al primo colpo", "La benzina in riserva",
        "Dimenticare le chiavi di casa", "Dimenticare il telefono a casa",
        "Perdere il portafoglio", "Trovare soldi nella tasca del giubbotto",
        "Il pacco di Amazon che arriva in anticipo",
        "L'attesa del corriere tutto il giorno",
        "Le consegne mancate per assenza",
        "I pacchi lasciati dal vicino",
        "Il campanello che suona mentre sei in doccia",
        "La fila alla cassa con una persona sola davanti che paga in monete",
        "Il carrello del supermercato con la ruota storta",
        "Trovare il prodotto esaurito proprio quando ti serviva",
        "Le buste di plastica a pagamento",
        "I sacchetti riutilizzabili dimenticati in auto",
    ]

    for concept in micro_concetti:
        c_stripped = concept.strip()
        if c_stripped and c_stripped.lower() not in used_prompts:
            underrated = random.randint(15, 85)
            cards.append({
                "card_id": f"c{card_id}",
                "prompt": c_stripped,
                "global_stats": {
                    "underrated": underrated,
                    "overrated": 100 - underrated
                }
            })
            used_prompts.add(c_stripped.lower())
            card_id += 1

    print(f"Carte dopo micro_concetti: {len(cards)}")

    # Import espansioni aggiuntive
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from deck_expansion import MEGA_EXPANSION
    from deck_expansion_2 import MEGA_EXPANSION_2
    from deck_expansion_3 import MEGA_EXPANSION_3

    all_extra = MEGA_EXPANSION + MEGA_EXPANSION_2 + MEGA_EXPANSION_3

    # Carica espansioni 4-6 se esistono
    try:
        from deck_expansion_4 import MEGA_EXPANSION_4
        all_extra += MEGA_EXPANSION_4
    except ImportError:
        pass
    try:
        from deck_expansion_5 import MEGA_EXPANSION_5
        all_extra += MEGA_EXPANSION_5
    except ImportError:
        pass
    try:
        from deck_expansion_6 import MEGA_EXPANSION_6
        all_extra += MEGA_EXPANSION_6
    except ImportError:
        pass

    for concept in all_extra:
        c_stripped = concept.strip()
        if c_stripped and c_stripped.lower() not in used_prompts:
            underrated = random.randint(15, 85)
            cards.append({
                "card_id": f"c{card_id}",
                "prompt": c_stripped,
                "global_stats": {
                    "underrated": underrated,
                    "overrated": 100 - underrated
                }
            })
            used_prompts.add(c_stripped.lower())
            card_id += 1

    print(f"Carte dopo tutte le espansioni: {len(cards)}")

    # Mescola casualmente
    random.shuffle(cards)

    # Rinumera le card_id dopo lo shuffle
    for i, card in enumerate(cards):
        card["card_id"] = f"c{i+1}"

    final_count = len(cards)
    print(f"\n=== MAZZO FINALE: {final_count} carte ===")
    if final_count < 10000:
        print(f"ATTENZIONE: Mancano {10000 - final_count} carte per raggiungere 10.000")
    else:
        print("Obiettivo 10.000 raggiunto!")

    return {
        "decks": [
            {
                "deck_id": "unico",
                "deck_name": "Mazzo Unico",
                "cards": cards
            }
        ]
    }


def main():
    deck_json = generate_deck()
    with open(DECKS_FILE, 'w', encoding='utf-8') as f:
        json.dump(deck_json, f, ensure_ascii=False, indent=2)
    print(f"\nFile {DECKS_FILE} scritto con successo!")
    print(f"Dimensione: {len(deck_json['decks'][0]['cards'])} carte")


if __name__ == "__main__":
    main()
