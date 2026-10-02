#!/usr/bin/env python3
"""Bestyrelsens robot – kører i GitHub Actions i repoet Brebnhi/bestyrelse.

Hvad den gør:
  * Laver status-labels (Next up, I gang, Venter, Færdig, Droppet), så de altid findes.
  * Et issue med tabellen fra referatet (Opgave | Ansvarlig | Deadline) bliver til én
    opgave pr. række: deadline i titlen, fx "Book hal (3/10)", og en @Navn-label pr.
    ansvarlig. Robotten skriver en kvittering og lukker tabel-issuet.
  * Får en opgave en ny status-label, fjerner robotten den gamle. "Færdig" lukker
    opgaven, "Droppet" lukker den som droppet.

Workflowet (.github/workflows/robot.yml) sørger for, at kun repoets ejer (og
samarbejdspartnere) kan sætte robotten i gang. Scriptet bruger kun Pythons
standardbibliotek.
"""
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

API = os.environ.get("GITHUB_API_URL", "https://api.github.com").rstrip("/")
REPO = os.environ.get("GITHUB_REPOSITORY", "Brebnhi/bestyrelse")
TOKEN = os.environ.get("GH_TOKEN", "")
SIDE = os.environ.get("SIDE", "https://brebnhi.github.io/bestyrelse/")
IDAG = datetime.now(ZoneInfo("Europe/Copenhagen")).date()

# Status-labels: navn -> (farve, beskrivelse)
STATUS = {
    "Next up": ("1D76DB", "Skal i gang som det næste"),
    "I gang": ("FBCA04", "Nogen arbejder på det"),
    "Venter": ("D4C5F9", "Venter på andre"),
    "Færdig": ("0E8A16", "Sæt den, så lukker robotten opgaven"),
    "Droppet": ("BFBFBF", "Sæt den, så lukker robotten opgaven som droppet"),
}
STATUS_ORD = {  # hvad der kan stå i en Status-kolonne
    "next up": "Next up", "next-up": "Next up", "nextup": "Next up", "næste": "Next up",
    "i gang": "I gang", "igang": "I gang", "i-gang": "I gang", "startet": "I gang",
    "in progress": "I gang", "venter": "Venter", "afventer": "Venter",
    "venter på andre": "Venter", "blokeret": "Venter", "færdig": "Færdig", "done": "Færdig",
    "afsluttet": "Færdig", "løst": "Færdig", "droppet": "Droppet", "annulleret": "Droppet",
}
IMPORT_LABEL = ("import", "EDEDED", "Tabel fra et møde – robotten har lavet opgaverne")
PERSONFARVE = "C5DEF5"
ALLE = {"alle", "bestyrelsen", "hele bestyrelsen", "fælles", "alle i bestyrelsen"}
EMNE_BESKRIVELSE = "Emne – sat af robotten ud fra teksten. Ret gerne."

# Bestyrelsen står i config.js (samme fil, som siden læser). Den her liste bruges kun, hvis
# config.js mangler eller ikke kan læses.
STANDARD_MEDLEMMER = [
    {"navn": "Søren", "rolle": "formand", "emner": ["Forening & bestyrelse"]},
    {"navn": "Heidi", "rolle": "sponsoransvarlig", "emner": ["Sponsorer & fonde"]},
    {"navn": "Anna", "rolle": "ungdomsansvarlig", "emner": ["Ungdom"]},
    {"navn": "Emma", "rolle": "tøj- og materialeansvarlig", "emner": ["Tøj & udstyr"]},
    {"navn": "Ida", "rolle": "festansvarlig", "emner": ["Arrangementer & frivillige"]},
    {"navn": "Sonja", "rolle": "", "emner": []},
    {"navn": "Mikkel", "rolle": "kasserer", "emner": ["Økonomi"]},
    {"navn": "Lars", "rolle": "kasserer", "emner": ["Økonomi"]},
    {"navn": "Marcel", "rolle": "kredsansvarlig", "emner": ["Hold & turneringer"]},
]
MDR = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "maj": 5, "jun": 6,
       "jul": 7, "aug": 8, "sep": 9, "okt": 10, "nov": 11, "dec": 12}
UGEDAG = ["man", "tir", "ons", "tor", "fre", "lør", "søn"]
HJAELP_MAERKE = "<!-- robot:hjaelp -->"

HJAELP = HJAELP_MAERKE + """
🤔 Jeg kunne ikke finde nogen opgaver i det her issue.

Kopiér tabellen fra referatet i Google Docs og sæt den ind med **Ctrl+V** (ikke Ctrl+Shift+V) –
så laver GitHub den om til en tabel. Den skal have kolonnerne *Opgave*, *Person* (eller
*Ansvarlig*) og *Deadline* (overskrifterne må gerne mangle, så læser jeg dem i den rækkefølge).
Du kan også skrive én opgave pr. linje:

```
Book hal til opstartsfest – Søren – 3/10
Ring til sponsorerne – Emma og Jonas – 15/10
```

Ret issuet (**Edit**), så prøver jeg igen."""


# ----------------------------------------------------------------------------- GitHub
def kald(metode, sti, data=None, forsoeg=3):
    """Kalder GitHubs API og returnerer (json, headers)."""
    url = sti if sti.startswith("http") else f"{API}/repos/{REPO}{sti}"
    krop = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=krop, method=metode, headers={
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "bestyrelsens-robot",
    })
    if krop is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raa = r.read()
            return (json.loads(raa) if raa else None), r.headers
    except urllib.error.HTTPError as e:
        tekst = e.read().decode(errors="replace")[:400]
        if e.code in (403, 429, 500, 502, 503) and forsoeg > 1:
            # GitHubs grænse for mange oprettelser i træk, eller en midlertidig fejl
            time.sleep(min(int(e.headers.get("Retry-After") or 10), 60))
            return kald(metode, sti, data, forsoeg - 1)
        raise ApiFejl(e.code, f"{metode} {sti} gav {e.code}: {tekst}") from None


