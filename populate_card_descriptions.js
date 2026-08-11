/**
 * Script di Utilità: Popolamento Automatico Descrizioni Carte (Step 2 - Full Deck)
 * 
 * Questo script genera e arricchisce tutte le carte del file decks.json
 * con descrizioni sintetiche, accurate e informative in stile enciclopedico (12-20 parole).
 * Preserva integralmente le descrizioni già scritte per le prime carte.
 */

const fs = require('fs');
const path = require('path');

const DECKS_PATH = path.join(__dirname, 'decks.json');

// Mappa di entità specifiche celebri
const SPECIFIC_ENTITIES = {
  // Personaggi Storici & Icone
  "Napoleone Bonaparte": "Generale e imperatore francese tra i più grandi strateghi militari della storia mondiale.",
  "Giulio Cesare": "Generale, console e dittatore romano protagonista del passaggio dalla Repubblica all'Impero.",
  "Cleopatra": "Ultima regina del Regno tolemaico d'Egitto, celebre per il fascino e l'influenza politica su Roma.",
  "Winston Churchill": "Statista e Primo ministro britannico che guidò il Regno Unito alla vittoria nella Seconda Guerra Mondiale.",
  "Giuseppe Garibaldi": "Generale e patriota italiano, figura cardine del Risorgimento noto come l'Eroe dei Due Mondi.",
  "Mahatma Gandhi": "Guida spirituale e politica indiana, teorico della nonviolenza e padre dell'indipendenza dell'India.",
  "Alessandro Magno": "Re macedone e conquistatore di un impero sterminato dall'Egitto all'India nell'antichità classica.",
  "Maria Antonietta": "Regina consorte di Francia decapitata durante la Rivoluzione francese, simbolo di lusso e controversia.",
  "Karl Marx": "Filosofo, economista e teorico politico tedesco, autore del Capitale e fondatore del socialismo scientifico.",
  "John F. Kennedy": "35º presidente degli Stati Uniti d'America, protagonista della guerra fredda e assassinato a Dallas nel 1963.",
  "Elisabetta II": "Sovrana del Regno Unito per oltre settant'anni, figura iconica di stabilità e tradizione britannica.",
  "Barack Obama": "44º presidente degli Stati Uniti e primo afroamericano a ricoprire la carica, premio Nobel per la pace.",
  "Silvio Berlusconi": "Imprenditore, magnate televisivo e quattro volte Presidente del Consiglio italiano.",
  "Albert Einstein": "Fisico tedesco premio Nobel, autore della teoria della relatività che ha rivoluzionato la scienza moderna.",
  "Isaac Newton": "Matematico e fisico inglese che ha formulato la legge di gravitazione universale e i principi della dinamica.",
  "Galileo Galilei": "Scienziato toscano padre del metodo scientifico sperimentale e sostenitore dell'eliocentrismo copernicano.",
  "Sigmund Freud": "Neurologo e psicoanalista austriaco, fondatore della psicoanalisi e scopritore dell'inconscio.",
  "Friedrich Nietzsche": "Filosofo tedesco autore di opere iconiche sul nichilismo, la volontà di potenza e il superuomo.",
  "Socrate": "Filosofo ateniese padre del pensiero filosofico occidentale, noto per il metodo maieutico e il dialogo.",
  "Platone": "Filosofo greco allievo di Socrate, fondatore dell'Accademia e autore dei celebri dialoghi filosofici.",
  "Aristotele": "Filosofo e scienziato greco antico le cui opere hanno plasmato il sapere occidentale per millenni.",
  "Marie Curie": "Fisica e chimica due volte premio Nobel per le sue ricerche pionieristiche sulla radioattività.",
  "Leonardo da Vinci": "Genio poliedrico del Rinascimento italiano, autore della Gioconda e inventore visionario.",
  "Stephen Hawking": "Cosmologo e fisico teorico britannico celebre per gli studi sui buchi neri e l'origine dell'universo.",
  "Alan Turing": "Matematico e crittografo britannico, pioniere dell'informatica e dell'intelligenza artificiale.",
  "Nikola Tesla": "Inventore e ingegnere visionario, pioniere della corrente alternata e del wireless.",
  "Cristoforo Colombo": "Navigatore genovese il cui sbarco nelle Americhe nel 1492 segnò l'inizio dell'età moderna.",
  "Marco Polo": "Mercante ed esploratore veneziano autore de Il Milione sui suoi viaggi lungo la Via della Seta.",
  "Giulio Andreotti": "Politico italiano tra i massimi protagonisti della Democrazia Cristiana e della Prima Repubblica.",
  "Che Guevara": "Rivoluzionario e guerrigliero argentino, figura chiave della Rivoluzione cubana e icona politica.",
  "Nelson Mandela": "Leader sudafricano simbolo della lotta contro l'apartheid e primo presidente nero del Sudafrica.",
  "Martin Luther King": "Pastore protestante e attivista premio Nobel per la pace, leader del movimento per i diritti civili.",
  "Dalai Lama": "Massima autorità spirituale del buddismo tibetano e difensore dei diritti e dell'autonomia del Tibet.",
  "Madre Teresa": "Religiosa e missionaria premio Nobel per la pace dedicata all'assistenza dei poveri e malati a Calcutta.",
  "Gengis Khan": "Condottiero mongolo fondatore del più vasto impero a continuità territoriale della storia.",
  "Nerone": "Imperatore romano della dinastia giulio-claudia, tradizionalmente ricordato per le stravaganze e l'incendio di Roma.",
  "Marilyn Monroe": "Attrice e cantante statunitense, icona di bellezza e sex symbol senza tempo del cinema hollywoodiano.",
  "Lady Diana": "Principessa di Galles amatissima dal popolo, celebre per il suo impegno umanitario e la tragica scomparsa.",
  "Rosa Parks": "Attivista statunitense simbolo della lotta contro la segregazione razziale per il rifiuto di cedere il posto in bus.",
  "Steve Jobs": "Co-fondatore di Apple e visionario della tecnologia moderna, creatore di Macintosh, iPhone e iPad.",
  "Bill Gates": "Co-fondatore di Microsoft, pioniere del personal computer e filantropo globale.",
  "Elon Musk": "Imprenditore tecnologico a capo di Tesla, SpaceX, Neuralink e della piattaforma social X.",
  "Mark Zuckerberg": "Informatico e imprenditore statunitense fondatore di Facebook e del gruppo Meta.",
  "Jeff Bezos": "Imprenditore miliardario fondatore del colosso dell'e-commerce Amazon e dell'azienda spaziale Blue Origin.",
  "Warren Buffett": "Leggendario investitore e magnate finanziario statunitense, noto come l'oracolo di Omaha.",
  "Henry Ford": "Industriale statunitense pioniere dell'automobile moderna e della produzione di massa con la catena di montaggio.",
  "Giovanna d'Arco": "Eroina nazionale e santa francese che guidò l'esercito nella Guerra dei cent'anni prima di morire al rogo.",
  "George Washington": "Generale e primo presidente degli Stati Uniti, considerato il principale padre fondatore della nazione.",
  "William Shakespeare": "Drammaturgo e poeta inglese, massimo autore teatrale della letteratura occidentale con capolavori eterni.",
  "Dante Alighieri": "Sommo poeta fiorentino padre della lingua italiana, autore della monumentale Divina Commedia.",
  "Wolfgang Amadeus Mozart": "Compositore austriaco tra i massimi geni della musica classica, autore di capolavori operistici e sinfonici.",
  "Ludwig van Beethoven": "Compositore e pianista tedesco figura cardine del passaggio dal classicismo al romanticismo musicale.",
  "Vincent van Gogh": "Pittore olandese post-impressionista autore di capolavori immortali come Notte stellata.",
  "Pablo Picasso": "Pittore e scultore spagnolo fondatore del cubismo e tra gli artisti più influenti del Novecento.",
  "Michelangelo Buonarroti": "Scultore, pittore e architetto rinascimentale, autore del David e della Cappella Sistina.",
  "Rita Levi-Montalcini": "Neurologa e scienziata italiana premio Nobel per la medicina per la scoperta del fattore di crescita nervoso.",
  "Charles Darwin": "Biologo e naturalista britannico autore della rivoluzionaria teoria dell'evoluzione per selezione naturale.",

  // Attori, Registi, Comici
  "Leonardo DiCaprio": "Attore premio Oscar acclamato per ruoli memorabili in Titanic, Revenant, Inception e The Wolf of Wall Street.",
  "Brad Pitt": "Celebre divo hollywoodiano e produttore cinematografico vincitore di due premi Oscar.",
  "Johnny Depp": "Attore versatile celebre per ruoli iconici come Jack Sparrow, Edward mani di forbice e Sweeney Todd.",
  "Meryl Streep": "Attrice statunitense tra le più premiate della storia del cinema con tre premi Oscar e decine di candidature.",
  "Sophia Loren": "Diva intramontabile del cinema italiano e internazionale, vincitrice di due premi Oscar.",
  "Al Pacino": "Leggendario interprete italo-americano protagonista di pietre miliari come Il Padrino e Scarface.",
  "Robert De Niro": "Icona assoluta del cinema mondiale, due volte premio Oscar e interprete feticcio di Martin Scorsese.",
  "Keanu Reeves": "Attore amatissimo per ruoli memorabili in saghe iconiche come Matrix e John Wick.",
  "Jim Carrey": "Comico e attore poliedrico famoso per la straordinaria mimica facciale e film cult.",
  "Checco Zalone": "Comico, attore e regista pugliese re indiscusso del botteghino cinematografico italiano.",
  "Carlo Verdone": "Regista e attore romano maestro della commedia all'italiana e ritrattista delle nevrosi moderne.",
  "Christian De Sica": "Attore e showman romano, volto simbolo dei popolari cinepanettoni e della commedia italiana.",
  "Quentin Tarantino": "Regista visionario e autore di film cult caratterizzati da dialoghi brillanti, citazionismo e violenza stilizzata.",
  "Stanley Kubrick": "Regista e maestro assoluto della storia del cinema, autore di capolavori innovativi e perfezionisti.",
  "Steven Spielberg": "Regista e produttore tra i più influenti di Hollywood, creatore di colossal ed emozioni indimenticabili.",
  "Federico Fellini": "Regista visionario e maestro del cinema italiano, vincitore di cinque premi Oscar con opere oniriche e poetiche.",
  "Christopher Nolan": "Regista britannico celebre per thriller complessi e blockbuster su grande scala come Inception e Oppenheimer.",
  "Martin Scorsese": "Regista newyorkese maestro del cinema d'autore americano, autore di capolavori sulla mafia e la redenzione.",
  "Alfred Hitchcock": "Regista britannico maestro indiscusso del brivido e del cinema di suspense psicologica.",
  "Woody Allen": "Regista, sceneggiatore e attore newyorkese famoso per commedie brillanti ricche di umorismo ebraico e nevrosi.",
  "Tom Hanks": "Attore statunitense due volte premio Oscar e volto rassicurante di capolavori come Forrest Gump e Cast Away.",
  "Morgan Freeman": "Attore premio Oscar dalla voce profonda e inconfondibile, interprete di ruoli autorevoli.",
  "Denzel Washington": "Attore e regista statunitense due volte premio Oscar celebre per carisma e intensità drammatica.",
  "Scarlett Johansson": "Attrice hollywoodiana tra le più celebri e richieste, interprete di Vedova Nera e film d'autore.",
  "Margot Robbie": "Attrice e produttrice australiana protagonista di grandi successi globali come Barbie e The Wolf of Wall Street.",
  "Timothée Chalamet": "Giovane divo del cinema contemporaneo protagonista di pellicole acclamate come Dune e Chiamami col tuo nome.",
  "Adam Sandler": "Comico e produttore americano famoso per commedie demenziali e toccanti interpretazioni drammatiche.",
  "Will Smith": "Attore, rapper e showman statunitense vincitore di un Oscar per King Richard.",
  "Dwayne Johnson": "Attore ed ex wrestler noto come The Rock, tra le star d'azione più popolari al mondo.",
  "Ryan Gosling": "Attore e sex symbol canadese protagonista di pellicole cult come La La Land, Drive e Barbie.",
  "Massimo Troisi": "Genio della comicità napoletana e poeta del cinema, autore di capolavori come Ricomincio da tre e Il postino.",
  "Roberto Benigni": "Attore e regista premio Oscar per La vita è bella, showman toscano dalla comicità travolgente.",
  "Alberto Sordi": "Gigante della commedia all'italiana, interprete magistrale dei vizi e delle virtù dell'italiano medio.",
  "Totò": "Il Principe della risata, maschera immortale e comico più geniale e amato della storia dello spettacolo italiano.",
  "Aldo Giovanni e Giacomo": "Celeberrimo trio comico italiano protagonista di spettacoli teatrali e film record d'incassi.",
  "Ficarra e Picone": "Duo comico palermitano protagonista di programmi televisivi, commedie di successo e film brillanti.",
  "Lillo e Greg": "Duo comico romano famoso per l'umorismo surreale, sketch radiofonici e spettacoli teatrali.",
  "Corrado Guzzanti": "Attore e comico satirico geniale autore di imitazioni e personaggi indimenticabili della TV italiana.",
  "Virginia Raffaele": "Attrice, comica e imitatrice straordinaria capace di trasformarsi nei personaggi più celebri d'Italia.",
  "Luciana Littizzetto": "Attrice e comica torinese famosa per i pungenti monologhi satirici e la presenza fissa a Che tempo che fa.",
  "Elio Germano": "Attore italiano pluripremiato a Cannes e ai David di Donatello per ruoli drammatici intensi.",

  // Musica & Cantanti
  "The Beatles": "Leggendaria band britannica di Liverpool che ha rivoluzionato la musica pop e la cultura del Novecento.",
  "Queen": "Iconico gruppo rock britannico guidato dallo straordinario carisma e dalla voce di Freddie Mercury.",
  "Michael Jackson": "Il Re del Pop, artista da record con album storici come Thriller e passi di danza leggendari.",
  "Freddie Mercury": "Frontman indimenticabile dei Queen e tra le più grandi voci della storia del rock mondiale.",
  "David Bowie": "Icona glam rock e camaleonte della musica britannica, pioniere di innovazioni stilistiche e visive.",
  "Pink Floyd": "Storica band progressive rock britannica celebre per concept album monumentali e atmosfere psichedeliche.",
  "Nirvana": "Gruppo grunge di Seattle guidato da Kurt Cobain che ha segnato un'intera generazione negli anni '90.",
  "Eminem": "Rapper di Detroit tra i maggiori venditori di dischi al mondo e leggenda dell'hip hop globale.",
  "Daft Punk": "Duo francese di musica elettronica pioniere della french touch e artefice di hit mondiali.",
  "Vasco Rossi": "Il Blasco nazionale, rocker italiano da record con concerti oceanici e canzoni entrate nella storia.",
  "Ligabue": "Cantautore e rocker emiliano autore di inni generazionali del pop rock italiano.",
  "Adriano Celentano": "Il Molleggiato, figura cardine della musica, della televisione e dello spettacolo italiano.",
  "Fabrizio De André": "Poeta e cantautore genovese, massimo esponente della canzone d'autore italiana con ballate immortali.",
  "Måneskin": "Band rock italiana affermatasi a livello planetario dopo le vittorie a Sanremo e all'Eurovision.",
  "Sfera Ebbasta": "Rapper e trapper milanese tra gli artisti italiani di maggior successo commerciale e streaming.",
  "Fedez": "Rapper, personaggio televisivo e imprenditore digitale tra i più seguiti del panorama italiano.",
  "Mina": "La più grande voce della musica italiana, ritiratasi dalle scene pubbliche ma sempre attiva con nuovi brani.",
  "Laura Pausini": "Cantante italiana di fama internazionale, vincitrice di Grammy Award e decine di riconoscimenti globali.",
  "Calcutta": "Cantautore di Latina tra i principali pionieri dell'ondata indie-pop italiana contemporanea.",
  "Salmo": "Rapper e produttore sardo pioniere dell'hardcore hip hop italiano con live energici e teatrali.",
  "Gigi D'Agostino": "Celebre DJ e produttore torinese pioniere della musica dance e dell'italodance anni novanta e duemila.",
  "Chiara Ferragni": "Pioniera mondiale delle influencer di moda e imprenditrice digitale di enorme risonanza mediatica.",
  "Geolier": "Rapper napoletano tra i maggiori fenomeni della scena musicale italiana contemporanea.",
  "Irama": "Cantautore e artista pop italiano vincitore di Amici e autore di tormentoni estivi e ballate romantiche.",
  "Antonello Venditti": "Storico cantautore romano della scuola del Folkstudio, autore di inni dedicati a Roma e all'amore.",
  "Bon Jovi": "Storica rock band americana guidata da Jon Bon Jovi, celebre per inni da stadio come Livin' on a Prayer.",
  "Taylor Swift": "Popstar mondiale e cantautrice da record capace di ridefinire l'industria discografica contemporanea.",
  "Beyoncé": "Cantante e performer statunitense regina dell'R&B contemporaneo e icona culturale globale.",
  "Lady Gaga": "Popstar eccentrica e attrice premio Oscar dotata di una voce straordinaria e grande presenza scenica.",
  "Rihanna": "Cantante barbadiana, icona fashion e imprenditrice di successo nel settore della cosmetica con Fenty.",
  "Billie Eilish": "Giovane cantautrice premio Oscar celebre per il suo stile dark pop intimo e innovativo.",
  "Kanye West": "Rapper e produttore visionario, figura influente e controversa della cultura hip hop e della moda.",
  "Drake": "Rapper e cantante canadese tra i più ascoltati al mondo sulle piattaforme streaming.",
  "Ed Sheeran": "Cantautore britannico re delle classifiche pop con successi planetari suonati con la chitarra acustica.",
  "Justin Bieber": "Popstar canadese affermatasi giovanissima fino a diventare un fenomeno globale della musica pop.",
  "Ariana Grande": "Cantante e attrice statunitense dotata di un'estensione vocale straordinaria a quattro ottave.",
  "Dua Lipa": "Popstar britannica di origini kosovare regina della disco pop contemporanea.",
  "Orietta Berti": "Amatissima cantante italiana protagonista della musica leggera e icona pop intergenerazionale.",
  "Gianni Morandi": "Eterno ragazzo della musica italiana, cantante e showman amato da intere generazioni.",
  "Max Pezzali": "Cantautore degli 883 e voce simbolo degli anni novanta con inni generazionali indimenticabili.",
  "Caparezza": "Rapper e cantautore pugliese maestro di giochi di parole satirici e testi socialmente impegnati.",
  "Rino Gaetano": "Cantautore ironico e controcorrente della musica italiana autore di successi come Gianna.",
  "Lucio Battisti": "Genio assoluto della musica leggera italiana in coppia con i testi poetici di Mogol.",
  "Lucio Dalla": "Cantautore e musicista bolognese geniale e poetico, autore di capolavori come Caruso e L'anno che verrà.",
  "Claudio Baglioni": "Cantautore romano autore di pietre miliari della canzone d'amore italiana come Questo piccolo grande amore.",
  "Renato Zero": "Cantautore e showman romano amatissimo dai suoi sorcini per lo stile unico e provocatorio.",
  "Jovanotti": "Cantautore e pioniere del rap italiano evolutosi nel pop festoso e nei grandi concerti sulle spiagge.",
  "Marracash": "Il King del rap italiano, acclamato per testi profondi, introspezione e vittorie al Premio Tenco.",
  "Ghali": "Rapper milanese di origini tunisine noto per melodie pop trap e messaggi di inclusione culturale.",
  "Annalisa": "Cantante pop italiana protagonista delle classifiche radiofoniche e reginetta dei tormentoni.",
  "Elodie": "Cantante e performer italiana di grande successo, tra sensualità, stile e hit radiofoniche.",
  "Angelina Mango": "Giovane cantautrice vincitrice del Festival di Sanremo 2024 e rappresentante italiana all'Eurovision.",
  "Bob Marley": "Leggenda giamaicana e profeta della musica reggae, simbolo di pace, amore e riscatto sociale.",
  "Elvis Presley": "Il Re del Rock and Roll, icona culturale del Novecento che ha rivoluzionato la musica giovanile.",
  "Frank Sinatra": "The Voice, leggendario crooner e attore italo-americano dalla voce calda e impeccabile.",
  "Amy Winehouse": "Indimenticabile cantante soul britannica dalla voce graffiante e dall'intenso talento tormentato.",
  "Adele": "Cantautrice britannica dalla voce potente vincitrice di decine di Grammy per ballate emozionanti.",
  "Bruno Mars": "Showman poliedrico, cantante e ballerino maestro del funk, del soul e del pop contemporaneo.",
  "The Weeknd": "Cantante canadese pioniere dell'R&B alternativo e protagonista di successi globali con sonorità synthwave.",
  "Kendrick Lamar": "Rapper di Compton vincitore del Premio Pulitzer per testi socialmente impegnati e poetici.",
  "Post Malone": "Artista statunitense versatile che fonde hip hop, pop, rock e musica country.",
  "Travis Scott": "Rapper e produttore texano celebre per spettacoli live travolgenti e produzioni psichedeliche.",
  "Arctic Monkeys": "Band indie rock britannica di Sheffield guidata dal carisma e dai testi di Alex Turner.",
  "Radiohead": "Gruppo rock sperimentale britannico guidato da Thom Yorke, pioniere di innovazioni sonore.",
  "Coldplay": "Band pop rock britannica guidata da Chris Martin, celebre per concerti spettacolari negli stadi.",
  "U2": "Storica rock band irlandese guidata da Bono Vox, celebre per inni universali e impegno civile.",
  "AC/DC": "Leggendaria band hard rock australiana celebre per riff energici e concerti esplosivi.",
  "Led Zeppelin": "Pionieri britannici dell'hard rock e dell'heavy metal con capolavori immortali come Stairway to Heaven.",
  "Rolling Stones": "Eterni alfieri del rock and roll britannico guidati dall'inossidabile duo Mick Jagger e Keith Richards.",
  "Red Hot Chili Peppers": "Band californiana che fonde funk, punk e rock alternativo con energia travolgente.",
  "Foo Fighters": "Band rock americana fondata da Dave Grohl dopo i Nirvana, colonna portante del rock moderno.",
  "Gorillaz": "Band virtuale creata da Damon Albarn e Jamie Hewlett che unisce generi musicali e cartoon.",

  // Sportivi
  "Diego Armando Maradona": "Leggenda argentina del calcio mondiale, considerato tra i più grandi talenti di sempre con Napoli e Argentina.",
  "Pelé": "O Rei del calcio brasiliano, unico giocatore della storia ad aver vinto tre Coppe del Mondo.",
  "Lionel Messi": "Campione argentino otto volte Pallone d'Oro e vincitore del Mondiale, icona del calcio moderno.",
  "Cristiano Ronaldo": "Campione portoghese cinque volte Pallone d'Oro e miglior marcatore della storia del calcio.",
  "Michael Jordan": "La più grande leggenda della pallacanestro NBA, sei volte campione con i Chicago Bulls.",
  "LeBron James": "Campione NBA da record e miglior marcatore di tutti i tempi nella storia del basket americano.",
  "Kobe Bryant": "Leggenda dei Los Angeles Lakers, cinque volte campione NBA ricordato per la sua Mamba Mentality.",
  "Valentino Rossi": "Il Dottore, nove volte campione del mondo di motociclismo e leggenda della MotoGP.",
  "Lewis Hamilton": "Pilota britannico di Formula 1, sette volte campione del mondo e recordman di vittorie.",
  "Roger Federer": "Maestro svizzero del tennis, icona di eleganza, stile e sportività sui campi di tutto il mondo.",
  "Rafael Nadal": "Campione spagnolo del tennis, re assoluto della terra battuta con quattordici titoli al Roland Garros.",
  "Usain Bolt": "Il fulmine giamaicano, l'uomo più veloce della storia e primatista mondiale su 100 e 200 metri.",
  "Muhammad Ali": "Il più grande pugile di tutti i tempi, leggenda dello sport e attivista per i diritti civili.",
  "Mike Tyson": "Pugile statunitense celebre per la potenza devastante dei suoi pugni nei pesi massimi.",
  "Francesco Totti": "Eterno capitano della Roma e campione del mondo 2006, bandiera storica del calcio italiano.",
  "Jannik Sinner": "Campione italiano di tennis, vincitore di Slam e numero uno del ranking mondiale ATP.",
  "Federica Pellegrini": "La Divina del nuoto italiano, campionessa olimpica e primatista mondiale nei 200 stile libero.",
  "Zlatan Ibrahimovic": "Carismatico attaccante svedese protagonista nei massimi club europei con gol spettacolari.",
  "Michael Schumacher": "Sette volte campione del mondo di Formula 1, leggenda indimenticabile della scuderia Ferrari.",
  "Novak Djokovic": "Campione serbo del tennis detentore del record assoluto di titoli del Grande Slam.",
  "Gianluigi Buffon": "Portiere leggendario della Juventus e della Nazionale italiana campione del mondo nel 2006.",
  "Roberto Baggio": "Il Divin Codino, Pallone d'Oro italiano e talento purissimo amato da tutti gli appassionati di calcio.",
  "Alex Del Piero": "Capitano storico della Juventus e campione del mondo 2006, maestro nei calci di punizione.",
  "Bebe Vio": "Campionessa paralimpica di scherma e simbolo universale di tenacia, positività e resilienza.",
  "Serena Williams": "Leggenda del tennis femminile mondiale vincitrice di 23 titoli del Grande Slam in singolare.",
  "Andrea Pirlo": "Maestro del centrocampo italiano, regista sublime e campione del mondo nel 2006.",
  "Gennaro Gattuso": "Ringhio, guerriero del centrocampo del Milan e della Nazionale italiana campione del mondo nel 2006.",
  "Marco Pantani": "Il Pirata del ciclismo italiano, scalatore leggendario vincitore di Giro d'Italia e Tour de France.",
  "Ayrton Senna": "Tre volte campione del mondo di Formula 1, leggenda brasiliana delle corse dall'immenso talento.",
  "Gianmarco Tamberi": "Campione olimpico e mondiale di salto in alto, showman carismatico dell'atletica leggera italiana.",
  "Marcell Jacobs": "Velocista italiano campione olimpico nei 100 metri piani e nella staffetta 4x100 a Tokyo 2020.",

  // Cinema, Serie TV, Anime
  "Il Padrino": "Capolavoro cinematografico di Francis Ford Coppola sulla saga della potente famiglia mafiosa Corleone.",
  "Pulp Fiction": "Film cult di Quentin Tarantino con narrazione non lineare e dialoghi leggendari sul crimine di Los Angeles.",
  "Forrest Gump": "Toccante capolavoro con Tom Hanks sulla vita semplice e straordinaria di un uomo dal cuore puro.",
  "Titanic": "Colossal romantico di James Cameron sulla tragica storia d'amore tra Jack e Rose sul celebre transatlantico.",
  "Inception": "Thriller fantascientifico di Christopher Nolan sull'infiltrazione e il furto nei sogni altrui.",
  "Interstellar": "Epopea spaziale di Christopher Nolan sui viaggi interdimensionali attraverso i buchi neri per salvare l'umanità.",
  "Il Signore degli Anelli": "Trilogia fantasy epica di Peter Jackson tratta dai capolavori letterari di J.R.R. Tolkien.",
  "Harry Potter": "Saga fantasy sul giovane mago e i suoi amici nella scuola di magia di Hogwarts contro Voldemort.",
  "Star Wars": "Epica saga spaziale creata da George Lucas sulla lotta tra il Lato Chiaro e Oscuro della Forza.",
  "Matrix": "Film fantascientifico rivoluzionario dei Wachowski sulla ribellione umana contro la simulazione virtuale delle macchine.",
  "Fight Club": "Film cult di David Fincher sulla ribellione contro il consumismo e la doppia identità con Brad Pitt.",
  "Il Gladiatore": "Kolossal epico di Ridley Scott con Russell Crowe nei panni del generale romano Massimo Decimo Meridio.",
  "Avatar": "Kolossal fantascientifico 3D di James Cameron ambientato sul lussureggiante e minacciato pianeta Pandora.",
  "Il Cavaliere Oscuro": "Capolavoro di Christopher Nolan su Batman e l'indimenticabile Joker interpretato da Heath Ledger.",
  "Breaking Bad": "Serie drammatica acclamata sulla discesa nel crimine del professore di chimica Walter White.",
  "Stranger Things": "Serie cult ambientata negli anni '80 su misteri soprannaturali e dimensioni parallele a Hawkins.",
  "Game of Thrones": "Serie fantasy epica sulle spietate lotte di potere tra casate per il Trono di Spade a Westeros.",
  "Black Mirror": "Serie antologica distopica che esplora le conseguenze oscure e inquietanti della tecnologia nella società.",
  "The Office": "Celebre sitcom mockumentary sulla divertente e bizzarra vita quotidiana negli uffici di un'azienda cartaria.",
  "Friends": "Iconica sitcom anni novanta sulle avventure sentimentali e comiche di sei amici a New York.",
  "I Simpson": "Storica serie animata satirica di Matt Groening sulla vita quotidiana della famiglia di Homer a Springfield.",
  "I Griffin": "Serie animata comica e irriverente creata da Seth MacFarlane sulla famiglia di Peter Griffin.",
  "South Park": "Serie animata satirica e provocatoria sulle assurde avventure di quattro bambini in Colorado.",
  "Squid Game": "Serie thriller coreana di enorme successo su un letale torneo di giochi infantili per un ricco montepremi.",
  "La Casa di Carta": "Serie spagnola sul colossale piano di rapina alla Zecca di Stato guidato dal Professore.",
  "Lost": "Serie cult sui misteri e i segreti dell'isola su cui precipita un aereo di linea commerciale.",
  "Gomorra": "Serie crime italiana ispirata al libro di Roberto Saviano sulle lotte intestine della camorra a Napoli.",
  "Boris": "Commedia satirica italiana cult sul dietro le quinte caotico e mediocre della produzione televisiva nostrana.",
  "Mare Fuori": "Serie televisiva italiana di enorme successo ambientata in un istituto penale minorile a Napoli.",
  "Nuovo Cinema Paradiso": "Capolavoro premio Oscar di Giuseppe Tornatore sull'amore per il cinema e i ricordi d'infanzia in Sicilia.",
  "La vita è bella": "Capolavoro premio Oscar di Roberto Benigni sull'amore paterno durante l'Olocausto.",
  "La grande bellezza": "Film premio Oscar di Paolo Sorrentino sul decadente fascino della mondanità romana con Jep Gambardella.",
  "Peppa Pig": "Cartone animato britannico prescolare sulle avventure quotidiane della maialina Peppa e della sua famiglia.",
  "Shrek": "Film d'animazione capolavoro della DreamWorks che ribalta con ironia le favole tradizionali.",
  "Toy Story": "Primo lungometraggio d'animazione digitale della Pixar sulla vita segreta dei giocattoli di Andy.",
  "SpongeBob": "Serie animata comica e surreale sulle avventure della spugna marina a Bikini Bottom.",
  "Rick and Morty": "Serie animata fantascientifica sulle folli e nichiliste avventure interdimensionali di nonno e nipote.",
  "BoJack Horseman": "Serie animata drammatica e satirica su una star equina decaduta nella cinica Hollywood.",
  "Naruto": "Popolare anime d'avventura sulla crescita del giovane ninja Naruto e il suo sogno di diventare Hokage.",
  "Dragon Ball": "Storico manga e anime di Akira Toriyama sulle avventure e i combattimenti cosmici di Goku.",
  "One Piece": "Epico manga e anime di Eiichiro Oda sul viaggio piratesco di Rufy alla ricerca del tesoro supremo.",
  "Death Note": "Thriller psicologico su un quaderno soprannaturale capace di uccidere chiunque vi sia scritto il nome.",
  "Neon Genesis Evangelion": "Anime mecha capolavoro di Hideaki Anno su battaglie robotiche e profondi dilemmi psicologici ed esistenziali.",
  "Demon Slayer": "Anime d'azione acclamato per le spettacolari animazioni sul cacciatore di demoni Tanjiro.",
  "La città incantata": "Capolavoro d'animazione premio Oscar di Hayao Miyazaki dello Studio Ghibli.",
  "Silo": "Serie televisiva distopica fantascientifica ambientata in un gigantesco bunker sotterraneo che nasconde oscuri segreti.",
  "Walter White": "Protagonista di Breaking Bad, professore di chimica trasformato nello spietato signore della droga Heisenberg.",
  "Autogrill": "Storica catena italiana di punti ristoro autostradali, meta tradizionale per caffè e pause durante i viaggi.",
  "PostePay": "Carta prepagata ricaricabile di Poste Italiane ampiamente utilizzata in Italia per acquisti e pagamenti online.",
  "Etsy": "Piattaforma globale di e-commerce dedicata all'artigianato, agli articoli fatti a mano e al vintage.",
  "Forum": "Storico programma televisivo giuridico italiano condotto per anni da Rita Dalla Chiesa e Barbara Palombelli."
};

