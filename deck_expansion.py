#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Expansion concepts for OverUnder deck generator.
Every concept passes the test: "Per me [X] è sopravvalutato/sottovalutato"
"""

MEGA_EXPANSION = [
    # ─── CUCINA ITALIANA VARIANTI ───
    "La pasta al forno","La pasta fredda estiva","La pasta aglio olio e peperoncino",
    "La pasta e patate","La pasta e ceci","La pasta al ragù di cinghiale",
    "Il risotto alla milanese","Il risotto al tartufo","Il risotto di mare",
    "Il risotto alla zucca","Il risotto al radicchio","La zuppa di pesce",
    "La zuppa di lenticchie","La crema di zucca","La vellutata di piselli",
    "L'insalata di riso","L'insalata di mare","La panzanella toscana",
    "La frisella pugliese","I crostini toscani","La focaccia genovese",
    "La focaccia di Recco","La pinsa romana","La pizza in teglia",
    "La pizza fritta napoletana","Il calzone ripieno","Il gnocco fritto",
    "Le tigelle con lardo","Il panino col lampredotto fiorentino",
    "Il panino con la porchetta di Ariccia","Il tramezzino del bar",
    "La torta di mele della nonna","La crostata alla marmellata",
    "Il ciambellone casalingo","La torta caprese al cioccolato",
    "La cassata siciliana","Le cartellate pugliesi",
    "Le seadas sarde col miele","Il gelato artigianale vs quello industriale",
    "Le arance di Sicilia","I limoni della Costiera Amalfitana",
    "I pomodorini di Pachino","Le olive taggiasche","I capperi di Pantelleria",
    "I pistacchi di Bronte","Le nocciole del Piemonte","Le mandorle di Avola",
    "La bagna cauda piemontese","Il vitello tonnato","I pizzoccheri valtellinesi",
    "Il casoncello bergamasco","Il tortello di zucca mantovano",
    "L'erbazzone reggiano","Il panino con la milza palermitano",
    "Le sarde a beccafico","La pasta alla norma catanese",
    "Il ragù napoletano cotto 6 ore","La genovese napoletana",
    "La pastiera napoletana","Gli struffoli natalizi",
    "Le zeppole di San Giuseppe","Il casatiello napoletano",
    "I carciofi alla giudia romani","I rigatoni alla pajata",
    "La fiorentina alta cinque dita","I pici senesi",
    "Il cacciucco livornese","La cecina pisana",
    "I culurgiones sardi","Il porceddu sardo","Il frico friulano",
    "La jota triestina","I cjarsons friulani",

    # ─── CUCINA INTERNAZIONALE ───
    "La fondue bourguignonne","Il raclette svizzero","La quiche lorraine",
    "La ratatouille francese","Il croque-monsieur","Il pain au chocolat",
    "La baguette francese","La tarte tatin","Il wiener schnitzel viennese",
    "Il goulash ungherese","Il pierogi polacco","Le blini russe",
    "Lo smørrebrød danese","I waffle belgi","Le poffertjes olandesi",
    "Lo shepherd's pie inglese","Il full English breakfast",
    "Gli scones con clotted cream","Il pulled pork americano",
    "Le costine barbecue affumicate","Il mac and cheese americano",
    "Il cheesecake newyorkese","I brownies al cioccolato fondente",
    "I donuts americani","I cookies americani al cioccolato",
    "Il burrito messicano","Le enchiladas messicane","I nachos con guacamole",
    "Le quesadillas","La feijoada brasiliana","L'asado argentino",
    "Il jerk chicken giamaicano","Il nasi goreng indonesiano",
    "Il laksa malese","Il banh mi vietnamita","Il green curry tailandese",
    "Il tom yum tailandese","Il tonkatsu giapponese",
    "L'okonomiyaki giapponese","Il takoyaki giapponese",
    "Il gyoza giapponese","L'anatra alla pechinese",
    "Il tandoori chicken indiano","Il dosa indiano",
    "Il samosa indiano","Il chai masala indiano",
    "Lo shawarma mediorientale","Il lahmacun turco",
    "Il tajine marocchino","Il cous cous marocchino",
    "Il bibimbap coreano","Le dim sum cantonesi",
    "Il pho vietnamita","Il ceviche peruviano","Le arepas venezuelane",

    # ─── DOLCI E SNACK ───
    "Il profiterole","La mousse al cioccolato","La crème brûlée",
    "Il soufflé al cioccolato","La meringata","Il millefoglie",
    "La zuppa inglese","Il budino al cioccolato","La panna cotta al caramello",
    "Il semifreddo al torrone","I macaron francesi","Gli eclairs al cioccolato",
    "I Kinder Bueno","Il KitKat","Le M&M's","Le Gocciole Pavesi",
    "I Ringo","Gli Oreo","I Pan di Stelle","I Baci Perugina",
    "I Mon Chéri","I Ferrero Rocher","Le Haribo","Le caramelle Rossana",
    "Il torrone di Cremona","La colomba pasquale",

    # ─── BEVANDE ───
    "Il caffè decaffeinato","Il caffè d'orzo","Il caffè al ginseng",
    "Il flat white","Il cold brew coffee","Il frappuccino Starbucks",
    "Il golden milk alla curcuma","Il kombucha","Il kefir",
    "Lo smoothie bowl","L'açaí bowl","Il centrifugato verde",
    "L'infuso di zenzero e limone","La tisana della sera",
    "La camomilla","Il tè alla menta marocchino",
    "L'Irish coffee","Il caffè corretto alla grappa",
    "Il limoncello ghiacciato","L'amaro Averna","Il Fernet Branca",
    "Il cynar","Il mirto sardo","La cedrata Tassoni",
    "L'aranciata amara","La gassosa siciliana","Il ginger beer",
    "I cocktail analcolici","La birra analcolica","Il vino dealcolato",
    "L'Asti spumante","Il Franciacorta","Il Lambrusco frizzante",
    "Il Chianti Classico","Il Barolo","Il Brunello di Montalcino",
    "L'Amarone della Valpolicella","Il Nero d'Avola siciliano",
    "Il Primitivo di Manduria","Il Prosecco di Valdobbiadene",
    "Il Vermentino sardo","Il Gewürztraminer altoatesino",

    # ─── PERSONAGGI STORICI E CULTURALI EXTRA ───
    "Confucio","Sun Tzu","Buddha come figura storica",
    "Caterina de' Medici","Lorenzo il Magnifico","Carlo Magno",
    "Spartaco","Annibale Barca","Attila","Rasputin",
    "Franklin D. Roosevelt","Abraham Lincoln",
    "Alessandro Manzoni","Giovanni Verga","Luigi Pirandello",
    "Italo Calvino","Umberto Eco","Primo Levi",
    "Giacomo Leopardi","Eugenio Montale","Giuseppe Ungaretti",
    "Pier Paolo Pasolini","Dario Fo","Eduardo De Filippo",
    "Giovanni Falcone","Paolo Borsellino",
    "Frida Kahlo","Andy Warhol","Salvador Dalí",
    "Claude Monet","Edvard Munch","Gustav Klimt","Banksy",
    "Jean-Michel Basquiat","Yayoi Kusama",
    "Papa Francesco","Donald Trump","Vladimir Putin","Angela Merkel",
    "Samantha Cristoforetti","Giorgia Meloni","Matteo Salvini",
    "Giuseppe Conte","Mario Draghi","Sergio Mattarella",
    "Roberto Saviano","Elettra Lamborghini","Diletta Leotta",
    "Emma Marrone","Ultimo","Blanco","Mahmood",

    # ─── MUSICISTI EXTRA ───
    "Oasis","Blur","The Smiths","Depeche Mode","The Cure",
    "Pearl Jam","Metallica","Iron Maiden","Black Sabbath",
    "Guns N' Roses","Bon Jovi","The Police","Genesis",
    "Fleetwood Mac","Eagles","Dire Straits","Ramones",
    "Sex Pistols","The Clash","The Doors","Jimi Hendrix",
    "Bob Dylan","Leonard Cohen","Bruce Springsteen",
    "Jay-Z","Tupac","Notorious B.I.G.","Snoop Dogg",
    "Nicki Minaj","Cardi B","Tyler the Creator","Frank Ocean",
    "SZA","Bad Bunny","Rosalía","Shakira",
    "Tiziano Ferro","Eros Ramazzotti","Andrea Bocelli",
    "Zucchero","Pino Daniele","Franco Battiato",
    "Francesco De Gregori","Antonello Venditti",
    "Loredana Bertè","Gianna Nannini","Cesare Cremonini",
    "Tananai","Irama","Madame","Lazza","Tedua","Tony Effe",
    "Rkomi","Ernia","Shiva","Baby Gang",

    # ─── SPORT DETTAGLIATI ───
    "Il calcio a 5","Il calcio femminile","Il beach volley",
    "La pallanuoto","Il tiro con l'arco","La scherma",
    "Il kitesurf","Il windsurf","Il wakeboard","Lo snorkeling",
    "L'equitazione","Il cricket","Il baseball","Il football americano",
    "L'hockey su ghiaccio","Il curling","Il pattinaggio artistico",
    "La ginnastica artistica","Il karate","Il judo","Il taekwondo",
    "Il jiu-jitsu brasiliano","L'MMA","La kickboxing","Il parkour",
    "Il calisthenics","Il bodybuilding","Il powerlifting",
    "Le spartan race","Il frisbee ultimate","Il pickleball",
    "Il badminton","Lo squash","Il tennistavolo",
    "Il VAR nel calcio","I rigori del calcio","Il fuorigioco",
    "Il calciomercato estivo","Il fantacalcio serio",
    "Le Olimpiadi invernali","Il torneo di Wimbledon",
    "Il GP di Monza","Il derby della Madonnina",
    "La finale di Champions League",

    # ─── SQUADRE ───
    "La Juventus","L'Inter","Il Milan","Il Napoli",
    "La Roma","La Lazio","La Fiorentina","L'Atalanta",
    "Il Bologna","Il Torino","Il Real Madrid","Il Barcellona",
    "Il Manchester United","Il Manchester City","Il Liverpool",
    "L'Arsenal","Il Chelsea","Il Bayern Monaco",
    "Il Borussia Dortmund","Il PSG",

    # ─── TECNOLOGIA EXTRA ───
    "L'iPad","Il MacBook","Il Surface","Il Chromebook",
    "I laptop da gaming","La GoPro","Il DJI Mini",
    "Le dash cam","Le tastiere ergonomiche split",
    "Il mouse verticale","I monitor 4K","I monitor OLED",
    "Le TV OLED vs QLED","Il proiettore vs la TV grande",
    "Le soundbar","Gli altoparlanti Bluetooth portatili","Il Sonos",
    "Le prese smart","Le strisce LED colorate","Le Nanoleaf",
    "Le Philips Hue","I robot tagliaerba","La Nespresso vs la moka",
    "Il caffè in grani vs in capsule","Il Bimby","L'estrattore di succo",
    "Le lampadine smart","Le serrature smart","Il videocitofono smart",
    "Le VPN per lo streaming","Il termostato smart Nest",
    "La domotica Alexa vs Google Home","Le macchine del caffè automatiche",

    # ─── MODA EXTRA ───
    "Il total white","I pantaloni palazzo","Il tubino nero",
    "La camicia oversize","La camicia di lino","La t-shirt basic bianca",
    "Il piumino lungo","Il parka","Il cappotto cammello",
    "I Chelsea boots","Gli stivali Dr. Martens","Le UGG",
    "I Moon Boot","Le espadrillas","Le Superga","Le Saucony",
    "Le ASICS","Le Hoka","Le On Running",
    "Le borse Hermès","Le borse Louis Vuitton","Le borse Prada",
    "Le borse Gucci","Le borse Chanel",
    "Gli zaini Eastpak","Gli zaini Fjällräven Kånken",
    "Le valigie Rimowa","Gli orologi Casio","Gli Swatch",
    "I pantaloni cargo","La camicia hawaiana","I marsupi",
    "Le ciabatte Adidas","Le Converse All Star","Le Vans Old Skool",
    "Le Nike Air Max","Le Jordan","Le Yeezy","Le New Balance",
    "Le Birkenstock","Il trench","Il bomber","La felpa con cappuccio",
    "I leggins come pantaloni","Il pigiama fuori casa",
    "Le giacche di pelle","Il giubbotto di jeans",

    # ─── LUOGHI EXTRA ───
    "Tenerife","Ibiza","Mykonos","Santorini","Creta","Malta",
    "La Costa Azzurra","Monaco","L'Islanda","La Norvegia",
    "La Lapponia","L'aurora boreale","Dubrovnik","Budapest",
    "Cracovia","Tokyo","Seoul","Bangkok","Dubai",
    "Los Angeles","San Francisco","Miami","Toronto","Sydney",
    "Rio de Janeiro","Buenos Aires","Berlino","Vienna",
    "Lisbona","Atene","Marrakech","Singapore","Hong Kong",
    "Il Machu Picchu","La Patagonia","Il Grand Canyon",
    "Las Vegas","Hollywood","Manhattan","Central Park",
    "La Grande Muraglia Cinese","Il Taj Mahal","Il Monte Fuji",
    "Kyoto","Bora Bora","Le Seychelles","Le Mauritius",
    "I safari in Kenya","Il Kilimanjaro","Petra in Giordania",
    "La Cappadocia","Torino","Bologna","Genova","Palermo",
    "Catania","Bari","Verona","Trieste","Perugia","Cagliari",
    "Lecce","Matera","Bergamo","Padova","Pisa","Siena","Lucca",
    "Amalfi","Positano","Capri","Ischia","Pantelleria",
    "Tropea","Polignano a Mare","Le Tremiti","L'Isola d'Elba",
    "Favignana","Le Eolie","Stromboli di notte","Lipari",

    # ─── FILM E REGISTI ───
    "I film di Wes Anderson","I film di Kubrick","I film di Nolan",
    "I film dello Studio Ghibli","I film Pixar","I film Disney classici",
    "I film di James Bond","I film degli Avengers",
    "I film horror giapponesi","I film di zombie","I film di fantascienza",
    "I film western","I film biografici","I film musicali",
    "Le commedie italiane","I thriller psicologici",
    "Oppenheimer","Barbie il film","Dune","Parasite","Joker",
    "Django Unchained","La La Land","Bohemian Rhapsody",
    "Top Gun Maverick","John Wick","Deadpool",
    "Jurassic Park","Rocky","Terminator","Alien",
    "Blade Runner","Taxi Driver","Scarface","Seven","Memento",
    "I film di Fast and Furious","I film di Batman",

    # ─── SERIE TV EXTRA ───
    "Scrubs","Grey's Anatomy","Dr. House","Criminal Minds",
    "Prison Break","Vikings","Outlander","Downton Abbey",
    "Westworld","Mr. Robot","The Expanse","Silo",
    "Arcane","One Punch Man","My Hero Academia","Jujutsu Kaisen",
    "Chainsaw Man","Spy x Family","Fullmetal Alchemist","Steins;Gate",
    "Better Call Saul","The Sopranos","The Wire","Dexter",
    "Sherlock","The Walking Dead","House of the Dragon",
    "The Bear","White Lotus","Severance","Fallout","Shogun",
    "Suits","Narcos","Lupin","Emily in Paris","Bridgerton",
    "The Queen's Gambit","Chernobyl","True Detective","Fargo","Mindhunter",

    # ─── VIDEOGIOCHI EXTRA ───
    "Dark Souls","Bloodborne","Hollow Knight","Hades",
    "Disco Elysium","Final Fantasy VII","Persona 5",
    "Super Mario Odyssey","Super Smash Bros.","Pokémon come franchise",
    "Metal Gear Solid","Silent Hill 2","Resident Evil 4",
    "Portal","Half-Life 2","Bioshock","Skyrim",
    "Fallout New Vegas","Breath of the Wild","Ghost of Tsushima",
    "Spider-Man PS5","The Last of Us Part II",
    "It Takes Two","Phasmophobia","Lethal Company",
    "Palworld","Valheim","Satisfactory","Factorio",
    "Cities Skylines","Football Manager","Stardew Valley",
    "The Sims come franchise","Civilization","Age of Empires",
    "Clash Royale","Brawl Stars","Hogwarts Legacy",
    "Elden Ring","God of War","Baldur's Gate 3",
    "Red Dead Redemption 2","Cyberpunk 2077",

    # ─── LIBRI E LETTERATURA ───
    "I romanzi di Stephen King","I romanzi di Tolkien",
    "I romanzi di Agatha Christie","I romanzi di Elena Ferrante",
    "1984 di Orwell","Il Piccolo Principe","Il Nome della Rosa di Eco",
    "Il Gattopardo","La Divina Commedia","I Promessi Sposi",
    "Sapiens di Harari","Atomic Habits","I libri di crescita personale",
    "I libri di cucina","I thriller scandinavi","I romanzi rosa",
    "La letteratura young adult","I manga come letteratura",

    # ─── BRAND E CATENE EXTRA ───
    "Primark","Decathlon","Flying Tiger","Muji","Uniqlo",
    "Eataly","Autogrill","Eurospin","Aldi","Leroy Merlin",
    "eBay","Facebook Marketplace","Booking.com","Skyscanner",
    "Trainline","Uber Eats","Deliveroo","Glovo","Satispay",
    "PayPal","Revolut","N26","PostePay",
    "Mulino Bianco","Kinder","Il Cornetto Algida","Il Magnum",
    "Il Cucciolone","La Fanta","La Sprite","L'Estathé",
    "Il Crodino","La San Pellegrino","La Ferrarelle","La Levissima",
    "La Peroni","La Moretti","L'Ichnusa",
    "La Nutella vs la crema Novi","Barilla vs De Cecco",
    "Il Parmigiano vs il Grana Padano","Conad vs Coop",

    # ─── PROGRAMMI TV ITALIANI ───
    "Striscia la Notizia","Le Iene","Report","Che tempo che fa",
    "Porta a Porta","I Soliti Ignoti","Reazione a Catena",
    "Caduta Libera","Avanti un Altro","Zelig","Colorado",
    "Camera Café","Don Matteo","Il Commissario Montalbano",

    # ─── EVENTI ───
    "Il Salone del Mobile di Milano","La Milano Fashion Week",
    "La Biennale di Venezia","Il Lucca Comics","Il Romics",
    "Il Vinitaly di Verona","Il Met Gala","Il Burning Man",
    "Il Tomorrowland","L'Oktoberfest","La Notte Bianca",

    # ─── PROFESSIONI EXTRA ───
    "Il dentista","L'oculista","Il dermatologo","Il nutrizionista",
    "L'osteopata","Il veterinario","L'ingegnere informatico",
    "Il data scientist","Il social media manager","Il fotografo professionista",
    "Lo chef stellato","Il barista","Il sommelier",
    "Il pilota di linea","Il vigile del fuoco","L'astronauta",
    "Il deejay professionista","Il tatuatore","Il barbiere hipster",
    "L'interior designer","Il wedding planner","Il dog sitter professionista",

    # ─── AUTOMOBILI ───
    "La BMW","L'Audi","La Mercedes","La Porsche",
    "La Toyota","La Honda","La Hyundai","La Ford","La Volvo",
    "L'Alfa Romeo","La Fiat 500","La Mini Cooper",
    "Le auto ibride","Le auto d'epoca","Le Lamborghini","Le Maserati",
    "La Dacia Sandero","La Smart ForTwo",

    # ─── CONCETTI LAVORATIVI ───
    "Le email fuori orario di lavoro","Le riunioni del lunedì mattina",
    "Le call su Teams alle 18","Il brainstorming di gruppo",
    "Il performance review annuale","Il bonus di fine anno",
    "La tredicesima","I benefit aziendali","La mensa aziendale",
    "L'open space vs l'ufficio privato","Il casual Friday",
    "Le deadline impossibili","Il burnout lavorativo",
    "La pausa caffè coi colleghi","Il pranzo alla scrivania",
    "Le notifiche Teams fuori orario",

    # ─── ANIMALI EXTRA ───
    "I labrador","I border collie","I bulldog francesi",
    "I chihuahua","I husky","I pastori tedeschi","I pitbull",
    "I beagle","I corgi","I shiba inu","I maine coon",
    "I siamesi","I british shorthair","I sphynx senza pelo",
    "I gatti randagi","I cavalli","Le alpaca",
    "I porcellini d'India","I furetti","I pesci tropicali",
    "I delfini","I pinguini","I koala","I panda",
    "Le giraffe","Gli elefanti","I leoni",

    # ─── CONCETTI FILOSOFICI E PSICOLOGICI ───
    "Il minimalismo come filosofia","Il consumismo sfrenato",
    "La meritocrazia come ideale","Lo stoicismo moderno",
    "L'effetto Dunning-Kruger","Il bias di conferma",
    "La dissonanza cognitiva","La procrastinazione cronica",
    "Il perfezionismo tossico","Il multitasking come mito",
    "La produttività tossica",

    # ─── FENOMENI SOCIALI ───
    "Il cottagecore","Il dark academia","Il clean girl aesthetic",
    "Il quiet luxury","Il capsule wardrobe",
    "Lo hygge danese","L'ikigai giapponese",
    "La cancel culture","Il politically correct esagerato",
    "Il body positivity","Il quiet quitting",
    "I nomadi digitali","La gig economy","Le grandi dimissioni",

    # ─── MEDIA ───
    "Sky Sport vs DAZN","DAZN","Mediaset vs Rai",
    "Vanity Fair Italia","Wired Italia","Il Post online",
    "Internazionale","Il Sole 24 Ore","Le breaking news 24/7",
    "I talk show politici","Le interviste doppie",

    # ─── HOBBY ───
    "La fotografia analogica","Il fai da te","Il giardinaggio",
    "La cucina come hobby","Il pane fatto in casa",
    "La pasta fresca fatta a mano","La ceramica",
    "La calligrafia","Il modellismo","La pesca sportiva",
    "Il trekking","L'alpinismo","Il paracadutismo",
    "Il bungee jumping","Il parapendio","La mongolfiera","Il karting",

    # ─── STRUMENTI MUSICALI ───
    "La chitarra elettrica","La chitarra acustica",
    "Il pianoforte a coda","La batteria acustica","Il violino",
    "Il sassofono","L'armonica a bocca","Il banjo","L'arpa",
    "Il theremin","La kalimba","L'ukulele",

    # ─── GIOCHI DA TAVOLO ───
    "Azul","Wingspan","Ticket to Ride","Pandemic","Codenames",
    "Exploding Kittens","Cards Against Humanity","Dobble",
    "Twister","Scarabeo","Rummikub","Il Cluedo",
    "Il Trivial Pursuit","Il Taboo","Il Pictionary",
    "Il Dixit","Il Catan",

    # ─── SCIENZA E NATURA ───
    "I buchi neri","La materia oscura","Il Big Bang",
    "La colonizzazione di Marte","La vita extraterrestre",
    "Gli UFO","L'energia solare","L'energia eolica",
    "L'energia nucleare come soluzione","L'idrogeno verde",
    "I terremoti","I vulcani attivi","L'Etna","Il Vesuvio",

    # ─── ITALIANITÀ ───
    "Il dialetto locale","Il romanesco","Il napoletano",
    "Il milanese","Il siciliano","Il sardo","Il toscano",
    "La sanità pubblica italiana","La fuga dei cervelli",
    "Il sud vs il nord Italia","La puntualità italiana",
    "Lo stereotipo dell'italiano all'estero",

    # ─── SPIAGGE ───
    "Le spiagge libere vs gli stabilimenti","Gli ombrelloni a 30 euro",
    "La spiaggia dei Conigli a Lampedusa","La Pelosa a Stintino",
    "Cala Mariolu","Le spiagge nere vulcaniche",

    # ─── OGGETTI NOSTALGICI ───
    "Il walkman","Il floppy disk","La cassetta VHS","Il modem 56k",
    "MSN Messenger","La penna a 4 colori","La gomma che bucava i fogli",
    "Le schede telefoniche","Le cabine telefoniche","L'iPod",
    "Il Motorola Razr","Il BlackBerry","Il Game Boy Color",
    "Il Tetris","Snake sul Nokia","I CD masterizzati",
    "Le musicassette","Le enciclopedie cartacee",
    "Le Pagine Gialle","Il videoregistratore",

    # ─── MOMENTI DI VITA ───
    "Il primo bacio","Il primo stipendio","La prima macchina",
    "Il diploma di maturità","I 18 anni","I 30 anni","I 40 anni",
    "La pensione","L'amicizia tra uomo e donna",
    "Gli amici d'infanzia","Gli amici dell'università",
    "La reunion del liceo dopo 20 anni",

    # ─── FINANZA ───
    "Le criptovalute come investimento","Gli investimenti in borsa",
    "Il PAC mensile","Il mattone come investimento",
    "Le piattaforme di trading","eToro","Binance",
    "L'inflazione","La recessione economica",
    "Il reddito di cittadinanza","Il salario minimo in Italia",
    "La flat tax","Le tasse in Italia","I fondi indicizzati ETF",

    # ─── ESPERIENZE DI VIAGGIO ───
    "L'Interrail in Europa","Il road trip in America",
    "Il Cammino di Santiago","La Via Francigena",
    "Le vacanze in agriturismo","Le masserie pugliesi",
    "I trulli di Alberobello","I sassi di Matera",
    "I borghi più belli d'Italia","Le bandiere blu italiane",

    # ─── PARAGONI EXTRA ───
    "Just Eat vs Deliveroo vs Glovo","Amazon Prime vs Netflix",
    "Booking vs Airbnb","Google Maps vs Waze",
    "iPhone vs Samsung Galaxy","MacBook vs ThinkPad",
    "iPad vs tablet Android","AirPods vs cuffie Sony",
    "Spotify vs YouTube Music","TikTok vs Instagram Reels",
    "X vs Threads","L'Apple Watch vs il Garmin",

    # ─── TENDENZE ALIMENTARI ───
    "Il brunch della domenica","L'aperitivo all'italiana",
    "Lo street food","Il food delivery a domicilio",
    "I ristoranti stellati","Le trattorie di paese",
    "Gli all-you-can-eat cinesi","Il buffet di sushi",
    "Le catene di ristoranti","I ristoranti vegani",
    "I ristoranti fusion","Le pizzerie a taglio romane",
    "La cucina molecolare","I farmer's market","HelloFresh",

    # ─── QUOTIDIANITÀ ───
    "Stirare i vestiti","Le lenzuola di raso","Il piumone vs le coperte",
    "Il cuscino morbido vs quello duro","Il materasso memory foam",
    "Lo spazzolino elettrico vs manuale",
    "Il sapone liquido vs la saponetta","Lo shampoo solido",
    "I detersivi ecologici","Le borracce vs le bottiglie di plastica",
    "Le cannucce di carta vs quelle di plastica",

    # ─── BENESSERE E CORPO ───
    "I tatuaggi piccoli","I tatuaggi manica intera",
    "I piercing multipli","L'apparecchio ortodontico invisibile",
    "Lo sbiancamento dentale","I filler per le labbra",
    "La crioterapia","La sauna finlandese","Il bagno turco",
    "La vasca idromassaggio","Le spa di lusso",

    # ─── FITNESS A CASA ───
    "La palestra in casa","Il tapis roulant domestico",
    "La cyclette vs la bici vera","Il vogatore","I kettlebell",
    "Le bande elastiche","Il foam roller","Il tappetino yoga",

    # ─── URBANISTICA ───
    "La periferia vs il centro","I quartieri gentrificati",
    "I loft industriali","Gli attici","Le mansarde",
    "Le case con giardino","Le villette a schiera",
    "I bilocali da 30mq in città","La vita da pendolare",
    "La vita in provincia","La vita nei borghi",

    # ─── RITUALI ITALIANI ───
    "La passeggiata serale in centro","Il gelato dopo cena",
    "La granita con brioche in Sicilia","Il caffè sospeso napoletano",
    "La pizza del sabato sera","L'aperitivo delle 18",
    "La partita allo stadio","La partita al bar",
    "Il Fantacalcio","La settimana enigmistica",
    "Le figurine dei calciatori Panini",

    # ─── TIPOLOGIE DI PERSONE ───
    "Gli introversi","Gli estroversi",
    "I mattinieri vs i nottambuli","I perfezionisti",
    "I procrastinatori cronici","Gli ottimisti vs i pessimisti",
    "I minimalisti vs i massimalisti",
    "I vegetariani","I vegani","I flexitariani",

    # ─── SHOPPING ───
    "Lo shopping online vs in negozio","I resi gratuiti online",
    "I codici sconto degli influencer","I programmi fedeltà",
    "Le edizioni limitate","Le collaborazioni tra brand",
    "Il second hand di lusso","Depop come marketplace",
    "I drop di sneakers","Le aste online",

    # ─── TV ITALIANA STORICA ───
    "Carosello","La Piovra","Un medico in famiglia",
    "Distretto di Polizia","La Corrida di Corrado",

    # ─── TRASPORTI ───
    "Il motorino a 14 anni","La patente B","Il SUV in città",
    "Uber","Flixbus","Ryanair","La prima classe in aereo",
    "L'autostop","Il camper","I parcheggiatori abusivi","Le ZTL",
    "La metro di Milano","La metro di Roma",
    "La Fiat Panda storica","La Vespa Piaggio",

    # ─── CONCETTI ASTRATTI ───
    "La monogamia","Il poliamore","Le relazioni aperte",
    "Il matrimonio civile vs religioso","L'adozione",
    "Il congedo di paternità","La donazione degli organi",
    "La donazione del sangue",

    # ─── IL MONDO DIGITALE ───
    "Il doomscrolling notturno","Lo scrolling infinito sui social",
    "Le app di produttività","Google Calendar come religione",
    "Le dark kitchen per delivery","I meal kit in abbonamento",
    "Le push notification delle news","Le newsletter via email",
    "Le telefonate dei call center","I cookie dei siti web",
    "Le pubblicità personalizzate","Il retargeting pubblicitario",

    # ─── COSE DIVISIVE EXTRA ───
    "L'acqua naturale vs l'acqua frizzante in bottiglia",
    "Il tè vs il caffè come bevanda quotidiana",
    "La birra vs il vino a cena",
    "La montagna d'inverno vs la montagna d'estate",
    "Le vacanze a luglio vs le vacanze ad agosto",
    "Dormire col pigiama vs dormire senza",
    "Dormire con la finestra aperta d'inverno",
    "Il letto rifatto vs il letto disfatto",
    "Lo zaino vs la borsa al lavoro",
    "La penna blu vs la penna nera",

    # ─── LA VITA NEL 2024-2025 ───
    "L'intelligenza artificiale nel quotidiano",
    "I robot domestici","Le stampanti 3D casalinghe",
    "La guida autonoma","SpaceX","Il turismo spaziale",
    "Il lavoro da freelance","Il coworking",
    "Le tiny house","Il van life","Il workation",
    "Il digital nomad","Il ritorno alla natura",
    "Le case container","Gli spazi di co-living",
]
