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
MDR = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "maj": 5, "jun": 6,
       "jul": 7, "aug": 8, "sep": 9, "okt": 10, "nov": 11, "dec": 12}
UGEDAG = ["man", "tir", "ons", "tor", "fre", "lør", "søn"]
HJAELP_MAERKE = "<!-- robot:hjaelp -->"

HJAELP = HJAELP_MAERKE + """
🤔 Jeg kunne ikke finde nogen opgaver i det her issue.

Indsæt tabellen fra referatet med **Ctrl+V** – så laver GitHub den om til en tabel. Den skal
have kolonnerne *Opgave*, *Ansvarlig* og *Deadline* (overskrifterne må gerne mangle, så læser
jeg dem i den rækkefølge). Du kan også skrive én opgave pr. linje:

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


def find_opgaver(body, tvungen=False):
    """Returnerer (opgaver, næste_møde, problemer)."""
    tekst = re.sub(r"<!--[\s\S]*?-->", "", body or "")
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
            titel = rens(hent("opgave"))
            if not titel:
                problemer.append(f"Række {nr} har ingen opgave: {' | '.join(rens(c) for c in celler if rens(c))}")
                continue
            dl, dl_tekst = tolk_deadline(hent("deadline"), naeste)
            status_tekst = rens(hent("status")).lower()
            opgaver.append({
                "titel": titel,
                "personer": personer(hent("person")),
                "deadline": dl,
                "deadline_tekst": dl_tekst,
                "status": STATUS_ORD.get(status_tekst),
                "noter": rens(hent("noter"), linjer=True),
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


def behandl_import(issue, kendte):
    nr = issue["number"]
    titel = (issue.get("title") or "").strip()
    if any(l["name"].lower() == IMPORT_LABEL[0] for l in issue.get("labels", [])):
        print(f"#{nr} er allerede behandlet.")
        return
    tvungen = titel.startswith("📥")
    opgaver, naeste, problemer = find_opgaver(issue.get("body") or "", tvungen)
    if not opgaver:
        if tvungen and issue.get("state") == "open":
            tidligere = hent_alle(f"/issues/{nr}/comments?per_page=100")
            if not any(HJAELP_MAERKE in (k.get("body") or "") for k in tidligere):
                kommenter(nr, HJAELP)
        print(f"#{nr}: ingen opgaver fundet.")
        return

    aabne = {}
    for i in hent_alle("/issues?state=open&per_page=100"):
        if not i.get("pull_request") and i["number"] != nr:
            aabne.setdefault(norm_titel(i["title"]), i["number"])

    kilde = re.sub(r"^📥\s*", "", titel) or f"issue #{nr}"
    oprettet, sprunget = [], []
    for o in opgaver:
        if o["status"] in ("Færdig", "Droppet"):
            sprunget.append(f"{o['titel']} – står som {o['status'].lower()} i tabellen")
            continue
        noegle = norm_titel(o["titel"])
        if noegle in aabne:
            sprunget.append(f"{o['titel']} – findes allerede som #{aabne[noegle]}")
            continue
        labels = [sikr_label("@" + p, PERSONFARVE, "Ansvarlig" if p != "Alle" else "Hele bestyrelsen", kendte)
                  for p in o["personer"]]
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
        print(f"Oprettet #{ny['number']}: {byg_titel(o)}")
        time.sleep(1)  # skån GitHubs grænse for mange oprettelser i træk

    dele = []
    if oprettet:
        dele.append(f"✅ **{len(oprettet)} {'opgave' if len(oprettet) == 1 else 'opgaver'} oprettet** – "
                    f"de ligger nu på [bestyrelsessiden]({SIDE}).\n")
        dele.append("| | Opgave | Ansvarlig | Deadline |\n|---|---|---|---|")
        for n, o in oprettet:
            dl = kort_dato(o["deadline"]) if o["deadline"] else (o["deadline_tekst"] or "–")
            navne = ", ".join("Hele bestyrelsen" if p == "Alle" else p for p in o["personer"]) or "–"
            dele.append(f"| #{n} | {o['titel'].replace('|', '/')} | {navne} | {dl} |")
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

    kendte = hent_labels()
    for navn, (farve, beskrivelse) in STATUS.items():
        sikr_label(navn, farve, beskrivelse, kendte)
    sikr_label(*IMPORT_LABEL, kendte)
    if haendelse != "issues":
        print("Labels er på plads.")
        return 0

    issue = data.get("issue") or {}
    if issue.get("pull_request"):
        return 0
    handling = data.get("action")
    if handling == "labeled":
        behandl_status(issue, (data.get("label") or {}).get("name", ""))
    elif handling in ("opened", "edited", "reopened"):
        behandl_import(issue, kendte)
    return 0


if __name__ == "__main__":
    sys.exit(main())