class ApiFejl(Exception):
    def __init__(self, kode, besked):
        super().__init__(besked)
        self.kode = kode


def hent_alle(sti):
    ud = []
    while sti:
        data, h = kald("GET", sti)
        ud.extend(data or [])
        m = re.search(r'<([^>]+)>;\s*rel="next"', h.get("Link") or "")
        sti = m.group(1) if m else None
    return ud


def hent_labels():
    return {l["name"].lower(): l["name"] for l in hent_alle("/labels?per_page=100")}


def sikr_label(navn, farve, beskrivelse, kendte):
    """Returnerer labelens præcise navn og opretter den, hvis den mangler."""
    if navn.lower() in kendte:
        return kendte[navn.lower()]
    try:
        kald("POST", "/labels", {"name": navn, "color": farve, "description": beskrivelse})
        print(f"Label oprettet: {navn}")
    except ApiFejl as e:
        if e.kode != 422:  # 422 = findes allerede
            raise
    kendte[navn.lower()] = navn
    return navn


def kommenter(nr, tekst):
    kald("POST", f"/issues/{nr}/comments", {"body": tekst})


def fjern_label(nr, navn):
    try:
        kald("DELETE", f"/issues/{nr}/labels/{urllib.parse.quote(navn, safe='')}")
    except ApiFejl as e:
        if e.kode != 404:
            raise


# ----------------------------------------------------------------------------- datoer
def lav_dato(d, m, aar, ref):
    """Dato uden årstal = nærmeste fremad (datoer mere end 60 dage tilbage er næste år)."""
    if not (1 <= m <= 12 and 1 <= d <= 31):
        return None
    if aar is not None and aar < 100:
        aar += 2000
    if aar is None:
        aar = ref.year
        try:
            if date(aar, m, d) < ref - timedelta(days=60):
                aar += 1
        except ValueError:
            return None
    try:
        return date(aar, m, d)
    except ValueError:
        return None


def find_dato(tekst, ref=None):
    """Finder en dato i teksten: 3/10 · 3/10-26 · 3.10.2026 · 2026-10-03 · 3. okt · fre d. 3/10."""
    ref = ref or IDAG
    s = tekst.lower()
    m = re.search(r"(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)", s)
    if m:
        return lav_dato(int(m[3]), int(m[2]), int(m[1]), ref)
    m = re.search(r"(?<![\d/.])(\d{1,2})\s*[/.]\s*(\d{1,2})(?:\s*[/.\-]\s*(\d{4}|\d{2}))?(?!\d)", s)
    if m:
        return lav_dato(int(m[1]), int(m[2]), int(m[3]) if m[3] else None, ref)
    m = re.search(r"(?<!\d)(\d{1,2})\.?\s*(jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)"
                  r"[a-zæøå]*\.?(?:\s+(\d{4}))?", s)
    if m:
        return lav_dato(int(m[1]), MDR[m[2]], int(m[3]) if m[3] else None, ref)
    return None


def kort_dato(d):
    return f"{UGEDAG[d.weekday()]} {d.day}/{d.month}" + ("" if d.year == IDAG.year else f"-{str(d.year)[2:]}")


# ----------------------------------------------------------------------------- tabeller
SEP = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")


def rens(celle, linjer=False):
    c = celle.replace("\\|", "|")
    c = re.sub(r"<br\s*/?>", "\n", c, flags=re.I)
    c = re.sub(r"<[^>]+>", "", c)
    c = re.sub(r"\[([^\]]*)\]\(([^)]*)\)", r"\1", c)          # [tekst](link) -> tekst
    c = re.sub(r"(\*\*|__|~~)", "", c)
    c = re.sub(r"(?<![\w*])\*(?=\S)(.+?)(?<=\S)\*(?![\w*])", r"\1", c)  # *kursiv*
    c = html.unescape(c).replace("\xa0", " ")
    if linjer:
        return "\n".join(re.sub(r"[ \t]+", " ", l).strip() for l in c.split("\n")).strip()
    return re.sub(r"\s+", " ", c).strip()


def md_celler(linje):
    s = linje.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|") and not s.endswith("\\|"):
        s = s[:-1]
    return re.split(r"(?<!\\)\|", s)


def find_tabeller(tekst):
    """Markdown-tabeller (som GitHub laver, når man indsætter en tabel) og tabulator-tabeller."""
    linjer = tekst.replace("\r", "").split("\n")
    tabeller, brugt, i = [], set(), 0
    while i < len(linjer) - 1:
        if "|" in linjer[i] and SEP.match(linjer[i + 1]):
            raekker = [md_celler(linjer[i])]
            brugt.update({i, i + 1})
            j = i + 2
            while j < len(linjer) and "|" in linjer[j] and linjer[j].strip():
                raekker.append(md_celler(linjer[j]))
                brugt.add(j)
                j += 1
            tabeller.append(raekker)
            i = j
        else:
            i += 1
    # Tabel uden skillelinje: flere linjer i træk, der starter med |
    blok = []
    for n, l in enumerate(linjer + [""]):
        if n not in brugt and l.strip().startswith("|") and l.count("|") >= 2:
            blok.append(md_celler(l))
        else:
            if len(blok) >= 2:
                tabeller.append(blok)
            blok = []
    # Tabulator-adskilt (fx indsat som ren tekst fra et regneark)
    blok = []
    for l in linjer + [""]:
        if "\t" in l and l.strip():
            blok.append(l.split("\t"))
        else:
            if len(blok) >= 1 and any(len(r) >= 2 for r in blok):
                tabeller.append(blok)
            blok = []
    return tabeller