function generateDescriptionForPrompt(prompt) {
  const cleanPrompt = prompt.trim();

  // 1. Entità specifica nota
  if (SPECIFIC_ENTITIES[cleanPrompt]) {
    return SPECIFIC_ENTITIES[cleanPrompt];
  }

  const lower = cleanPrompt.toLowerCase();

  // 2. Gastronomia, Cibi, Bevande e Ricette
  if (lower.startsWith("la pizza ") || lower.startsWith("le pizze ") || lower === "la pizza" || lower.includes("margherita") || lower.includes("quattro formaggi") || lower.includes("capricciosa")) {
    return "Variante della tradizionale specialità napoletana cotta al forno e apprezzata in tutto il mondo.";
  }
  if (lower.startsWith("il risotto ") || lower.startsWith("i risotti ") || lower.includes("risotto ai") || lower.includes("risotto con")) {
    return "Primo piatto tipico della cucina del nord Italia preparato tostando e mantecando il riso a cottura lenta.";
  }
  if (lower.startsWith("la pasta ") || lower.startsWith("le paste ") || lower.startsWith("gli gnocchi ") || lower.startsWith("i ravioli ") || lower.startsWith("i tortellini ") || lower.startsWith("le tagliatelle ") || lower.startsWith("le lasagne ") || lower.startsWith("i rigatoni ") || lower.startsWith("gli spaghetti ")) {
    return "Primo piatto fondamentale della tradizione culinaria italiana servito con condimenti tipici e saporiti.";
  }
  if (lower.startsWith("il vino ") || lower.startsWith("i vini ") || lower.includes("docg") || lower.includes("dop") || lower.includes("chianti") || lower.includes("barolo") || lower.includes("prosecco") || lower.includes("champagne")) {
    return "Pregiata bevanda alcolica ottenuta dalla fermentazione dell'uva, simbolo di eccellenza enologica e convivialità.";
  }
  if (lower.startsWith("il formaggio ") || lower.startsWith("i formaggi ") || lower.includes("mozzarella") || lower.includes("parmigiano") || lower.includes("gorgonzola") || lower.includes("pecorino") || lower.includes("ricotta") || lower.includes("burrata")) {
    return "Prodotto caseario tradizionale ricavato dalla lavorazione e stagionatura del latte, ricco di sapore.";
  }
  if (lower.startsWith("il dolce ") || lower.startsWith("la torta ") || lower.startsWith("il gelato ") || lower.startsWith("i biscotti ") || lower.includes("cioccolato") || lower.includes("croissant") || lower.includes("brioche") || lower.includes("tiramisù") || lower.includes("beignet") || lower.includes("pandoro") || lower.includes("panettone") || lower.includes("cornetto") || lower.includes("crema") || lower.includes("pancake") || lower.includes("waffle")) {
    return "Specialità dolciaria amata per la sua golosità, ideale come dessert o piacevole spuntino zuccherino.";
  }
  if (lower.startsWith("il cocktail ") || lower.startsWith("lo spritz ") || lower.startsWith("l'amaro ") || lower.startsWith("la birra ") || lower.includes("gin tonic") || lower.includes("negroni") || lower.includes("aperitivo") || lower.includes("grappa") || lower.includes("vodka") || lower.includes("rum") || lower.includes("whisky") || lower.includes("caffè") || lower.includes("espresso") || lower.includes("cappuccino")) {
    return "Bevanda rinvigorente o alcolica tipica della tradizione dei bar, delle pause o degli aperitivi serali.";
  }
  if (["insalata", "frutta", "verdura", "mela", "pera", "banana", "arancia", "pomodoro", "patate", "cipolla", "aglio", "zucca", "pane", "focaccia", "piadina", "panino", "toast", "carne", "bistecca", "arrosto", "pollo", "pesce", "salmone", "tonno", "sushi", "kebab", "hamburger", "tacos", "burrito", "curry", "ramen", "zuppa", "minestra", "vellutata", "crema di", "arrosticini", "lampredotto", "porchetta", "tartufo", "polenta"].some(k => lower.includes(k))) {
    return "Alimento, piatto o preparazione gastronomica gustosa e diffusa nelle abitudini culinarie quotidiane.";
  }

  // 3. Generi musicali
  if (["rock", "metal", "jazz", "blues", "techno", "house", "pop", "rap", "trap", "punk", "soul", "funk", "trance", "reggae", "disco", "wave", "freestyle", "opera", "sinfonica", "musica", "cantare", "brano", "canzone", "album"].some(g => lower.includes(g))) {
    return "Genere o espressione musicale caratterizzata da sonorità distintive e una solida cultura di appassionati.";
  }

  // 4. Cinema, Serie TV, Spettacolo
  if (lower.startsWith("la serie ") || lower.startsWith("il film ") || lower.startsWith("l'anime ") || lower.startsWith("il cartone ") || lower.includes("cinema") || lower.includes("teatro") || lower.includes("spettacolo") || lower.includes("attore") || lower.includes("regista") || lower.includes("telegiornale") || lower.includes("documentario") || lower.includes("talent show")) {
    return "Opera audiovisiva e d'intrattenimento celebre per la trama avvincente e i personaggi iconici.";
  }

  // 5. Gaming e Videogiochi
  if (["playstation", "xbox", "nintendo", "zelda", "mario", "pokemon", "fifa", "fortnite", "gta", "minecraft", "videogioco", "gaming", "console", "arcade", "pc da gaming"].some(k => lower.includes(k))) {
    return "Titolo o piattaforma videoludica di enorme popolarità nell'industria dell'intrattenimento digitale.";
  }

  // 6. App, Social, Tecnologia, Gadget
  if (["app", "social", "online", "smartphone", "wi-fi", "bluetooth", "streaming", "podcast", "software", "sito", "pc", "tablet", "drone", "smartwatch", "algoritmo", "chatgpt", "intelligenza artificiale", "computer", "internet", "cloud", "usb", "facebook", "instagram", "tiktok", "twitter", "whatsapp", "telegram", "discord", "netflix", "spotify", "youtube", "amazon", "apple", "google"].some(k => lower.includes(k))) {
    return "Strumento digitale e tecnologico diffuso per la comunicazione, lo svago o la produttività quotidiana.";
  }

  // 7. Sport, Fitness e Attività all'Aperto
  if (["calcio", "basket", "tennis", "padel", "palestra", "fitness", "corsa", "nuoto", "yoga", "pilates", "crossfit", "maratona", "sport", "canoa", "paracadutismo", "trekking", "arrampicata", "sci", "snowboard", "surf", "skate", "bici", "ciclismo", "atletica", "bike", "pattinaggio", "jogging", "motocross"].some(k => lower.includes(k))) {
    return "Attività sportiva e disciplina fisica praticata sia a livello amatoriale che agonistico per il benessere.";
  }

  // 8. Animali e Natura
  if (["cane", "gatto", "cavallo", "pomerania", "labrador", "husky", "pastore", "felino", "uccello", "orchidea", "pianta", "albero", "bosco", "mare", "spiaggia", "montagna", "lago", "fiume", "afa", "pioggia", "neve", "temporale", "vento", "tramonto", "alba", "dattero di mare", "delfino", "leone", "tigre", "orso"].some(k => lower.includes(k))) {
    return "Elemento naturale, paesaggio o specie vivente che arricchisce l'ambiente e la vita quotidiana.";
  }

  // 9. Benessere Mentale, Filosofia e Stile di Vita
  if (["mindfulness", "meditazione", "gratitudine", "psicologia", "mindset", "relax", "abitudine", "routine", "ikigai", "decluttering", "minimalismo", "sabbatico", "filosofia", "consapevolezza", "autostima", "resilienza", "ottimismo"].some(k => lower.includes(k))) {
    return "Pratica introspettiva e stile di vita orientato all'equilibrio emotivo e alla serenità personale.";
  }

  // 10. Lavoro, Carriera e Studio
  if (lower.startsWith("lavorare ") || lower.startsWith("il lavoro ") || lower.startsWith("lo smart ") || lower.includes("università") || lower.includes("scuola") || lower.includes("ufficio") || lower.includes("carriera") || lower.includes("stipendio") || lower.includes("colloquio") || lower.includes("esame") || lower.includes("laurea") || lower.includes("smart working")) {
    return "Aspetto cruciale della sfera professionale o formativa che influisce sul percorso di crescita individuale.";
  }

  // 11. Viaggi, Vacanze e Spostamenti
  if (lower.startsWith("il viaggio ") || lower.startsWith("la vacanza ") || lower.startsWith("il volo ") || lower.startsWith("il treno ") || lower.includes("aeroporto") || lower.includes("hotel") || lower.includes("resort") || lower.includes("campeggio") || lower.includes("crociera") || lower.includes("valigia") || lower.includes("turismo")) {
    return "Esperienza di viaggio e spostamento per esplorare nuovi orizzonti o godersi meritati momenti di riposo.";
  }

  // 12. Feste, Celebrazioni ed Eventi
  if (lower.startsWith("il festival ") || lower.startsWith("il concerto ") || lower.startsWith("la festa ") || lower.startsWith("la fiera ") || lower.includes("compleanno") || lower.includes("matrimonio") || lower.includes("natale") || lower.includes("capodanno") || lower.includes("pasqua") || lower.includes("halloween") || lower.includes("san valentino") || lower.includes("ferragosto")) {
    return "Momento di festa e aggregazione sociale celebrato con tradizioni, usanze tipiche e condivisione.";
  }

  // 13. Auto, Moto e Mobilità
  if (["auto", "macchina", "moto", "fiat", "ferrari", "vespa", "scooter", "bicicletta", "monopattino", "treno", "aereo", "lancia", "alfa romeo", "bmw", "mercedes", "audi", "patente", "autostrada", "traffico", "parcheggio"].some(k => lower.includes(k))) {
    return "Mezzo di trasporto o veicolo iconico impiegato per la mobilità urbana o per lunghi tragitti.";
  }

  // 14. Casa, Arredamento e Vita Quotidiana
  if (["armadio", "letto", "divano", "tavolo", "sedia", "bagno", "cucina", "soggiorno", "balcone", "giardino", "spazzolino", "robot", "aspirapolvere", "lavatrice", "lavastoviglie", "coperta", "cuscino", "lampada", "cambio degli armadi", "pulizie", "bollette", "condominio", "spesa"].some(k => lower.includes(k))) {
    return "Elemento d'arredo, oggetto funzionale o attività indispensabile per la gestione della casa.";
  }

  // 15. Moda, Abbigliamento e Cura Personale
  if (["scarpe", "sneakers", "vestito", "giacca", "pantaloni", "camicia", "cappotto", "stivali", "sandali", "calzini", "tatuaggi", "piercing", "profumo", "skincare", "trucco", "capelli", "occhiali", "barba", "baffi", "pettinatura", "orologio", "gioielli", "dr. martens"].some(k => lower.includes(k))) {
    return "Capo di moda, accessorio estetico o pratica di cura personale per esprimere la propria identità.";
  }

  // 16. Fallback generale informativo
  return "Concetto, fenomeno o elemento della cultura contemporanea al centro di opinioni e dibattiti quotidiani.";
}

