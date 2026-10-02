# Bestyrelsens opgaver – Aalborg Volley

Opgaverne fra bestyrelsesmøderne ligger som **issues** her i repoet. Siden viser dem for
alle i bestyrelsen – uden login – og alle kan skifte status direkte på siden:

**https://brebnhi.github.io/bestyrelse/**

Siden er én tabel med en linje pr. opgave (*Opgave · Emne · Person · Deadline · Status*). Er en
opgave for lang til linjen, forkortes den med …

- **Vælg dit navn** øverst, så ser du kun dine opgaver (og dem for hele bestyrelsen). Siden husker
  valget, og hver person kan få sit eget link, fx `https://brebnhi.github.io/bestyrelse/?person=Søren`.
- **Sortér efter** *Deadline*, *Person* eller *Emne* med knapperne over tabellen (eller ved at klikke
  på kolonneoverskriften). Ved person og emne samles opgaverne under en overskrift pr. gruppe, med
  den tidligste deadline først. Siden husker valget.
- **Emnet gætter siden selv** ud fra ordene i opgaven: Økonomi, Sponsorer & fonde, Hold &
  turneringer, Trænere & kurser, Ungdom, Arrangementer & frivillige, Tøj & udstyr, Kommunikation,
  Haller & lokaler, Forening & bestyrelse – eller Andet. Gætter den forkert, så giv opgaven en label i
  GitHub med det rigtige emne, fx `Økonomi` eller bare `Tøj` (opret labelen første gang). Labelen
  vinder over gættet.
- **Tryk på en opgave** for at se hele teksten, hvem der har den, deadline, noter og hvilket møde den
  kom fra – og for at sætte den til *Next up*, *I gang*, *Venter* eller *Færdig ✓*.
- **Færdige opgaver** fra de sidste 45 dage ligger under *Vis færdige* under tabellen.
- Et link direkte til én opgave: `?opgave=12` (knappen *Kopiér link* i opgaven).

## Efter et bestyrelsesmøde – indsæt tabellen

1. Tryk **📥 Indsæt tabel fra mødet** under **＋ Nye opgaver** nederst på siden
   (eller opret selv et issue, hvis titel starter med 📥).
2. Skriv mødets dato efter titlen, fx `📥 Opgaver fra mødet 23/9`, og datoen for næste møde
   i linjen `Næste møde:`.
3. Markér tabellen i referatet i Google Docs, kopiér den og sæt den ind med **Ctrl+V**
   (ikke Ctrl+Shift+V) – så laver GitHub den om til en tabel. Kolonnerne er *Opgave*,
   *Person* (eller *Ansvarlig*) og *Deadline* – overskrifterne må gerne mangle, og tomme
   rækker springes over.
4. Tryk **Create**. Efter ca. et minut har robotten lavet én opgave pr. række, skrevet en
   kvittering og lukket tabel-issuet.

Skriv flere navne i samme celle på én linje med komma eller "og" (`Ida og Sonja`). Står de på
hver sin linje i cellen, klistrer GitHub dem sammen.

Robotten forstår:

| I tabellen | Bliver til |
|---|---|
| `Søren`, `Emma og Jonas`, `Søren/Emma` | Én `@Navn`-label pr. person – laves automatisk |
| `Alle` eller `Bestyrelsen` | *Hele bestyrelsen* – vises hos alle |
| `3/10`, `3.10`, `3. okt`, `1/2-2027` | Deadline sidst i titlen, fx `Book hal (3/10)` |
| `næste møde` | Datoen fra linjen `Næste møde: 21/10` øverst i issuet |
| Anden tekst, fx `løbende` | Står i parentes efter opgaven |
| Ekstra kolonne *Status* eller *Noter* | Status-label eller noter på opgaven |

Findes en opgave allerede (samme titel), springer robotten den over. Ingen tabel ved hånden?
Skriv én opgave pr. linje: `Book hal til opstartsfest – Søren – 3/10`.

## Status

- **På siden:** alle kan trykke på en opgave og vælge *Ikke startet*, *Next up*, *I gang*,
  *Venter*, *Færdig* eller *Drop opgaven*. Det går gennem mellemmanden (se herunder).
- **I GitHub:** vælg en status-label under **Labels** i højre side på opgaven. Robotten
  fjerner selv den gamle, og `Færdig`/`Droppet` lukker opgaven.