ROLLER = [  # (rolle, mønster) – første match vinder for hver kolonne
    ("opgave", re.compile(r"^(opgave|opgaver|to ?-?do|handling|action)", re.I)),
    ("person", re.compile(r"(ansvarlig|hvem|person|navn|tovholder|ejer)", re.I)),
    ("deadline", re.compile(r"(deadline|frist|dato|hvornår|senest|tidspunkt)", re.I)),
    ("status", re.compile(r"^status", re.I)),
    ("noter", re.compile(r"(note|kommentar|bemærk|detalje)", re.I)),
    ("opgave2", re.compile(r"(punkt|hvad|beskrivelse|emne|aktivitet|opgave)", re.I)),
]


def kortlaeg(overskrift):
    """Finder ud af, hvilken kolonne der er hvad. Returnerer {rolle: indeks} eller None."""
    roller = {}
    for idx, celle in enumerate(overskrift):
        tekst = rens(celle)
        if not tekst or len(tekst) > 30:
            continue
        for rolle, moenster in ROLLER:
            if moenster.search(tekst) and rolle not in roller:
                roller[rolle] = idx
                break
    if "opgave" not in roller and "opgave2" in roller:
        roller["opgave"] = roller.pop("opgave2")
    roller.pop("opgave2", None)
    if "opgave" in roller and ("person" in roller or "deadline" in roller):
        return roller
    return None


def standard_roller(antal):
    navne = ["opgave", "person", "deadline", "status"]
    return {navne[i]: i for i in range(min(antal, 4))}


# ----------------------------------------------------------------------------- bestyrelsen
def js_til_json(s):
    """config.js er skrevet som et JavaScript-objekt. Gør det til JSON: fjerner kommentarer og
    kommaer til sidst og sætter anførselstegn om nøgler uden."""
    ud, i, n = [], 0, len(s)
    while i < n:
        c = s[i]
        if c in "\"'":
            j, buf = i + 1, []
            while j < n and s[j] != c:
                if s[j] == "\\" and j + 1 < n:
                    buf.append(s[j:j + 2])
                    j += 2
                    continue
                buf.append(s[j])
                j += 1
            tekst = "".join(buf)
            if c == "'":
                tekst = tekst.replace("\\'", "'").replace('"', '\\"')
            ud.append('"' + tekst + '"')
            i = j + 1
            continue
        if s.startswith("//", i):
            j = s.find("\n", i)
            i = n if j < 0 else j
            continue
        if s.startswith("/*", i):
            j = s.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        m = re.match(r"[A-Za-z_$][\w$]*", s[i:])
        if m and re.match(r"\s*:", s[i + m.end():]) and (not ud or not re.match(r"[\w$]", ud[-1][-1:])):
            ud.append('"' + m.group(0) + '"')
            i += m.end()
            continue
        ud.append(c)
        i += 1
    return re.sub(r",(\s*[}\]])", r"\1", "".join(ud))


def laes_bestyrelsen(sti=None):
    """[{navn, rolle, emner}] fra config.js – kun de her kan få opgaver."""
    sti = sti or os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.js")
    try:
        tekst = open(sti, encoding="utf-8").read()
        start = tekst.index("{", re.search(r"window\.BESTYRELSE\s*=", tekst).end())
        data = json.loads(js_til_json(tekst[start:tekst.rindex("}") + 1]))
        ud = []
        for m in data.get("medlemmer") or []:
            navn = str(m.get("navn") if isinstance(m, dict) else m or "").strip()
            if navn:
                ud.append({"navn": navn, "rolle": str((m.get("rolle") if isinstance(m, dict) else "") or "").strip(),
                           "emner": [str(e) for e in ((m.get("emner") if isinstance(m, dict) else None) or [])]})
        if ud:
            return ud
        print("config.js har ingen medlemmer – bruger standardlisten.")
    except Exception as e:  # noqa: BLE001
        print(f"Kunne ikke læse bestyrelsen i config.js ({e}) – bruger standardlisten.")
    return [dict(m) for m in STANDARD_MEDLEMMER]


def lav_navn(s):
    return re.sub(r"\s+", " ", re.sub(r"[^\wæøåÆØÅ ]+", " ", str(s).lower())).strip()


def find_medlem(navn, medlemmer):
    """(navne, via_rolle). 'Marcel D' -> Marcel, 'kasserer Lars' -> Lars, 'Kassererne' -> Mikkel og Lars."""
    n = lav_navn(navn)
    if not n:
        return [], False
    foerste = n.split()[0]
    for m in medlemmer:
        mn = lav_navn(m["navn"])
        if n == mn or foerste == mn.split()[0]:
            return [m["navn"]], False
    navngivne = [m["navn"] for m in medlemmer if navn_i(lav_navn(m["navn"]), n)]
    if navngivne:
        return navngivne, False
    ramt = []
    for m in medlemmer:
        stamme = (lav_navn(m.get("rolle") or "").split() or [""])[0]
        if len(stamme) >= 5 and n.startswith(stamme):
            ramt.append(m["navn"])
    return ramt, bool(ramt)