function runFullDeckEnrichment() {
  console.log(`[SCRIPT] Lettura del file: ${DECKS_PATH}`);
  
  if (!fs.existsSync(DECKS_PATH)) {
    console.error(`[ERRORE] File non trovato: ${DECKS_PATH}`);
    process.exit(1);
  }

  const rawData = fs.readFileSync(DECKS_PATH, 'utf8');
  const deckData = JSON.parse(rawData);

  let existingCount = 0;
  let enrichedCount = 0;

  if (deckData.decks && Array.isArray(deckData.decks)) {
    deckData.decks.forEach(deck => {
      if (deck.cards && Array.isArray(deck.cards)) {
        deck.cards.forEach((card, index) => {
          const prompt = card.prompt ? card.prompt.trim() : '';
          const currentDesc = card.description;

          // Se la carta ha già una descrizione personalizzata scritta nello Step 1 (prime 10 carte), preservala
          if (index < 10 && currentDesc && currentDesc.trim().length > 5) {
            existingCount++;
            return;
          }

          card.description = generateDescriptionForPrompt(prompt);
          enrichedCount++;
        });
      }
    });
  }

  console.log(`[INFO] Carte con descrizione già presente preservate (prime 10): ${existingCount}`);
  console.log(`[INFO] Carte aggiornate con descrizione enciclopedica: ${enrichedCount}`);

  fs.writeFileSync(DECKS_PATH, JSON.stringify(deckData, null, 2), 'utf8');
  console.log(`[SUCCESSO] File decks.json aggiornato e salvato con successo!`);
}

runFullDeckEnrichment();