- **Ny deadline eller ansvarlig:** ret datoen i titlen eller `@Navn`-labelen i GitHub.

Nederst på siden ligger **📋 Status til referatet**, der samler alle åbne opgaver pr. person og
de færdige siden sidste møde – klar til at sætte ind i referatet i Google Docs.

## Mellemmanden – så alle kan skifte status uden GitHub-konto

GitHub kræver login for at ændre noget. Derfor går statusændringer fra siden gennem
*Bestyrelsens mellemmand*: et lille Google Apps Script i din Google-konto med en GitHub-nøgle,
der kun har adgang til issues i dette repo. Scriptet kan kun ændre status – ikke titler,
personer eller tekst. Adressen på mellemmanden står i `config.js`; er den tom, kan siden kun
vise opgaverne.

Opsætning (én gang):

1. **Lav nøglen:** [ny fine-grained token](https://github.com/settings/personal-access-tokens/new?name=Bestyrelsens%20mellemmand&description=Lader%20bestyrelsessiden%20skifte%20status%20p%C3%A5%20opgaverne&target_name=Brebnhi&expires_in=none&issues=write).
   Vælg *Only select repositories* → `bestyrelse`, tryk **Generate token** og kopiér nøglen.
2. **Lav scriptet:** gå til [script.google.com](https://script.google.com) → **Nyt projekt**.
   Kald det *Bestyrelsens mellemmand*, slet det, der står, og indsæt koden fra
   `mellemmand – kopier ind i Google Apps Script.txt`. Sæt nøglen ind i stedet for
   `SÆT-DIN-NØGLE-IND-HER` og gem.
3. **Udgiv det:** **Implementer → Ny implementering** → tandhjulet → **Webapp**.
   *Udfør som:* Mig · *Hvem har adgang:* Alle → **Implementer** → godkend adgangen
   (*Avanceret → Gå til Bestyrelsens mellemmand*). Kopiér webappens adresse (slutter på `/exec`).
4. **Sæt adressen ind** i [`config.js`](https://github.com/Brebnhi/bestyrelse/edit/main/config.js)
   mellem anførselstegnene og tryk **Commit changes**. Efter et par minutter kan alle skifte status.

Nøglen ligger kun i dit Google-script – aldrig her i det offentlige repo. Vil du lukke for det,
så slet nøglen på GitHub under *Settings → Developer settings → Fine-grained tokens*.

## Nyt bestyrelsesmedlem

Robotten laver `@Navn`-labelen, første gang personen står i en tabel. Send personen linket
`https://brebnhi.github.io/bestyrelse/?person=Fornavn` – eller vælg navnet på siden og tryk
**🔗 Kopiér … link**.

## Godt at vide

- **Alt er offentligt.** Repoet og siden kan ses af alle, der har linket. Skriv ikke
  følsomme ting i opgaverne, fx personsager, beløb eller telefonnumre.
- **Alle med linket kan skifte status** – men ikke andet. Sker der noget forkert, kan du se og
  rette det i GitHub.
- **Mange mails fra GitHub?** Sæt **Watch** øverst i repoet til *Participating and @mentions*.
- **GitHub-grænse:** uden login tillader GitHub 60 opslag i timen pr. netværk. Siden bruger
  2 pr. visning og husker sidste hentning, så det rækker langt.
- **Gør ikke repoet privat** – så kan siden ikke længere læse opgaverne.
- **Se et eksempel:** https://brebnhi.github.io/bestyrelse/?eksempel

## Filer

| Fil | Hvad |
|---|---|
| `index.html` | Siden. Slås til under **Settings → Pages → Deploy from a branch → main / (root)**. |
| `config.js` | Adressen på mellemmanden. |
| `robot.py` | Robotten: labels, tabel → opgaver, status-labels. |
| `.github/workflows/robot.yml` | Starter robotten, når du opretter, retter eller labeler et issue. |

Robotten kører under **Actions → Bestyrelsens robot**. Mellemmanden ligger i dit Google Apps
Script-projekt *Bestyrelsens mellemmand*. Omdøber du repoet, så ret `REPO` øverst i scriptet i
`index.html`, i mellemmanden og i kortet på startsiden (`tjans/docs/index.html` i
`Brebnhi.github.io`).