def klassificer(navne, medlemmer):
    """['Kassererne', 'Herre 1', 'Alle'] -> (['Mikkel', 'Lars'], ['Herre 1'], True)"""
    bestyrelse, andre, alle = [], [], False
    for n in navne:
        if n == "Alle" or n.lower() in ALLE:
            alle = True
            continue
        fundet, _ = find_medlem(n, medlemmer)
        if fundet:
            bestyrelse += [f for f in fundet if f not in bestyrelse]
        elif n.lower() not in [a.lower() for a in andre]:
            andre.append(n)
    return bestyrelse, andre, alle


def og_liste(navne):
    navne = list(navne)
    return navne[0] if len(navne) == 1 else ", ".join(navne[:-1]) + " og " + navne[-1]


def navn_i(navn, tekst):
    return re.search(r"(?<![\wæøå])" + re.escape(navn.lower()) + r"(?![\wæøå])", tekst.lower()) is not None


# ----------------------------------------------------------------------------- emner
# Samme regler som på siden (index.html). Ord: tekst tæller 1 (højst 2 gange), "~ord" tæller ½,
# ("re", mønster[, vægt]) er et regulært udtryk. Det tidligste ord i teksten giver ekstra 0,3 point.
GRAENSE_FOER = r"(?:^|[^a-z0-9æøåéü])"
GRAENSE_EFTER = r"(?=[^a-z0-9æøåéü]|$)"


class Emne:
    def __init__(self, navn, farve, ord, personer=()):
        self.navn, self.farve = navn, farve
        self.regler = []
        for o in ord:
            if isinstance(o, tuple):
                kilde = o[1]
                if kilde.startswith(r"\b"):
                    kilde = GRAENSE_FOER + kilde[2:]
                if kilde.endswith(r"\b"):
                    kilde = kilde[:-2] + GRAENSE_EFTER
                self.regler.append((re.compile(kilde), o[2] if len(o) > 2 else 1.0))
            elif o.startswith("~"):
                self.regler.append((re.compile(re.escape(o[1:])), 0.5))
            else:
                self.regler.append((re.compile(re.escape(o)), 1.0))
        self.personer = [re.compile(p) for p in personer]


EMNER = [
    Emne("Økonomi", "F6E3A1", ["økonomi", "kontingent", "betal", "faktura", "regnskab", "budget", "refusion",
                               "mobilepay", "kasserer", "gæld", "penge", "takst", "udlæg", "indbetal", "opkræv",
                               "bankkonto", "beløb", "~pris", "~gebyr", "tilskud", "moms", "løn"],
         personer=[r"^kasserer(en|ne|e)?$"]),
    Emne("Sponsorer & fonde", "C9E7D3", ["sponsor", "fond", "ansøgning", "bambusa", "kampagne", "donation",
                                         "partner", "~støtte", "lodseddel", "lotteri"]),
    Emne("Hold & turneringer", "CFE0F7", ["jyllandsserie", "turnering", "licens", "kredskontakt", "melde fra",
                                          "kampprogram", "~serie", "division", "liga", "pokal", ("re", r"\bmix\b"),
                                          "holdtilmeld", "~tilmeld", "spillere", ("re", r"\bspiller\b", 0.5),
                                          "dobbelt klub", "klubskifte", ("re", r"\b(dame|herre)\s?\d\b", 0.5)]),
    Emne("Trænere & kurser", "E2D7F5", ["træner", "trænerhjælp", "kursus", "kurset", "kurser",
                                        ("re", r"\bdommer(e|ne|kursus|kurser|uddannelse)?\b"), "uddannelse", "dt-",
                                        "instruktør", "nødløsning"]),
    Emne("Ungdom", "FAD9C8", ["ungdom", ("re", r"\b[dhu]?u1\d\b"), "børn", "skoleforløb", "skole", "kickprojekt",
                              "forælder", "forældre", "boldlanger", "junior"]),
    Emne("Arrangementer & frivillige", "F7D0E1", ["fest", "julefrokost", "arrangement", "baren", ("re", r"\bbar\b"),
                                                  "indkøb", "speaker", "hjemmekamp", "tjans", "frivillig",
                                                  "stævneleder", "~stævne", "event", "afslutning", "reception",
                                                  "jubilæum"]),
    Emne("Tøj & udstyr", "D3EDF0", ["tøj", "trøje", "trøjen", "tryk", "merchandise", "udstyr", ("re", r"\bbolde?\b"),
                                    ("re", r"\bnet(tet)?\b"), "hæverkurv", "dommerstol", "flyttekasse", "materiel",
                                    "rekvisit"]),
    Emne("Kommunikation", "ECE6D3", ["hjemmeside", "facebook", "instagram", "nyhedsbrev", "presse", "interview",
                                     "dk4", ("re", r"\btv\b"), "volley-tv", "medie", "billede", "holdbeskrivelse",
                                     "plakat", "annonce", "~opslag", "~chat", "~gruppebesked", "~manus"]),
    Emne("Haller & lokaler", "DCE3EA", [("re", r"\bhal(len|ler|lerne|tid|tider)?\b"), "haltid", "nøgle", "klubhus",
                                        "lokale", ("re", r"\brum(met)?\b"), "brik", "katedral", "computer", "~låne",
                                        "lån af", "omklædning", "depot", ("re", r"\bskab(e|et)?\b")]),
    Emne("Forening & bestyrelse", "E5E7EB", ["generalforsamling", "bestyrelse", "ordstyrer", "vedtægt", "referat",
                                             "kommune", "forening", "forbund", "medlem", "gældsbrev", "underskrift",
                                             "kontrakt", "~aftale", "strategi", "~næste sæson", "~dokument",
                                             "forsikring", "gdpr"]),
]
ANDET = Emne("Andet", "EEEEEE", [])


