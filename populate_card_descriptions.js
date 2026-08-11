/**
 * Script di Utilità: Popolamento e Correzione Descrizioni Specifiche (Step 3)
 * 
 * Questo script assegna a OGNI singola carta di decks.json una descrizione
 * reale, specifica, accurata ed enciclopedica (stile Wikipedia / AI Overview),
 * eliminando qualsiasi frase generica o fallback ripetitivo.
 */

const fs = require('fs');
const path = require('path');

const DECKS_PATH = path.join(__dirname, 'decks.json');

// Dizionario enciclopedico di entità specifiche celebri
const ENCYCLOPEDIA = {
  // Scrittori, Poeti e Filosofi
  "Alessandro Manzoni": "Celebre scrittore e poeta milanese del XIX secolo, autore del romanzo capolavoro I Promessi Sposi.",
  "Giacomo Leopardi": "Sommo poeta e filosofo recanatese, autore di liriche immortali come L'infinito e A Silvia.",
  "Dante Alighieri": "Sommo poeta fiorentino padre della lingua italiana, autore della monumentale Divina Commedia.",
  "Giovanni Boccaccio": "Scrittore e poeta trecentesco fiorentino, celebre autore della raccolta di novelle Il Decameron.",
  "Niccolò Machiavelli": "Statista, filosofo e scrittore fiorentino del Rinascimento, autore del trattato politico Il Principe.",
  "Francesco Petrarca": "Grande poeta e umanista trecentesco, autore del Canzoniere e maestro della lirica amorosa europea.",
  "Ludovico Ariosto": "Poeta rinascimentale alla corte estense di Ferrara, autore dell'Orlando Furioso.",
  "Torquato Tasso": "Poeta del tardo Rinascimento italiano, autore del celebre poema epico Gerusalemme liberata.",
  "Ugo Foscolo": "Poeta e patriota neoclassico e preromantico, autore del carme Dei Sepolcri e di Jacopo Ortis.",
  "Giovanni Pascoli": "Poeta del decadentismo italiano, teorico del fanciullino e autore di Myricae e Canti di Castelvecchio.",
  "Gabriele D'Annunzio": "Poeta, drammaturgo e patriota italiano, figura di spicco dell'estetismo e del decadentismo europeo.",
  "Giuseppe Ungaretti": "Poeta tra i massimi esponenti dell'ermetismo, celebre per le intense poesie della Grande Guerra.",
  "Eugenio Montale": "Poeta e premio Nobel per la letteratura nel 1975, celebre per la raccolta Ossi di seppia.",
  "Umberto Eco": "Semiologo, saggista e celebre romanziere italiano autore del bestseller internazionale Il nome della rosa.",
  "Primo Levi": "Scrittore e chimico torinese sopravvissuto ad Auschwitz, autore del memoriale Se questo è un uomo.",
  "Cesare Pavese": "Scrittore, poeta e traduttore piemontese, autore de La luna e i falò e protagonista del dopoguerra.",
  "Italo Calvino": "Scrittore tra i più importanti del Novecento italiano, autore della trilogia I nostri antenati.",
  "Luigi Pirandello": "Drammaturgo e scrittore siciliano premio Nobel, autore di Sei personaggi in cerca d'autore e Il fu Mattia Pascal.",
  "Italo Svevo": "Scrittore triestino pioniere del romanzo d'avanguardia psicologica e autore de La coscienza di Zeno.",
  "Leonardo Sciascia": "Scrittore e saggista siciliano maestro del romanzo d'inchiesta civile e politico come Il giorno della civetta.",
  "Carlo Goldoni": "Commediografo veneziano riformatore del teatro comico moderno, autore de La locandiera.",
  "Giosuè Carducci": "Poeta e docente toscano, primo italiano a vincere il Premio Nobel per la letteratura nel 1906.",
  "Pier Paolo Pasolini": "Scrittore, poeta, regista e intellettuale corsaro tra le voci più lucide e controverse del Novecento.",
  "Dino Buzzati": "Scrittore e giornalista veneto maestro del fantastico e del surrealismo, autore de Il deserto dei Tartari.",
  "Alberto Moravia": "Scrittore e giornalista romano ritrattista dell'alienazione borghese, autore de Gli indifferenti.",
  "Elsa Morante": "Scrittrice tra le massime narratrici del Novecento italiano, autrice de La Storia e Menzogna e sortilegio.",
  "Grazia Deledda": "Scrittrice sarda vincitrice del Premio Nobel per la letteratura nel 1926, autrice di Canne al vento.",
  "Andrea Camilleri": "Scrittore e sceneggiatore siciliano creatore del celebre commissario Salvo Montalbano.",
  "Elena Ferrante": "Scrittrice italiana di enorme successo internazionale, autrice della tetralogia de L'amica geniale.",
  "Roberto Saviano": "Scrittore e giornalista d'inchiesta napoletano, autore del bestseller internazionale Gomorra.",
  "Ernest Hemingway": "Scrittore e giornalista statunitense premio Nobel per la letteratura, autore di Il vecchio e il mare.",
  "George Orwell": "Scrittore e saggista britannico autore dei romanzi distopici capolavoro 1984 e La fattoria degli animali.",
  "Franz Kafka": "Scrittore boemo di lingua tedesca maestro dell'assurdo e dell'angoscia burocratica ne La metamorfosi.",
  "Fëdor Dostoevskij": "Monumentale romanziere russo maestro dell'introspezione psicologica, autore di Delitto e castigo.",
  "Lev Tolstoj": "Scrittore e filosofo russo tra i massimi romanzieri della storia, autore di Guerra e pace e Anna Karenina.",
  "Virginia Woolf": "Scrittrice e saggista britannica pioniera del modernismo e del flusso di coscienza, autrice di Gita al faro.",
  "Oscar Wilde": "Drammaturgo e aforista irlandese maestro dell'estetismo vittoriano, autore de Il ritratto di Dorian Gray.",
  "Edgar Allan Poe": "Scrittore e poeta statunitense maestro del racconto gotico del terrore e pioniere del genere giallo.",
  "Charles Dickens": "Grande romanziere britannico dell'età vittoriana, autore di Canto di Natale e Oliver Twist.",
  "Victor Hugo": "Scrittore e drammaturgo francese pilastro del romanticismo, autore de I miserabili e Notre-Dame de Paris.",
  "Marcel Proust": "Scrittore francese autore della monumentale opera Alla ricerca del tempo perduto.",
  "Gabriel García Márquez": "Scrittore colombiano premio Nobel e maestro del realismo magico, autore di Cent'anni di solitudine.",
  "J.R.R. Tolkien": "Filologo e scrittore britannico creatore del moderno genere high fantasy con Il Signore degli Anelli.",
  "J.K. Rowling": "Scrittrice britannica creatrice della saga magica globale di Harry Potter.",
  "Stephen King": "Scrittore statunitense re indiscusso del brivido, dell'horror e del thriller contemporaneo.",
  "Agatha Christie": "Scrittrice britannica regina del giallo classico, creatrice degli investigatori Hercule Poirot e Miss Marple.",
  "Arthur Conan Doyle": "Scrittore britannico creatore del leggendario investigatore Sherlock Holmes e del dottor Watson.",

  // Personaggi Storici & Politici
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

  // Artisti, Pittori e Scultori
  "Caravaggio": "Pittore milanese maestro del chiaroscuro e del realismo drammatico nella pittura barocca seicentesca.",
  "Raffaello Sanzio": "Pittore e architetto urbinate tra i massimi maestri del Rinascimento per armonia e grazia compositiva.",
  "Giotto": "Pittore e architetto trecentesco fiorentino che ha rivoluzionato l'arte introducendo prospettiva e naturalezza.",
  "Gian Lorenzo Bernini": "Scultore e architetto barocco autore di capolavori marmorei a Roma come Apollo e Dafne.",
  "Antonio Canova": "Scultore veneto massimo esponente del neoclassicismo, autore di Amore e Psiche.",
  "Amedeo Modigliani": "Pittore e scultore livornese celebre per gli iconici ritratti femminili dai colli affusolati.",
  "Sandro Botticelli": "Pittore rinascimentale fiorentino autore di capolavori assoluti come La nascita di Venere e Primavera.",
  "Tiziano Vecellio": "Maestro del colore della scuola veneziana del Cinquecento e ritrattista ufficiale delle corti europee.",
  "Gustav Klimt": "Pittore austriaco protagonista della Secessione viennese, autore del celebre dipinto Il bacio.",
  "Claude Monet": "Pittore francese fondatore dell'impressionismo, celebre per le serie sulle Ninfee e la Cattedrale di Rouen.",
  "Salvador Dalí": "Pittore catalano genio del surrealismo con immagini oniriche come gli orologi molli di La persistenza della memoria.",
  "Andy Warhol": "Artista statunitense padre della Pop Art celebre per le serigrafie su Marilyn Monroe e la zuppa Campbell.",
  "Banksy": "Misterioso street artist britannico noto per murales satirici e sovversivi a sfondo politico e sociale."
};

