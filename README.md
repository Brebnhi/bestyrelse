# Bestyrelsens opgaver – Aalborg Volley

Opgaverne fra bestyrelsesmøderne ligger som **issues** her i repoet. Siden viser dem for
alle i bestyrelsen – uden login:

**https://brebnhi.github.io/bestyrelse/**

Hver person kan vælge sit navn og få sit eget link, fx
`https://brebnhi.github.io/bestyrelse/?person=Søren`. Siden husker valget på telefonen.

## Sådan skriver du en opgave

| I GitHub | Bliver på siden |
|---|---|
| Issuets titel | Opgaven |
| `(3/10)` sidst i titlen | Deadline, fx `Book hal til opstartsfest (3/10)` |
| Label `@Navn` | Ansvarlig (gerne flere) |
| Label `Next up`, `I gang` eller `Venter` | Status. Ingen status-label = **Ikke startet** |
| Lukket issue (*Close issue*) | **Færdig** – vises i 45 dage |
| Lukket som *Close as not planned* | **Droppet** |
| Andre labels, fx `Sponsorer` | Små mærkater på kortet |
| Beskrivelsen | *Noter* på kortet (links virker) |

En deadline uden årstal er den nærmeste dato fremad fra dengang, opgaven blev oprettet.
Disse virker også: `(3/10-2027)`, `(3.10)`, `(2026-10-03)`, `(3. okt)` – eller en linje
`Deadline: 3/10` i beskrivelsen.

## Efter et bestyrelsesmøde

1. Åbn **Issues → New issue** – eller brug **＋ Ny opgave i GitHub** nederst på siden,
   som udfylder titel, deadline og labels for dig (virker bedst i browseren på PC).
2. Skriv titlen med deadline, fx `Ring til sponsorerne (15/10)`.
3. Vælg labels: personen (`@Emma`) og evt. status (`Next up`).
4. Tryk **Create**. Opgaven dukker op på siden med det samme (tryk evt. *Opdater* nederst).

Nederst på siden ligger **📋 Status til referatet**. Den samler alle åbne opgaver pr. person
og de færdige siden sidste møde, klar til at sætte ind i referatet i Google Docs.

Du kan også oprette og rette opgaver i GitHub-appen på telefonen.

## Når noget ændrer sig

- **Ny status:** skift label, fx `Next up` → `I gang`.
- **Færdig:** tryk *Close issue*.
- **Ny deadline:** ret datoen i titlen.
- **Ny ansvarlig:** skift `@Navn`-label.

De andre i bestyrelsen kan ikke selv ændre noget – de giver dig besked, eller I tager det
på mødet.

## Nyt bestyrelsesmedlem

Opret en label `@Fornavn` under **Issues → Labels → New label** (farven er ligegyldig).
Send personen linket `https://brebnhi.github.io/bestyrelse/?person=Fornavn` – eller vælg
navnet på siden og tryk **🔗 Kopiér … link**.

## Godt at vide

- **Alt er offentligt.** Repoet og siden kan ses af alle, der har linket. Skriv ikke
  følsomme ting i opgaverne, fx personsager, beløb eller telefonnumre. Siden er skjult for
  søgemaskiner, men issues på GitHub er ikke.
- **Kun dine opgaver tæller.** Siden viser kun issues oprettet af dig (eller af folk, du
  giver adgang til repoet). Opretter en fremmed et issue, bliver det ignoreret – luk det bare.
- **GitHub-grænse:** uden login tillader GitHub 60 opslag i timen pr. netværk. Siden bruger
  2 pr. visning og husker sidste hentning, så det rækker langt – også til et møde, hvor alle
  åbner siden på samme wifi. Rammes grænsen, viser siden de sidst hentede opgaver.
- **Gør ikke repoet privat.** Så kan siden ikke længere læse opgaverne.
- **Siden er `index.html`** og slås til under **Settings → Pages → Deploy from a branch →
  main / (root)**. Omdøber du repoet, så ret `REPO` øverst i scriptet og adressen i kortet
  på startsiden (`tjans/docs/index.html` i `Brebnhi.github.io`).
- **Se et eksempel:** https://brebnhi.github.io/bestyrelse/?eksempel