def gaet_emne(tekst, personer=()):
    t = " " + re.sub(r"\s+", " ", str(tekst or "").lower()) + " "
    point = [0.0] * len(EMNER)
    tidligst, tidligst_i = None, -1
    for i, e in enumerate(EMNER):
        for regel, vaegt in e.regler:
            antal = 0
            for m in regel.finditer(t):
                antal += 1
                if tidligst is None or m.start() < tidligst:
                    tidligst, tidligst_i = m.start(), i
                if antal >= 2:
                    break
            point[i] += antal * vaegt
        for navn in personer or []:
            n = str(navn).lower().strip()
            if any(p.search(n) for p in e.personer):
                point[i] += 1
    if tidligst_i >= 0:
        point[tidligst_i] += 0.3
    bedst, maks = -1, 0.0
    for i, p in enumerate(point):
        if p > maks + 1e-9:
            bedst, maks = i, p
    return EMNER[bedst] if bedst >= 0 else ANDET


def norm_emne(s):
    s = re.sub(r"^\s*(emne|kategori)\s*:\s*", "", str(s).lower())
    s = re.sub(r"\bog\b", "&", s)
    s = re.sub(r"[^\wæøå&]+", " ", s)
    return re.sub(r"\s*&\s*", " & ", s).strip()


def find_emne(navn):
    """Emnet for en label eller et navn i config.js ('Økonomi', 'Tøj', 'Sponsorer og fonde')."""
    n = norm_emne(navn)
    if not n:
        return None
    for e in EMNER + [ANDET]:
        en = norm_emne(e.navn)
        if n == en or n == en.split(" ")[0]:
            return e
    return None


def emne_ejere(emne, medlemmer):
    return [m["navn"] for m in medlemmer if any(find_emne(x) is emne for x in m.get("emner") or [])]


def fordel(personer_raa, tekst, medlemmer, emne=None, person_tekst=""):
    """Hvem i bestyrelsen opgaven skal ligge hos, og hvad den skal hedde. Navne uden for bestyrelsen
    bliver ikke labels: de skrives forrest i opgaven, og opgaven lægges hos den, der har emnet."""
    bestyrelse, andre, alle = klassificer(personer_raa, medlemmer)
    emne = emne or gaet_emne(tekst, personer_raa)
    via_emne = False
    if not bestyrelse and not alle:
        ejere = emne_ejere(emne, medlemmer)
        if ejere:
            bestyrelse, via_emne = ejere, True
    titel = tekst
    if andre and not all(navn_i(a, tekst) for a in andre):
        i_cellen = klassificer(personer(person_tekst), medlemmer) if person_tekst else ([], [], False)
        rene = person_tekst and not i_cellen[0] and not i_cellen[2]    # kun folk uden for bestyrelsen
        titel = f"{person_tekst if rene else og_liste(andre)}: {tekst}"
    return {"bestyrelse": bestyrelse, "alle": alle, "andre": andre, "emne": emne, "via_emne": via_emne,
            "titel": titel}


def person_labels(f, kendte):
    labels = [sikr_label("@" + p, PERSONFARVE, "I bestyrelsen", kendte) for p in f["bestyrelse"]]
    if f["alle"]:
        labels.append(sikr_label("@Alle", PERSONFARVE, "Hele bestyrelsen", kendte))
    return labels


def emne_label(emne, kendte):
    return None if emne is ANDET else sikr_label(emne.navn, emne.farve, EMNE_BESKRIVELSE, kendte)


def personer(celle):
    c = re.sub(r"\(.*?\)", " ", rens(celle))
    ud = []
    for d in re.split(r"\s*(?:,|/|&|\+|;|\n|\bog\b|\band\b)\s*", c, flags=re.I):
        d = d.strip(" .:-@\t")
        if not d or d in ("?", "—", "–"):
            continue
        if d.lower() in ALLE:
            d = "Alle"
        elif d == d.lower():
            d = d[:1].upper() + d[1:]
        if d.lower() not in [x.lower() for x in ud]:
            ud.append(d)
    return ud


NAESTE_MOEDE = re.compile(r"(næste|kommende)\s+(bestyrelses)?møde|^nm$", re.I)


def tolk_deadline(celle, naeste_moede):
    """Returnerer (dato, tekst). Tekst bruges, når der står noget, der ikke er en dato."""
    s = rens(celle)
    if not s or s in ("-", "—", "–", "?"):
        return None, None
    if NAESTE_MOEDE.search(s):
        return (naeste_moede, None) if naeste_moede else (None, "næste møde")
    d = find_dato(s)
    return (d, None) if d else (None, s[:40])


def find_naeste_moede(tekst):
    m = re.search(r"^[\s>*_#-]*næste\s+(?:bestyrelses)?møde[\s*_]*[:：][\s*_]*(.+)$", tekst, re.I | re.M)
    return find_dato(m.group(1)) if m else None


def fra_linjer(tekst):
    """Én opgave pr. linje: 'Opgave – Navn – 3/10' (bruges kun i 📥-issues uden tabel).
    Linjer uden bindestreg/semikolon (fx en hilsen) ignoreres."""
    raekker = []
    for l in tekst.replace("\r", "").split("\n"):
        s = re.sub(r"^\s*(?:[-*•]|\d+[.)])\s+", "", l).strip()
        if not s or s.startswith("<!--") or s.startswith("#") or re.match(r"næste\s+(bestyrelses)?møde\s*[:：]", s, re.I):
            continue
        dele = [d for d in re.split(r"\s+[–—-]\s+|\t|\s*;\s*|\s+\|\s+", s) if d.strip()]
        if len(dele) >= 2:
            raekker.append(dele)
    return raekker