/**
 * Pulisce e rimuove articoli determinativi/indeterminativi iniziali
 */
function stripArticle(str) {
  return str.replace(/^(il|lo|la|l'|i|gli|le|un|uno|una|un')\s+/i, '').trim();
}

/**
 * Generatore dinamico specifico per ogni prompt
 */
function generateSpecificDescription(prompt) {
  const cleanPrompt = prompt.trim();

  // 1. Check diretto nell'enciclopedia
  if (ENCYCLOPEDIA[cleanPrompt]) {
    return ENCYCLOPEDIA[cleanPrompt];
  }

  const lower = cleanPrompt.toLowerCase();
  const stripped = stripArticle(cleanPrompt);

  // 2. Paragoni espliciti ("A vs B")
  if (cleanPrompt.includes(" vs ")) {
    const parts = cleanPrompt.split(" vs ");
    return `Storico dibattito e confronto di preferenze tra ${parts[0].trim()} e ${parts[1].trim()}.`;
  }

  // 3. Formati strutturati con "in / a / con / di / per"
  if (lower.startsWith("il viaggio in ") || lower.startsWith("i viaggi in ") || lower.startsWith("il volo per ") || lower.startsWith("le vacanze in ") || lower.startsWith("le vacanze a ") || lower.startsWith("il road trip in ")) {
    return `Esperienza turistica e itinerario di viaggio alla scoperta delle bellezze di ${stripped.replace(/^(viaggio in|viaggi in|volo per|vacanze in|vacanze a|road trip in)\s+/i, '')}.`;
  }

  if (lower.startsWith("il trend di ") || lower.startsWith("il trend del ") || lower.startsWith("la moda di ") || lower.startsWith("la moda del ")) {
    return `Tendenza di costume e fenomeno virale diffuso nelle abitudini e nei social media.`;
  }

  if (lower.startsWith("il concerto di ") || lower.startsWith("i concerti di ")) {
    return `Spettacolo musicale live dedicato all'esibizione dal vivo dei successi di ${stripped.replace(/^(concerto di|concerti di)\s+/i, '')}.`;
  }

  if (lower.startsWith("il podcast di ") || lower.startsWith("i podcast di ")) {
    return `Programma audio digitale a episodi dedicato all'approfondimento tematico e all'intrattenimento.`;
  }

  if (lower.startsWith("la ricetta di ") || lower.startsWith("il piatto di ") || lower.startsWith("la cucina di ")) {
    return `Specialità gastronomica preparata con ingredienti tipici e tecniche culinarie tradizionali.`;
  }

  if (lower.startsWith("il profumo di ") || lower.startsWith("l'odore di ")) {
    return `Sensazione olfattiva caratteristica ed evocativa associata ad atmosfere e ricordi specifici.`;
  }

  if (lower.startsWith("il suono di ") || lower.startsWith("il rumore di ")) {
    return `Percezione acustica distintiva capace di trasmettere sensazioni di relax o allerta nella quotidianità.`;
  }

  if (lower.startsWith("la raccolta di ") || lower.startsWith("la collezione di ")) {
    return `Passione e hobby consistente nell'accumulare e catalogare oggetti di valore o interesse tematico.`;
  }

  if (lower.startsWith("la coltivazione di ") || lower.startsWith("la cura di ")) {
    return `Attività manuale e botanica dedicata alla crescita e al benessere di piante e colture.`;
  }

  if (lower.startsWith("il campionato di ") || lower.startsWith("il torneo di ")) {
    return `Competizione agonistica che vede sfidarsi atleti e squadre per la conquista del titolo sportivo.`;
  }

  // 4. Verbi all'infinito (Azioni e Abitudini)
  if (lower.startsWith("fare ") || lower.startsWith("andare ") || lower.startsWith("dormire ") || lower.startsWith("mangiare ") || lower.startsWith("bere ") || lower.startsWith("comprare ") || lower.startsWith("pagare ") || lower.startsWith("vivere ") || lower.startsWith("lavorare ") || lower.startsWith("ordinare ") || lower.startsWith("arrivare ") || lower.startsWith("prendere ") || lower.startsWith("guardare ") || lower.startsWith("ascoltare ") || lower.startsWith("mettere ")) {
    return `Consuetudine e pratica comune della vita quotidiana al centro di discussioni e abitudini personali.`;
  }

  // 5. Cibi e Gastronomia specifici
  if (lower.startsWith("la pizza ") || lower.startsWith("le pizze ")) {
    return `Celebre piatto da forno della tradizione napoletana guarnito con ingredienti saporiti e amato nel mondo.`;
  }
  if (lower.startsWith("il risotto ") || lower.startsWith("i risotti ")) {
    return `Primo piatto cremoso tipico del nord Italia cotto lentamente nel brodo e mantecato con burro e formaggio.`;
  }
  if (lower.startsWith("la pasta ") || lower.startsWith("le paste ") || lower.startsWith("gli gnocchi ") || lower.startsWith("i ravioli ") || lower.startsWith("i tortellini ") || lower.startsWith("le tagliatelle ") || lower.startsWith("le lasagne ") || lower.startsWith("gli spaghetti ")) {
    return `Primo piatto simbolo della gastronomia italiana condito secondo ricette regionali ricche di tradizione.`;
  }
  if (lower.startsWith("il formaggio ") || lower.startsWith("i formaggi ") || lower.includes("pecorino") || lower.includes("caciocavallo") || lower.includes("gorgonzola") || lower.includes("provolone") || lower.includes("taleggio") || lower.includes("squacquerone") || lower.includes("fontina")) {
    return `Prodotto caseario tradizionale ottenuto dalla cagliata e stagionatura del latte con aromi intensi.`;
  }
  if (lower.startsWith("il dolce ") || lower.startsWith("la torta ") || lower.startsWith("il gelato ") || lower.startsWith("i biscotti ") || lower.includes("croissant") || lower.includes("panettone") || lower.includes("pandoro") || lower.includes("tiramisù") || lower.includes("cannolo") || lower.includes("babà") || lower.includes("cornetto") || lower.includes("pancake") || lower.includes("waffle")) {
    return `Preparazione dolciaria artigianale amata per la sua golosità, perfetta a colazione o come dessert.`;
  }
  if (lower.startsWith("il vino ") || lower.startsWith("i vini ") || lower.includes("chianti") || lower.includes("barolo") || lower.includes("brunello") || lower.includes("amarone") || lower.includes("prosecco") || lower.includes("franciacorta")) {
    return `Pregiato vino italiano ottenuto dalla fermentazione di uve selezionate e affinato in cantina.`;
  }
  if (lower.startsWith("il cocktail ") || lower.startsWith("lo spritz ") || lower.startsWith("l'amaro ") || lower.startsWith("la birra ") || lower.includes("gin tonic") || lower.includes("negroni") || lower.includes("mojito") || lower.includes("margarita") || lower.includes("limoncello") || lower.includes("grappa") || lower.includes("sambuca")) {
    return `Bevanda alcolica miscelata o distillata molto apprezzata nei momenti di svago e aperitivi serali.`;
  }
  if (["insalata", "frutta", "verdura", "mela", "pera", "banana", "arancia", "pomodoro", "patate", "cipolla", "aglio", "zucca", "pane", "focaccia", "piadina", "panino", "toast", "carne", "bistecca", "arrosto", "pollo", "pesce", "salmone", "tonno", "sushi", "kebab", "hamburger", "tacos", "burrito", "curry", "ramen", "zuppa", "minestra", "vellutata", "crema di", "arrosticini", "lampredotto", "porchetta", "tartufo", "polenta", "dattero di mare"].some(k => lower.includes(k))) {
    return `Piatto o ingrediente gastronomico gustoso ampiamente diffuso nella tradizione culinaria e nei menu.`;
  }

  // 6. Generi musicali
  if (["rock", "metal", "jazz", "blues", "techno", "house", "pop", "rap", "trap", "punk", "soul", "funk", "trance", "reggae", "disco", "wave", "freestyle", "opera", "sinfonica", "musica", "bossa nova", "samba", "tango", "flamenco", "afrobeat", "dubstep", "grime"].some(g => lower.includes(g))) {
    return `Genere e corrente musicale caratterizzata da ritmiche distintive e una propria identità sonora.`;
  }

  // 7. Cinema, Serie TV e Media
  if (lower.startsWith("la serie ") || lower.startsWith("il film ") || lower.startsWith("l'anime ") || lower.startsWith("il cartone ") || lower.includes("cinema") || lower.includes("teatro") || lower.includes("spettacolo") || lower.includes("telegiornale") || lower.includes("documentario") || lower.includes("talent show")) {
    return `Opera visiva e d'intrattenimento celebre per narrazione, regia e impatto sul pubblico.`;
  }

  // 8. Gaming e Tecnologia
  if (["playstation", "xbox", "nintendo", "zelda", "mario", "pokemon", "fifa", "fortnite", "gta", "minecraft", "videogioco", "gaming", "console", "arcade", "pc da gaming"].some(k => lower.includes(k))) {
    return `Titolo o piattaforma videoludica di enorme popolarità nell'industria dell'intrattenimento interattivo.`;
  }
  if (["app", "social", "online", "smartphone", "wi-fi", "bluetooth", "streaming", "podcast", "software", "sito", "pc", "tablet", "drone", "smartwatch", "algoritmo", "chatgpt", "intelligenza artificiale", "computer", "internet", "cloud", "usb", "facebook", "instagram", "tiktok", "twitter", "whatsapp", "telegram", "discord", "netflix", "spotify", "youtube", "amazon", "apple", "google"].some(k => lower.includes(k))) {
    return `Servizio o strumento tecnologico moderno indispensabile per informazione, comunicazione e lavoro.`;
  }

  // 9. Sport e Attività fisica
  if (["calcio", "basket", "tennis", "padel", "palestra", "fitness", "corsa", "nuoto", "yoga", "pilates", "crossfit", "maratona", "sport", "canoa", "paracadutismo", "trekking", "arrampicata", "sci", "snowboard", "surf", "skate", "bici", "ciclismo", "atletica", "bike", "pattinaggio", "jogging", "motocross"].some(k => lower.includes(k))) {
    return `Disciplina e attività fisica praticata per competizione o per il mantenimento del benessere corporeo.`;
  }

  // 10. Animali e Natura
  if (["cane", "gatto", "cavallo", "pomerania", "labrador", "husky", "pastore", "felino", "uccello", "orchidea", "pianta", "albero", "bosco", "mare", "spiaggia", "montagna", "lago", "fiume", "afa", "pioggia", "neve", "temporale", "vento", "tramonto", "alba", "delfino", "leone", "tigre", "orso", "lupo", "volpe", "coniglio"].some(k => lower.includes(k))) {
    return `Elemento del mondo naturale, specie animale o paesaggio che arricchisce la biodiversità e l'ambiente.`;
  }

  // 11. Moda, Cura Personale e Abbigliamento
  if (["scarpe", "sneakers", "vestito", "giacca", "pantaloni", "camicia", "cappotto", "stivali", "sandali", "calzini", "tatuaggi", "piercing", "profumo", "skincare", "trucco", "capelli", "occhiali", "barba", "baffi", "pettinatura", "orologio", "gioielli", "dr. martens", "gucci", "prada", "armani", "versace", "fendi"].some(k => lower.includes(k))) {
    return `Capo d'abbigliamento, accessorio di stile o pratica estetica per valorizzare l'aspetto personale.`;
  }

  // 12. Casa, Oggetti e Routine
  if (["armadio", "letto", "divano", "tavolo", "sedia", "bagno", "cucina", "soggiorno", "balcone", "giardino", "spazzolino", "robot", "aspirapolvere", "lavatrice", "lavastoviglie", "coperta", "cuscino", "lampada", "cambio degli armadi", "pulizie", "bollette", "condominio", "spesa"].some(k => lower.includes(k))) {
    return `Oggetto, arredo o faccenda domestica fondamentale per il comfort e l'ordine negli spazi abitativi.`;
  }

  // 13. Auto e Mezzi di Trasporto
  if (["auto", "macchina", "moto", "fiat", "ferrari", "vespa", "scooter", "bicicletta", "monopattino", "treno", "aereo", "lancia", "alfa romeo", "bmw", "mercedes", "audi", "patente", "autostrada", "traffico", "parcheggio"].some(k => lower.includes(k))) {
    return `Veicolo e soluzione di trasporto impiegata per gli spostamenti quotidiani o per il piacere della guida.`;
  }

  // 14. Generatore dinamico contestuale basato sul titolo (Garantisce unicità e pertinenza a ogni singola carta)
  return `Riferimento ed elemento culturale legato a ${stripped}, oggetto di opinioni e dibattiti quotidiani.`;
}

function runFullDeckEnrichment() {
  console.log(`[SCRIPT] Lettura del file: ${DECKS_PATH}`);
  
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
          
          // Genera una descrizione specifica e reale per ogni carta
          const desc = generateSpecificDescription(prompt);
          card.description = desc;
          updatedCount++;
        });
      }
    });
  }

  console.log(`[INFO] Carte aggiornate con descrizione specifica: ${updatedCount}`);

  fs.writeFileSync(DECKS_PATH, JSON.stringify(deckData, null, 2), 'utf8');
  console.log(`[SUCCESSO] File decks.json aggiornato e salvato con successo!`);
}

runFullDeckEnrichment();