def uden_html(tekst):
    """Når man kopierer en tabel fra Google Docs og sætter den ind i GitHub, bliver tabellen til
    Markdown, men Google Docs' HTML omkring den kommer med (<b id="docs-internal-guid-…"> …),
    og "Næste møde: 29/10" over tabellen ender inde i den HTML. Linjer med | (tabellen) røres ikke."""
    ud = []
    for linje in tekst.split("\n"):
        if "|" in linje or "<" not in linje:
            ud.append(linje)
            continue
        linje = re.sub(r"<(?:br|/p|/div|/li|/h[1-6]|/tr|/table)\b[^>]*>", "\n", linje, flags=re.I)
        ud.append(html.unescape(re.sub(r"<[^>]+>", "", linje)).replace("\xa0", " "))
    return "\n".join(ud)


# To afsnit i samme celle i Google Docs bliver klistret sammen ("Haraldslund:Klar kl. 17")
KLISTRET = re.compile(r"(?<=[a-zæøå0-9)][.:;!?])(?=[A-ZÆØÅ])")


def find_opgaver(body, tvungen=False):
    """Returnerer (opgaver, næste_møde, problemer)."""
    tekst = uden_html(re.sub(r"<!--[\s\S]*?-->", "", body or ""))
    naeste = find_naeste_moede(tekst)
    tabeller = find_tabeller(tekst)
    brugbare = []
    for t in tabeller:
        roller = kortlaeg(t[0])
        if roller:
            brugbare.append((t[1:], roller))
    if not brugbare and tvungen and len(tabeller) == 1:
        # Tabel uden genkendelige overskrifter: læses som Opgave | Ansvarlig | Deadline
        t = tabeller[0]
        brugbare.append((t, standard_roller(max(len(r) for r in t))))
    if not brugbare and not tabeller and tvungen:
        linjer = fra_linjer(tekst)
        if linjer:
            brugbare.append((linjer, standard_roller(max(len(r) for r in linjer))))

    opgaver, problemer, nr = [], [], 0
    for raekker, roller in brugbare:
        for celler in raekker:
            nr += 1
            hent = lambda rolle: celler[roller[rolle]] if rolle in roller and roller[rolle] < len(celler) else ""
            if not any(rens(c) for c in celler):
                continue
            if kortlaeg(celler):  # gentaget overskrift
                continue
            titel = KLISTRET.sub(" ", rens(hent("opgave")))
            if not titel:
                problemer.append(f"Række {nr} har ingen opgave: {' | '.join(rens(c) for c in celler if rens(c))}")
                continue
            dl, dl_tekst = tolk_deadline(hent("deadline"), naeste)
            status_tekst = rens(hent("status")).lower()
            opgaver.append({
                "titel": titel,
                "personer": personer(hent("person")),
                "person_tekst": re.sub(r"\s+", " ", rens(hent("person"))).strip(" ,;/"),
                "deadline": dl,
                "deadline_tekst": dl_tekst,
                "status": STATUS_ORD.get(status_tekst),
                "noter": KLISTRET.sub(" ", rens(hent("noter"), linjer=True)),
            })
    return opgaver, naeste, problemer


# ----------------------------------------------------------------------------- opgaver
SLUT_PARENTES = re.compile(r"\s*[(\[][^()\[\]]*[)\]]\s*$")


def norm_titel(t):
    t = SLUT_PARENTES.sub("", t or "")
    return re.sub(r"[^\w]+", " ", t.lower()).strip()


def byg_titel(o):
    titel = o["titel"]
    if len(titel) > 180:
        titel = titel[:177].rstrip() + "…"
    if SLUT_PARENTES.search(titel) and find_dato(SLUT_PARENTES.search(titel).group(0)):
        return titel  # der står allerede en deadline i opgaven
    d = o["deadline"]
    if d:
        uden_aar = lav_dato(d.day, d.month, None, IDAG)
        return f"{titel} ({d.day}/{d.month}{'' if uden_aar == d else '-' + str(d.year)})"
    if o["deadline_tekst"]:
        return f"{titel} ({o['deadline_tekst']})"
    return titel


def behandl_import(issue, kendte, medlemmer):
    """Et 📥-issue (eller et issue med en tabel) bliver til én opgave pr. række. Returnerer True,
    hvis issuet var en tabel."""
    nr = issue["number"]
    titel = (issue.get("title") or "").strip()
    if any(l["name"].lower() == IMPORT_LABEL[0] for l in issue.get("labels", [])):
        print(f"#{nr} er allerede behandlet.")
        return True
    tvungen = titel.startswith("📥")
    opgaver, naeste, problemer = find_opgaver(issue.get("body") or "", tvungen)
    if not opgaver:
        if tvungen and issue.get("state") == "open":
            tidligere = hent_alle(f"/issues/{nr}/comments?per_page=100")
            if not any(HJAELP_MAERKE in (k.get("body") or "") for k in tidligere):
                kommenter(nr, HJAELP)
        print(f"#{nr}: ingen opgaver fundet.")
        return tvungen

    aabne = {}
    for i in hent_alle("/issues?state=open&per_page=100"):
        if not i.get("pull_request") and i["number"] != nr:
            aabne.setdefault(norm_titel(i["title"]), i["number"])

    kilde = re.sub(r"^📥\s*", "", titel) or f"issue #{nr}"
    oprettet, sprunget, set_ = [], [], set()
    andre_navne = []
    for o in opgaver:
        if o["status"] in ("Færdig", "Droppet"):
            sprunget.append(f"{o['titel']} – står som {o['status'].lower()} i tabellen")
            continue
        # Kun bestyrelsen får labels. Andre navne skrives forrest i opgaven, og opgaven lægges hos
        # den i bestyrelsen, der har emnet (se config.js).
        f = fordel(o["personer"], o["titel"], medlemmer, person_tekst=o.get("person_tekst", ""))
        o = dict(o, titel=f["titel"], fordeling=f)
        noegle = norm_titel(o["titel"])
        # Samme række to gange i samme issue (GitHub kan sætte en tabel med links ind to gange)
        fingeraftryk = (noegle, tuple(p.lower() for p in o["personer"]), o["deadline"], o["deadline_tekst"])
        if fingeraftryk in set_:
            continue
        set_.add(fingeraftryk)
        if noegle in aabne:
            sprunget.append(f"{o['titel']} – findes allerede som #{aabne[noegle]}")
            continue
        labels = person_labels(f, kendte)
        el = emne_label(f["emne"], kendte)
        if el:
            labels.append(el)
        if o["status"]:
            labels.append(sikr_label(o["status"], *STATUS[o["status"]], kendte))
        krop = f"Oprettet af robotten fra #{nr} ({kilde})."
        if o["noter"]:
            krop += "\n\n" + o["noter"]
        if len(o["titel"]) > 180:
            krop += "\n\nHele opgaven: " + o["titel"]
        ny, _ = kald("POST", "/issues", {"title": byg_titel(o), "body": krop, "labels": labels})
        aabne[noegle] = ny["number"]
        oprettet.append((ny["number"], o))
        for a in f["andre"]:
            if a.lower() not in [x.lower() for x in andre_navne]:
                andre_navne.append(a)
        print(f"Oprettet #{ny['number']}: {byg_titel(o)}  {labels}")
        time.sleep(1)  # skån GitHubs grænse for mange oprettelser i træk

    dele = []
    if oprettet:
        dele.append(f"✅ **{len(oprettet)} {'opgave' if len(oprettet) == 1 else 'opgaver'} oprettet** – "
                    f"de ligger nu på [bestyrelsessiden]({SIDE}).\n")
        dele.append("| | Opgave | Ansvarlig | Emne | Deadline |\n|---|---|---|---|---|")
        for n, o in oprettet:
            f = o["fordeling"]
            dl = kort_dato(o["deadline"]) if o["deadline"] else (o["deadline_tekst"] or "–")
            navne = (["Hele bestyrelsen"] if f["alle"] else []) + f["bestyrelse"]
            hvem = ", ".join(navne) + (" ¹" if f["via_emne"] else "") if navne else "– ²"
            emne = f["emne"].navn if f["emne"] is not ANDET else "–"
            dele.append(f"| #{n} | {o['titel'].replace('|', '/')} | {hvem} | {emne} | {dl} |")
        if any(o["fordeling"]["via_emne"] for _, o in oprettet):
            dele.append("\n¹ Ingen fra bestyrelsen stod på opgaven, så den er lagt hos den, der har emnet "
                        "(se `config.js`).")
        if any(not o["fordeling"]["bestyrelse"] and not o["fordeling"]["alle"] for _, o in oprettet):
            dele.append("\n² Ingen i bestyrelsen har emnet – opgaven står under *Uden ansvarlig* til næste møde.")
        if andre_navne:
            dele.append(f"\nℹ️ {og_liste(andre_navne)} er ikke i bestyrelsen og får ikke en label – navnene står "
                        "forrest i opgaven i stedet.")
    else:
        dele.append("Der var ingen nye opgaver at oprette.")
    if sprunget:
        dele.append("\n⏭️ **Sprunget over:**\n" + "\n".join(f"- {s}" for s in sprunget))
    if problemer:
        dele.append("\n⚠️ **Kunne ikke bruges:**\n" + "\n".join(f"- {p}" for p in problemer))
    if any(o["deadline_tekst"] == "næste møde" for _, o in oprettet):
        dele.append("\nℹ️ Skriv `Næste møde: 21/10` i issuet næste gang, så får \"næste møde\" en rigtig dato.")
    dele.append("\nDette issue lukkes automatisk.")
    kommenter(nr, "\n".join(dele))
    kald("POST", f"/issues/{nr}/labels", {"labels": [sikr_label(*IMPORT_LABEL, kendte)]})
    kald("PATCH", f"/issues/{nr}", {"state": "closed", "state_reason": "completed"})
    return True


# ----------------------------------------------------------------------------- ret opgaver
def er_import(i):
    return (i.get("title") or "").lstrip().startswith("📥") or \
        any((l["name"] if isinstance(l, dict) else l).lower() == IMPORT_LABEL[0] for l in i.get("labels", []))


def er_opgave(i):
    if i.get("pull_request") or er_import(i):
        return False
    if (i.get("user") or {}).get("login") == "github-actions[bot]":
        return True
    return (i.get("author_association") or "OWNER") in ("OWNER", "MEMBER", "COLLABORATOR")


def uden_deadline(titel):
    m = SLUT_PARENTES.search(titel or "")
    if m and find_dato(m.group(0)):
        return titel[:m.start()].rstrip(), titel[m.start():]
    return titel or "", ""


def ret_opgave(issue, medlemmer, kendte):
    """Sørger for, at en opgave kun har personer fra bestyrelsen og et emne. Returnerer True, hvis
    noget blev ændret. Gør ingenting, hvis opgaven allerede er i orden."""
    nr = issue["number"]
    navne = [l["name"] if isinstance(l, dict) else l for l in issue.get("labels", [])]
    personer_raa = [n[1:].strip() for n in navne if n.startswith("@") and n[1:].strip()]
    oevrige = [n for n in navne if not n.startswith("@")]
    emne = next((find_emne(n) for n in oevrige if find_emne(n)), None)
    tekst, deadline = uden_deadline(issue.get("title") or "")
    hel = re.search(r"(?:^|\n)Hele opgaven:[ \t]*([\s\S]+?)\s*$", issue.get("body") or "")
    gaet_tekst = hel.group(1) if hel else tekst
    f = fordel(personer_raa, tekst, medlemmer, emne=emne or gaet_emne(gaet_tekst, personer_raa))
    nye = oevrige[:]
    for p in person_labels(f, kendte):
        if p not in nye:
            nye.append(p)
    if not emne:
        el = emne_label(f["emne"], kendte)
        if el and el not in nye:
            nye.append(el)
    ny_titel = f["titel"] + (" " + deadline.strip() if deadline else "")
    if len(ny_titel) > 250:
        ny_titel = issue.get("title") or ""
    gamle = sorted(navne)
    if sorted(nye) == gamle and ny_titel == (issue.get("title") or ""):
        return False
    aendring = {"labels": nye}
    if ny_titel != (issue.get("title") or ""):
        aendring["title"] = ny_titel
    kald("PATCH", f"/issues/{nr}", aendring)
    fjernet = [n for n in navne if n not in nye]
    tilfoejet = [n for n in nye if n not in navne]
    print(f"#{nr} rettet: {ny_titel!r}  +{tilfoejet}  -{fjernet}")
    return True


def ryd_op(medlemmer, kendte):
    """Kører ved "Run workflow": flytter opgaver fra folk uden for bestyrelsen til den rigtige person,
    sætter emne på og sletter labels for personer, der ikke er i bestyrelsen."""
    siden = (datetime.now(ZoneInfo("UTC")) - timedelta(days=45)).strftime("%Y-%m-%dT%H:%M:%SZ")
    issues = hent_alle("/issues?state=open&per_page=100") + \
        hent_alle(f"/issues?state=closed&per_page=100&since={siden}")
    rettet = 0
    for i in issues:
        if not er_opgave(i):
            continue
        if ret_opgave(i, medlemmer, kendte):
            rettet += 1
            time.sleep(1)
    slettet = []
    for l in hent_alle("/labels?per_page=100"):
        n = l["name"]
        if not n.startswith("@") or not n[1:].strip():
            continue
        navn = n[1:].strip()
        if navn.lower() in ALLE or navn == "Alle":
            continue
        fundet, via_rolle = find_medlem(navn, medlemmer)
        if fundet and not via_rolle and lav_navn(navn) == lav_navn(fundet[0]):
            continue                                   # et medlem af bestyrelsen
        try:
            kald("DELETE", f"/labels/{urllib.parse.quote(n, safe='')}")
            kendte.pop(n.lower(), None)
            slettet.append(n)
        except ApiFejl as e:
            if e.kode != 404:
                raise
    print(f"Oprydning: {rettet} opgaver rettet, {len(slettet)} labels slettet {slettet}")
    return rettet, slettet


def behandl_status(issue, ny_label):
    kanon = {k.lower(): k for k in STATUS}
    ny = ny_label.lower()
    if ny not in kanon:
        return
    nr = issue["number"]
    for l in issue.get("labels", []):
        if l["name"].lower() in kanon and l["name"].lower() != ny:
            fjern_label(nr, l["name"])
            print(f"#{nr}: fjernede {l['name']}")
    if kanon[ny] in ("Færdig", "Droppet"):
        fjern_label(nr, ny_label)  # et lukket issue er færdigt – labelen skal ikke hænge ved
        kald("PATCH", f"/issues/{nr}", {"state": "closed",
                                         "state_reason": "completed" if kanon[ny] == "Færdig" else "not_planned"})
        print(f"#{nr}: lukket ({kanon[ny]})")


# ----------------------------------------------------------------------------- start
def main():
    haendelse = os.environ.get("GITHUB_EVENT_NAME", "")
    sti = os.environ.get("GITHUB_EVENT_PATH")
    data = json.load(open(sti, encoding="utf-8")) if sti and os.path.exists(sti) else {}

    medlemmer = laes_bestyrelsen()
    print("Bestyrelsen:", ", ".join(m["navn"] for m in medlemmer))
    kendte = hent_labels()
    for navn, (farve, beskrivelse) in STATUS.items():
        sikr_label(navn, farve, beskrivelse, kendte)
    sikr_label(*IMPORT_LABEL, kendte)
    if haendelse != "issues":
        print("Labels er på plads.")
        if haendelse in ("workflow_dispatch", "push"):
            ryd_op(medlemmer, kendte)
        return 0

    issue = data.get("issue") or {}
    if issue.get("pull_request"):
        return 0
    handling = data.get("action")
    if handling == "labeled":
        behandl_status(issue, (data.get("label") or {}).get("name", ""))
    elif handling in ("opened", "edited", "reopened"):
        var_tabel = behandl_import(issue, kendte, medlemmer)
        # En opgave oprettet direkte i GitHub: emne på, og ingen ansvarlig -> den, der har emnet
        if not var_tabel and handling == "opened" and er_opgave(issue) and issue.get("state") == "open":
            ret_opgave(issue, medlemmer, kendte)
    return 0


if __name__ == "__main__":
    sys.exit(main())
