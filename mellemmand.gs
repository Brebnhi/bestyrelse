/**
 * Bestyrelsens mellemmand – Aalborg Volley · version 3
 *
 * Lader alle i bestyrelsen arbejde med opgaverne på https://brebnhi.github.io/bestyrelse/ uden en
 * GitHub-konto. Siden sender en lille besked hertil, og scriptet gør det i GitHub med din nøgle
 * (en fine-grained token, der kun kan røre issues i repoet Brebnhi/bestyrelse).
 *
 * Kan:      oprette en opgave (hvad, hvem, hvornår) · rette den · "Jeg tager den" · lægge den tilbage
 *           til bestyrelsen · skifte status (med resultat, når den er færdig) · skrive en opdatering ·
 *           sætte datoen for næste møde · hente opgaverne, hvis GitHub siger stop til siden ·
 *           lave dokumentet til næste møde i Drev ud fra skabelonen og skrive opgaverne ind i det
 *           (knappen "📄 Lav mødedokument" under "Til mødet" – se afsnittet MØDEDOKUMENTET nederst).
 * Kan ikke: slette noget, ændre andet end issues i repoet, læse andre repoer eller røre andet i Drev
 *           end mødedokumenterne i bestyrelsens mapper.
 *
 * NØGLEN står ikke her i koden, men under Projektindstillinger (tandhjulet ⚙️ til venstre) →
 * Scriptegenskaber, som egenskaben NOEGLE. Så kan koden skiftes ud uden at røre nøglen.
 *
 * SÅDAN OPDATERES MELLEMMANDEN
 *   1. Åbn mellemmand.gs i repoet Brebnhi/bestyrelse og klik på kopi-ikonet øverst til højre over koden.
 *   2. Her i editoren: klik i koden, tryk Cmd+A og Cmd+V (Ctrl på Windows), og tryk Gem (💾).
 *   3. Implementer → Administrer implementeringer → blyanten ✏️ → Version: "Ny version" → Implementer.
 *      Adressen (…/exec) er den samme som før, så config.js skal ikke rettes.
 * Første gang med version 3: vælg "tjekReferat" i rullemenuen øverst og tryk Kør, før trin 3. Så beder
 * Google dig give mellemmanden lov til Drev og Docs (til mødedokumentet), og loggen viser, hvad knappen
 * vil gøre. Første gang fra version 1 skal nøglen også flyttes over i Scriptegenskaber – se README.
 */
const NOEGLE = "SÆT-DIN-NØGLE-IND-HER";   // lad linjen stå – nøglen ligger under Scriptegenskaber (se øverst)

const REPO = "Brebnhi/bestyrelse";
const SIDE = "https://brebnhi.github.io/bestyrelse/";
const VERSION = 3;
const TZ = "Europe/Copenhagen";
const MAKS_PR_TIME = 150;          // ændringer i timen – bremser misbrug af den åbne adresse
const FARVER = {                   // labels, mellemmanden selv kan oprette
  person: ["C5DEF5", "I bestyrelsen"],
  "bestyrelsen": ["FBE7A1", "Kan alle i bestyrelsen tage – tryk 'Jeg tager den' på siden"],
  "next up": ["1D76DB", "Skal i gang som det næste"],
  "i gang": ["FBCA04", "Nogen arbejder på det"],
  "venter": ["D4C5F9", "Venter på andre"],
  "møder": ["C2E0C6", "Datoerne for bestyrelsesmøderne – siden og robotten læser dem herfra"]
};

// ================================================================== indgange
function doPost(e) {
  let svar;
  try {
    const d = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    svar = behandl(d);
  } catch (err) {
    svar = { ok: false, fejl: fejlTekst(err) };
  }
  return svarJson(svar);
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.handling === "liste") return svarJson({ ok: true, issues: hentListe() });
    return svarJson({ ok: true, navn: "Bestyrelsens mellemmand", repo: REPO });
  } catch (err) {
    return svarJson({ ok: false, fejl: fejlTekst(err) });
  }
}

function svarJson(o) {
  o.version = VERSION;
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// Kør den her én gang fra editoren (vælg "test" og tryk Kør), hvis du vil se, at nøglen virker.
function test() {
  const k = konfig();
  Logger.log("Bestyrelsen: " + k.medlemmer.join(", "));
  const r = gh("get", "");
  Logger.log("Forbindelse til " + r.full_name + " ✓ (" + r.open_issues_count + " åbne issues)");
}

// ================================================================== handlinger
function behandl(d) {
  if (!d.handling && d.nr && d.status) d.handling = "status";          // siden fra version 1
  const cache = CacheService.getScriptCache();
  const idNoegle = d.id ? "id:" + String(d.id).slice(0, 80) : null;
  if (idNoegle) {
    const tidligere = cache.get(idNoegle);
    if (tidligere) return JSON.parse(tidligere);                      // samme besked sendt to gange
  }
  const laas = LockService.getScriptLock();
  if (!laas.tryLock(25000)) throw "Der er travlt lige nu – prøv igen om lidt.";
  try {
    if (idNoegle && cache.get(idNoegle)) return JSON.parse(cache.get(idNoegle));
    taelOp(cache);
    const svar = udfoer(d);
    if (idNoegle) cache.put(idNoegle, JSON.stringify(svar).slice(0, 90000), 21600);
    return svar;
  } finally {
    laas.releaseLock();
  }
}

function taelOp(cache) {
  const noegle = "n:" + Utilities.formatDate(new Date(), TZ, "yyyyMMddHH");
  const n = +(cache.get(noegle) || 0);
  if (n >= MAKS_PR_TIME) throw "Der er lavet rigtig mange ændringer den sidste time – prøv igen lidt senere.";
  cache.put(noegle, String(n + 1), 3700);
}

function udfoer(d) {
  const k = konfig();
  const v1 = d.handling === "status" && !d.af && d.version !== 2;     // siden fra version 1 sendte intet navn
  const af = v1 ? "Nogen" : findMedlem(d.af, k.medlemmer);
  if (!af) throw "Vælg dit navn på siden, før du retter noget.";
  const data = Object.assign({}, d, { af: af });
  if (d.handling === "opret") return opret(data, k);
  if (d.handling === "moede") return moede(data);
  if (d.handling === "referat") return referat(data, k);
  if (["status", "opdatering", "tag", "slip", "ret"].indexOf(d.handling) >= 0) return paaOpgave(data, k);
  throw "Ukendt handling: " + d.handling;
}

function opret(d, k) {
  if (!renTitel(d.hvad)) throw "Skriv, hvad opgaven går ud på.";
  const ny = bygNy({
    hvad: d.hvad, hvem: validerHvem(d.hvem, k.medlemmer), deadline: validerFrist(d.deadline), af: d.af, id: d.id
  }, { dato: fuldDato(idag()), ref: idag() });
  const issue = gh("post", "/issues", { title: ny.title, body: ny.body, labels: ny.labels.map(sikrLabel) });
  return { ok: true, nr: issue.number, issue: tilSiden(issue) };
}

function paaOpgave(d, k) {
  const nr = parseInt(d.nr, 10);
  if (!(nr > 0)) throw "Mangler opgavens nummer.";
  const issue = gh("get", "/issues/" + nr);
  if (issue.pull_request || erMoedeIssue(issue) || /^\s*📥/u.test(issue.title || "")) throw "Det er ikke en opgave.";
  if (d.handling === "ret") {
    if (d.hvem != null) d.hvem = validerHvem(d.hvem, k.medlemmer);
    if (d.deadline != null) d.deadline = validerFrist(d.deadline);
  }
  const foer = {
    title: issue.title, body: String(issue.body || ""), labels: issue.labels.map(function (l) { return l.name; }),
    state: issue.state, state_reason: issue.state_reason
  };
  const efter = anvend(foer, d, { dato: fuldDato(idag()), ref: datoFraTid(issue.created_at) });
  const aendring = {};
  if (efter.title !== foer.title) aendring.title = efter.title;
  if (efter.body !== foer.body) aendring.body = efter.body;
  const sammeLabels = efter.labels.length === foer.labels.length &&
    efter.labels.every(function (l) { return foer.labels.some(function (f) { return lav(f) === lav(l); }); });
  if (!sammeLabels) aendring.labels = efter.labels.map(sikrLabel);
  if (efter.state !== foer.state) {
    aendring.state = efter.state;
    aendring.state_reason = efter.state === "closed" ? efter.state_reason : "reopened";
  } else if (efter.state === "closed" && efter.state_reason !== foer.state_reason) {
    aendring.state_reason = efter.state_reason;
  }
  const opdateret = Object.keys(aendring).length ? gh("patch", "/issues/" + nr, aendring) : issue;
  return { ok: true, nr: nr, issue: tilSiden(opdateret) };
}

function moede(d) {
  const dato = d.dato ? isoTilDato(d.dato) : null;
  const erstat = d.erstat ? isoTilDato(d.erstat) : null;
  if (d.dato && !dato) throw "Datoen kunne ikke læses.";
  if (!dato && !erstat) throw "Vælg en dato.";
  let issue = findMoedeIssue();
  const foer = issue ? laesMoeder(issue.body, idag()) : {};
  const body = skrivMoeder(opdaterMoeder(foer, dato, erstat, d.tid, idag()));
  if (issue) {
    if (body !== String(issue.body || "").replace(/\r/g, "")) issue = gh("patch", "/issues/" + issue.number, { body: body });
  } else {
    issue = gh("post", "/issues", { title: MOEDE_TITEL, body: body, labels: [sikrLabel(MOEDE_LABEL)] });
  }
  return { ok: true, nr: issue.number, issue: tilSiden(issue) };
}

function findMoedeIssue() {
  const aabne = hentAlle("/issues?state=open&per_page=100");
  return aabne.filter(function (i) { return !i.pull_request && erMoedeIssue(i); })[0] || null;
}

function hentListe() {
  const cache = CacheService.getScriptCache();
  const gemt = cache.get("liste");
  if (gemt) return JSON.parse(gemt);
  const siden = new Date();
  siden.setUTCHours(0, 0, 0, 0);
  siden.setUTCDate(siden.getUTCDate() - 150);
  const alle = hentAlle("/issues?state=open&per_page=100").concat(hentAlle("/issues?state=closed&per_page=100" +
    "&sort=updated&direction=desc&since=" + siden.toISOString().replace(/\.\d{3}Z$/, "Z")));
  const ud = alle.filter(function (i) { return !i.pull_request; }).map(tilSiden);
  const tekst = JSON.stringify(ud);
  if (tekst.length < 95000) cache.put("liste", tekst, 30);
  return ud;
}

// ================================================================== tjek af det, siden sender
function konfig() {
  const cache = CacheService.getScriptCache();
  const gemt = cache.get("konfig");
  if (gemt) return JSON.parse(gemt);
  const k = { medlemmer: [], asapDage: 7 };
  try {
    const r = UrlFetchApp.fetch(SIDE + "config.js?t=" + Date.now(), { muteHttpExceptions: true });
    if (r.getResponseCode() === 200) {
      const t = r.getContentText("UTF-8");
      const re = /["']?navn["']?\s*:\s*["']([^"']+)["']/g;
      let m;
      while ((m = re.exec(t))) if (m[1].trim()) k.medlemmer.push(m[1].trim());
      const a = /["']?asapDage["']?\s*:\s*(\d+)/.exec(t);
      if (a) k.asapDage = +a[1];
    }
  } catch (e) { /* bruger reserven herunder */ }
  if (!k.medlemmer.length) {
    k.medlemmer = hentLabelNavne().filter(function (n) { return erPersonLabel(n) && !erPuljeLabel(n); }).map(personNavn);
  }
  cache.put("konfig", JSON.stringify(k), 600);
  return k;
}

function findMedlem(navn, medlemmer) {
  const n = lav(String(navn || "").trim());
  if (!n) return null;
  return medlemmer.filter(function (m) { return lav(m) === n; })[0] || null;
}

function validerHvem(hvem, medlemmer) {
  const ud = [];
  for (const n of Array.isArray(hvem) ? hvem : [hvem]) {
    const navn = personNavn(String(n || "").trim()) || String(n || "").trim();
    if (!navn) continue;
    if (erPuljeLabel(navn)) { ud.push(PULJE); continue; }
    const m = findMedlem(navn, medlemmer);
    if (!m) throw navn + " er ikke med i bestyrelsen (config.js).";
    ud.push(m);
  }
  return ud;
}

function validerFrist(f) {
  if (f == null || f === "") return "";
  if (f === "moede") return "moede";
  if (isoTilDato(f)) return f;
  throw "Deadline kunne ikke læses.";
}

// ================================================================== GitHub
function noegle() {
  if (NOEGLE && NOEGLE.indexOf("SÆT-DIN-NØGLE") < 0) return NOEGLE.trim();
  const egenskaber = PropertiesService.getScriptProperties().getProperties() || {};
  if (String(egenskaber.NOEGLE || "").trim()) return String(egenskaber.NOEGLE).trim();
  for (const k in egenskaber) {        // stavet anderledes (fx NØGLE)? Så tag den, der ligner en GitHub-nøgle
    const v = String(egenskaber[k] || "").trim();
    if (/^(github_pat_|ghp_)\w+$/.test(v)) return v;
  }
  throw "Mellemmanden mangler nøglen til GitHub. Den skal ligge under Projektindstillinger → Scriptegenskaber " +
    "som NOEGLE (se README).";
}

function gh(metode, sti, data) {
  const url = /^https:/.test(sti) ? sti : "https://api.github.com/repos/" + REPO + sti;
  const valg = {
    method: metode, muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + noegle(), Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }
  };
  if (data !== undefined) { valg.contentType = "application/json"; valg.payload = JSON.stringify(data); }
  const r = UrlFetchApp.fetch(url, valg);
  const kode = r.getResponseCode();
  const tekst = r.getContentText("UTF-8");
  if (kode >= 200 && kode < 300) return tekst ? JSON.parse(tekst) : null;
  let besked = "";
  try { besked = JSON.parse(tekst).message || ""; } catch (e) { besked = tekst.slice(0, 200); }
  if (kode === 401) throw "Nøglen til GitHub virker ikke længere (udløbet eller slettet). Formanden skal lave en ny – se README.";
  if (kode === 403 && /rate limit/i.test(besked)) throw "GitHub har travlt lige nu – prøv igen om lidt.";
  if (kode === 403) throw "Nøglen har ikke lov til det her. Den skal have Issues: Read and write på repoet bestyrelse.";
  if (kode === 404) throw "Fandt ikke opgaven i GitHub.";
  if (kode === 410) throw "Opgaven er slettet i GitHub.";
  if (kode === 422) throw "GitHub afviste ændringen: " + besked;
  throw "GitHub svarede " + kode + (besked ? " (" + besked + ")" : "") + ".";
}

function hentAlle(sti) {
  let ud = [], url = "https://api.github.com/repos/" + REPO + sti;
  for (let side = 0; url && side < 5; side++) {
    const r = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { Authorization: "Bearer " + noegle(), Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }
    });
    if (r.getResponseCode() !== 200) return gh("get", sti);        // giver en forståelig fejl
    ud = ud.concat(JSON.parse(r.getContentText("UTF-8")));
    const h = r.getHeaders();
    const m = /<([^>]+)>;\s*rel="next"/.exec(h.Link || h.link || "");
    url = m ? m[1] : null;
  }
  return ud;
}

function hentLabelNavne(frisk) {
  const cache = CacheService.getScriptCache();
  const gemt = !frisk && cache.get("labels");
  if (gemt) return JSON.parse(gemt);
  const navne = hentAlle("/labels?per_page=100").map(function (l) { return l.name; });
  cache.put("labels", JSON.stringify(navne), 600);
  return navne;
}

// Returnerer labelens præcise navn i GitHub og opretter den (med farve), hvis den mangler
function sikrLabel(navn) {
  const findes = hentLabelNavne().filter(function (n) { return lav(n) === lav(navn); })[0];
  if (findes) return findes;
  const f = erPersonLabel(navn) ? FARVER.person : FARVER[lav(navn)];
  if (f) {
    try {
      gh("post", "/labels", { name: navn, color: f[0], description: f[1] });
    } catch (e) {
      if (!/already_exists|already exists/i.test(String(e))) throw e;
    }
    CacheService.getScriptCache().remove("labels");
  }
  return navn;
}

function tilSiden(i) {
  return {
    number: i.number, title: i.title, body: String(i.body || "").slice(0, 12000), state: i.state,
    state_reason: i.state_reason || null, created_at: i.created_at, closed_at: i.closed_at || null,
    updated_at: i.updated_at, html_url: i.html_url,
    labels: (i.labels || []).map(function (l) { return typeof l === "string" ? l : l.name; }),
    author_association: i.author_association || "OWNER", user: { login: (i.user && i.user.login) || "" }
  };
}

// ================================================================== datoer i Danmark
function idag() { return isoTilDato(Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd")); }
function datoFraTid(stempel) {
  const d = new Date(stempel);
  return isNaN(d) ? idag() : isoTilDato(Utilities.formatDate(d, TZ, "yyyy-MM-dd"));
}
function fejlTekst(err) {
  if (typeof err === "string") return err;
  return "Noget gik galt i mellemmanden: " + (err && err.message ? err.message : String(err));
}

// ================================================================ FÆLLES (start)
// Samme kode står i index.html og i mellemmand.gs – ret begge steder. Reglerne for, hvordan en
// opgave (et issue) ser ud: titel "Book hal (3/10)" eller "Book hal (næste møde)", labels @Navn /
// Bestyrelsen / status, og en logbog nederst i beskrivelsen under **Opdateringer**.
const DAG = 864e5;
const MDR = { jan: 1, feb: 2, mar: 3, apr: 4, maj: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12 };
const PULJE = "Bestyrelsen";                       // label: opgaven kan alle i bestyrelsen tage
const ALLE_NAVNE = ["alle", "bestyrelsen", "hele bestyrelsen", "fælles", "alle i bestyrelsen"];
const LOG_MAERKE = "**Opdateringer**";
const MOEDE_TITEL = "📅 Bestyrelsesmøder";
const MOEDE_LABEL = "møder";
const MOEDE_INTRO = "Datoerne for bestyrelsens møder. Siden bruger dem til deadlines som \"næste møde\" og til " +
  "opfølgningen før hvert møde.\nRet gerne her – én dato pr. linje, fx `- 29/10-2026 kl. 17`. Næste møde kan " +
  "også sættes på [siden](https://brebnhi.github.io/bestyrelse/).";
const STATUSSER = {
  ny:      { navn: "Ikke startet", label: null },
  next:    { navn: "Next up", label: "Next up" },
  igang:   { navn: "I gang", label: "I gang" },
  venter:  { navn: "Venter", label: "Venter" },
  faerdig: { navn: "Færdig", label: null, lukket: true, grund: "completed" },
  droppet: { navn: "Droppet", label: null, lukket: true, grund: "not_planned" }
};
const STATUS_ALIAS = {
  next: ["next up", "next-up", "nextup", "næste", "næste op"],
  igang: ["i gang", "igang", "i-gang", "in progress", "igangværende", "startet"],
  venter: ["venter", "venter på andre", "afventer", "blokeret", "waiting", "blocked"],
  faerdig: ["færdig", "done", "afsluttet", "løst"],
  droppet: ["droppet", "annulleret"]
};
const NAESTE_MOEDE = /(næste|kommende|førstkommende)\s+(bestyrelses)?møde|^\s*n\.?\s?m\.?\s*$|til\s+mødet/i;
const FRIST_ORD = /^(løbende|efter behov|hele sæsonen|sæsonen|fast|kontinuerligt|altid|ved lejlighed|når muligt|når der er tid|ongoing|løbende opgave|hver uge|hver måned|ugentligt|månedligt|årligt|hvert år|næste sæson|inden sæsonstart|sæsonstart|efter jul|efter nytår|generalforsamlingen|inden generalforsamlingen)$/i;
const FRIST_PARENTES = /\s*[(\[]\s*(?:deadline|frist)?\s*:?\s*([^()\[\]]+?)\s*[)\]]\s*$/i;

function lav(s) { return String(s == null ? "" : s).toLocaleLowerCase("da"); }
function midnat(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function plusDage(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function iso(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
function isoTilDato(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d : null;
}
function fuldDato(d) { return d.getDate() + "/" + (d.getMonth() + 1) + "-" + d.getFullYear(); }

// Dato uden årstal: samme år som ref – medmindre datoen så ligger mere end 60 dage før, så næste år
function lavDato(d, m, aar, ref) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  if (aar != null && aar < 100) aar += 2000;
  if (aar == null) {
    const r = midnat(ref || new Date());
    aar = r.getFullYear();
    if (new Date(aar, m - 1, d) < plusDage(r, -60)) aar += 1;
  }
  const dt = new Date(aar, m - 1, d);
  return dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null;
}
// En dato i starten af teksten: 3/10 · 3/10-26 · 3.10.2026 · 2026-10-03 · 3. okt · 3 oktober 2026
function tolkDato(tekst, ref) {
  const s = lav(String(tekst || "").trim());
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/.exec(s);
  if (m) return lavDato(+m[3], +m[2], +m[1], ref);
  m = /^(\d{1,2})\s*[\/.]\s*(\d{1,2})(?:\s*[\/.\-]\s*(\d{4}|\d{2}))?(?!\d)/.exec(s);
  if (m) return lavDato(+m[1], +m[2], m[3] ? +m[3] : null, ref);
  m = /^(\d{1,2})\.?\s*(jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)[a-zæøå]*\.?(?:\s+(\d{4}))?/.exec(s);
  if (m) return lavDato(+m[1], MDR[m[2]], m[3] ? +m[3] : null, ref);
  return null;
}
// En dato et vilkårligt sted i teksten (som robottens find_dato)
function findDato(tekst, ref) {
  const s = lav(tekst);
  let m = /(?:^|[^\d])(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/.exec(s);
  if (m) return lavDato(+m[3], +m[2], +m[1], ref);
  m = /(?:^|[^\d\/.])(\d{1,2})\s*[\/.]\s*(\d{1,2})(?:\s*[\/.\-]\s*(\d{4}|\d{2}))?(?!\d)/.exec(s);
  if (m) return lavDato(+m[1], +m[2], m[3] ? +m[3] : null, ref);
  m = /(?:^|[^\d])(\d{1,2})\.?\s*(jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)[a-zæøå]*\.?(?:\s+(\d{4}))?/.exec(s);
  if (m) return lavDato(+m[1], MDR[m[2]], m[3] ? +m[3] : null, ref);
  return null;
}

// ---------------------------------------------------------------- labels
function statusFraLabel(navn) {
  const n = lav(navn).replace(/^[^\p{L}\p{N}]+/u, "").replace(/\s+/g, " ").trim();
  for (const id in STATUS_ALIAS) if (STATUS_ALIAS[id].indexOf(n) >= 0) return id;
  return null;
}
function erStatusLabel(navn) { return statusFraLabel(navn) !== null; }
function erPersonLabel(navn) { return /^(?:@|👤)\s*\S/u.test(String(navn || "")); }
function personNavn(label) { return String(label || "").replace(/^(?:@|👤)\s*/u, "").trim(); }
function erPuljeLabel(navn) { return ALLE_NAVNE.indexOf(lav(String(navn || "").trim().replace(/^@\s*/, "").trim())) >= 0; }
function erMoedeIssue(i) {
  const labels = (i.labels || []).map(function (l) { return lav(typeof l === "string" ? l : l.name); });
  return /^\s*📅/u.test(i.title || "") || labels.indexOf(MOEDE_LABEL) >= 0;
}
// ["Ida", "Søren"] -> ["@Ida", "@Søren"] · ["Bestyrelsen"] / [] -> ["Bestyrelsen"]
function personLabels(hvem) {
  const ud = [];
  for (const n of hvem || []) {
    const navn = personNavn(String(n || "").trim()) || String(n || "").trim();
    if (!navn) continue;
    const l = erPuljeLabel(navn) ? PULJE : "@" + navn;
    if (!ud.some(function (x) { return lav(x) === lav(l); })) ud.push(l);
  }
  const navne = ud.filter(function (l) { return l !== PULJE; });
  return navne.length ? navne : [PULJE];
}
function ogListe(navne) {
  return navne.length <= 1 ? navne.join("") : navne.slice(0, -1).join(", ") + " og " + navne[navne.length - 1];
}

// ---------------------------------------------------------------- titler og deadlines
// "Book hal (3/10)" -> { tekst: "Book hal", suffix: " (3/10)", slags: "dato", dato }
// "Book hal (næste møde)" -> slags "moede" · "Opdater siden (løbende)" -> slags "tekst"
function delTitel(titel, ref) {
  const t = String(titel || "").trim();
  const m = FRIST_PARENTES.exec(t);
  if (m && m.index > 0) {
    const indhold = m[1].trim();
    const tekst = t.slice(0, m.index).trim();
    if (NAESTE_MOEDE.test(indhold)) return { tekst: tekst, suffix: " (" + indhold + ")", slags: "moede" };
    const d = tolkDato(indhold, ref);
    if (d) return { tekst: tekst, suffix: " (" + indhold + ")", slags: "dato", dato: d };
    if (FRIST_ORD.test(indhold)) return { tekst: tekst, suffix: " (" + indhold + ")", slags: "tekst", fristTekst: indhold };
  }
  return { tekst: t, suffix: "", slags: null };
}
// deadline: "" (ingen) · "moede" (næste møde) · "2026-10-29"
function fristSuffix(deadline, ref) {
  if (!deadline) return "";
  if (deadline === "moede") return " (næste møde)";
  const d = isoTilDato(deadline);
  if (!d) return "";
  const udenAar = lavDato(d.getDate(), d.getMonth() + 1, null, ref || new Date());
  const sammeAar = udenAar && udenAar.getTime() === d.getTime();
  return " (" + d.getDate() + "/" + (d.getMonth() + 1) + (sammeAar ? "" : "-" + d.getFullYear()) + ")";
}
function fristVist(deadline) {
  if (deadline === "moede") return "næste møde";
  const d = isoTilDato(deadline);
  return d ? d.getDate() + "/" + (d.getMonth() + 1) : "ingen";
}
function renTekst(s, maks) {
  return String(s == null ? "" : s).replace(/<!--|-->/g, "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ")
    .trim().slice(0, maks || 500);
}
function renTitel(s) { return renTekst(s, 200); }

// ---------------------------------------------------------------- logbogen
// "- 19/10-2026 · Ida · Færdig: Hallen er booket" (type uden kolon, tekst efter ": ")
function logLinje(dato, af, type, tekst) {
  return "- " + dato + " · " + renTekst(af, 40).replace(/·/g, "-") + " · " + type + (tekst ? ": " + renTekst(tekst) : "");
}
function medLog(body, linjer) {
  let b = String(body || "").replace(/\s+$/, "");
  if (b.indexOf(LOG_MAERKE) < 0) b = (b ? b + "\n\n" : "") + LOG_MAERKE;
  return b + "\n" + linjer.join("\n");
}
// -> { foer: tekst over logbogen, log: [{ dato, datoTekst, af, type, tekst }] }
function delLog(body) {
  const b = String(body || "").replace(/\r/g, "");
  const i = b.indexOf(LOG_MAERKE);
  if (i < 0) return { foer: b, log: [] };
  const log = [];
  for (const linje of b.slice(i + LOG_MAERKE.length).split("\n")) {
    const m = /^\s*[-*]\s+(\d{1,2})\/(\d{1,2})-(\d{4})\s+·\s+([^·]+?)\s+·\s+([^:]+?)(?::\s*(.*))?\s*$/.exec(linje);
    if (!m) continue;
    const d = new Date(+m[3], +m[2] - 1, +m[1]);
    log.push({ dato: d, datoTekst: m[1] + "/" + m[2], af: m[4].trim(), type: m[5].trim(), tekst: (m[6] || "").trim() });
  }
  return { foer: b.slice(0, i).replace(/\s+$/, ""), log: log };
}

// ---------------------------------------------------------------- én handling på en opgave
// issue: { title, body, labels: [navne], state, state_reason } · d: { handling, … , af }
// nu: { dato: "19/10-2026", ref: datoen opgaven blev oprettet (til "3/10" uden årstal) }
// Returnerer opgaven, som den ser ud bagefter. Kaster en fejltekst, hvis handlingen ikke giver mening.
function anvend(issue, d, nu) {
  let labels = (issue.labels || []).map(function (l) { return typeof l === "string" ? l : l.name; });
  let title = issue.title || "", state = issue.state || "open", grund = issue.state_reason || null;
  const log = [], af = d.af || "Nogen";
  const udenPersoner = function () { return labels.filter(function (l) { return !erPersonLabel(l) && !erPuljeLabel(l); }); };
  const personer = function () {
    return labels.filter(function (l) { return erPersonLabel(l) && !erPuljeLabel(l); }).map(personNavn);
  };
  if (d.handling === "status") {
    const st = STATUSSER[d.status];
    if (!st) throw "Ukendt status: " + d.status;
    labels = labels.filter(function (l) { return !erStatusLabel(l); });
    if (st.label) labels.push(st.label);
    if (st.lukket) { state = "closed"; grund = st.grund; } else { state = "open"; grund = null; }
    log.push(logLinje(nu.dato, af, st.navn, d.tekst));
  } else if (d.handling === "opdatering") {
    if (!renTekst(d.tekst)) throw "Skriv en opdatering.";
    log.push(logLinje(nu.dato, af, "Opdatering", d.tekst));
  } else if (d.handling === "tag") {
    const har = personer();
    if (har.length && !har.some(function (p) { return lav(p) === lav(af); })) throw ogListe(har) + " har allerede taget den 🙂";
    if (!har.length || labels.some(erPuljeLabel)) {
      labels = udenPersoner().concat(["@" + af]);
      log.push(logLinje(nu.dato, af, "Tog opgaven"));
    }
  } else if (d.handling === "slip") {
    if (!personer().some(function (p) { return lav(p) === lav(af); })) throw "Opgaven ligger ikke hos dig.";
    const tilbage = personer().filter(function (p) { return lav(p) !== lav(af); });
    labels = udenPersoner().concat(tilbage.length ? tilbage.map(function (p) { return "@" + p; }) : [PULJE]);
    log.push(logLinje(nu.dato, af, tilbage.length ? "Sprang fra opgaven" : "Lagt tilbage til bestyrelsen"));
  } else if (d.handling === "ret") {
    const dele = delTitel(title, nu.ref);
    const nyTekst = d.hvad != null ? renTitel(d.hvad) || dele.tekst : dele.tekst;
    const nySuffix = d.deadline != null ? fristSuffix(d.deadline, nu.ref) : dele.suffix;
    const aendr = [];
    if (nyTekst !== dele.tekst) aendr.push("tekst");
    if (nySuffix.trim() !== dele.suffix.trim()) aendr.push("deadline → " + (d.deadline ? fristVist(d.deadline) : "ingen"));
    title = nyTekst + nySuffix;
    if (d.hvem) {
      const nye = personLabels(d.hvem);
      const gamle = labels.filter(function (l) { return erPersonLabel(l) || erPuljeLabel(l); });
      const samme = nye.length === gamle.length && nye.every(function (l) {
        return gamle.some(function (g) { return lav(g) === lav(l) || (erPuljeLabel(g) && erPuljeLabel(l)); });
      });
      if (!samme) {
        labels = udenPersoner().concat(nye);
        aendr.push("ansvarlig → " + nye.map(function (l) { return l === PULJE ? PULJE : personNavn(l); }).join(", "));
      }
    }
    if (aendr.length) log.push(logLinje(nu.dato, af, "Rettet", aendr.join(", ")));
  } else {
    throw "Ukendt handling: " + d.handling;
  }
  const unikke = [];
  for (const l of labels) if (!unikke.some(function (x) { return lav(x) === lav(l); })) unikke.push(l);
  return {
    title: title,
    body: log.length ? medLog(issue.body, log) : String(issue.body || ""),
    labels: unikke,
    state: state,
    state_reason: grund
  };
}
// En ny opgave fra siden: { hvad, hvem: [navne], deadline, af, id }
function bygNy(d, nu) {
  return {
    title: renTitel(d.hvad) + fristSuffix(d.deadline, nu.ref),
    body: (d.id ? "<!-- id:" + String(d.id).replace(/[^\w-]/g, "") + " -->\n" : "") + LOG_MAERKE + "\n" +
      logLinje(nu.dato, d.af || "Nogen", "Tilføjet"),
    labels: personLabels(d.hvem),
    state: "open",
    state_reason: null
  };
}

// ---------------------------------------------------------------- mødedatoerne (📅-issuet)
// -> { "2026-10-29": "29/10-2026 kl. 17", … }
function laesMoeder(body, ref) {
  const ud = {};
  for (const linje of String(body || "").replace(/\r/g, "").split("\n")) {
    const m = /^\s*[-*]\s+(.+)$/.exec(linje);
    if (!m) continue;
    const d = findDato(m[1], ref || new Date());
    if (d) ud[iso(d)] = m[1].trim();
  }
  return ud;
}
function skrivMoeder(datoer) {
  return MOEDE_INTRO + "\n\n" + Object.keys(datoer).sort().map(function (k) { return "- " + datoer[k]; }).join("\n") + "\n";
}
// Næste møde sat til dato (fjerner møder fra i dag og frem til den dato, og det møde der flyttes)
function opdaterMoeder(datoer, dato, erstat, tid, idag) {
  const ud = {};
  for (const k in datoer) ud[k] = datoer[k];
  if (erstat) delete ud[iso(erstat)];
  if (dato) {
    for (const k of Object.keys(ud)) {
      const d = isoTilDato(k);
      if (d && d >= midnat(idag) && d < dato) delete ud[k];
    }
    const t = /^(\d{1,2}):(\d{2})$/.exec(String(tid || ""));
    ud[iso(dato)] = fuldDato(dato) + (t ? " kl. " + (+t[1]) + (t[2] === "00" ? "" : "." + t[2]) : "");
  }
  return ud;
}
// ================================================================ FÆLLES (slut)

// ================================================================== MØDEDOKUMENTET (referatet)
// Knappen "📄 Lav mødedokument" under "Til mødet" på siden. Mellemmanden finder dokumentet til næste
// møde i Drev (fx "6. møde - 18.11.2026") – eller laver det ud fra skabelonen – og skriver opgaverne ind
// under de punkter på dagsordenen, de hører til: dem, der er åbne, og dem, der er klaret siden sidste
// møde, med status og hvad de endte med. Trykkes der igen, bliver opfølgningen skrevet om med den
// nyeste status. Resten af dokumentet røres ikke.
//
// Hvilket punkt en opgave kommer under: det punkt i sidste referat, hvor den blev drøftet (ordene i
// opgaven sammenlignes med teksten under hvert punkt). Står den ikke dér, bestemmer opgavens emne det.
// En label i GitHub med et punkts navn (fx "Mixholdene") vinder over begge.
const SKABELON = "1IAMNpSJZzDAS0Wo285UIwrQ8CUUg9kMC";    // "Skabelon bestyrelsesmøde AAV.docx" i Drev
const SKABELON_NAVN = "Skabelon bestyrelsesmøde";        // findes id'et ikke længere, søges der på navnet
const OPF_OMRAADE = "aav-opfoelgning";                    // navngivne områder om de linjer, knappen har skrevet
const OPGAVE_RAEKKER = 25;                                // tomme rækker i opgavetabellen i et nyt dokument
const SKABELON_PUNKTER = ["Velkomst og godkendelse af sidste referat", "Formandens punkt", "Hal", "Økonomi",
  "Årshjul", "Hjemmeside, sociale medier og Holdsport", "Børn og ungdom", "Mixholdene", "Danmarksserieholdene",
  "Divisionsholdene", "Sponsorer", "Tøj", "Eventuelt", "Dato for næste møde?"];
const GRAA = "#5f6368";

// Kør den her én gang fra editoren (vælg "tjekReferat" og tryk Kør), når mellemmanden er opdateret til
// version 3: så giver du den lov til at bruge Google Drev og Docs, og loggen viser, hvad knappen vil gøre.
// Den skriver ikke noget.
function tjekReferat() {
  // Beder Google om lov til alt, mellemmanden bruger (Drev og Docs) – på én gang, før der sker noget
  if (typeof ScriptApp.requireAllScopes === "function") ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
  const k = konfig();
  const mapper = moedeMapper();
  Logger.log("Skabelon: " + mapper.skabelon.getName() + " ✓");
  Logger.log("Mapper: " + mapper.saesoner.map(function (f) { return f.getName(); }).join(", ") +
    " – nye dokumenter lægges i " + (mapper.saesoner[0] || mapper.rod).getName());
  const p = forbered(null);
  Logger.log("Næste møde: " + fuldDato(p.naeste) + (p.sidste ? " · sidste møde: " + fuldDato(p.sidste) : ""));
  const dok = findMoedeDok(mapper, p.naeste);
  Logger.log(dok ? "Dokumentet findes: " + dok.getName() + " – knappen skriver opgaverne ind i det (" + dok.getUrl() + ")"
    : "Intet dokument til mødet endnu – knappen laver \"" + nytNavn(mapper, p.naeste) + "\"");
  const forrige = p.sidste ? findMoedeDok(mapper, p.sidste) : null;
  let punkter = null;
  try { if (forrige) punkter = laesPunkter(DocumentApp.openById(forrige.getId())); }
  catch (e) { Logger.log("Kunne ikke læse " + forrige.getName() + ": " + e); }
  Logger.log(punkter ? "Sidste referat: " + forrige.getName() + " (" + punkter.length + " punkter læst)"
    : "Fandt ikke sidste referat – punkterne bestemmes af opgavernes emne");
  const fordelt = fordelPaaPunkter(p.data.klaret.concat(p.data.aabne), punkter, null);
  Logger.log(p.data.klaret.length + " klaret og " + p.data.aabne.length + " åbne opgaver:");
  for (const n in fordelt) {
    Logger.log("  " + punktTitel(n) + ": " + fordelt[n].map(function (o) { return o.helTitel; }).join(" · "));
  }
  Logger.log("Bestyrelsen: " + k.medlemmer.join(", ") + " ✓ – alt klar");
}

function referat(d, k) {
  const p = forbered(d.moede || null);
  const mapper = moedeMapper();
  const forrige = p.sidste ? findMoedeDok(mapper, p.sidste) : null;
  let fil = findMoedeDok(mapper, p.naeste), oprettet = false;
  if (!fil) {
    try { fil = lavMoedeDok(mapper, p, forrige, k); }
    catch (e) { throw drevFejl(e, "mappen " + (mapper.saesoner[0] || mapper.rod).getName()); }
    oprettet = true;
  }
  let punkter = null;
  try { if (forrige) punkter = laesPunkter(DocumentApp.openById(forrige.getId())); }
  catch (e) { Logger.log("Kunne ikke læse " + forrige.getName() + ": " + e); }       // så bestemmer emnet punktet
  let res;
  try { res = skrivOpfoelgning(fil, p, punkter); }
  catch (e) { throw drevFejl(e, "\"" + fil.getName() + "\""); }
  return {
    // Adressen sendes ikke med: mellemmanden er åben for alle, og dokumentet skal blive i Drev. Siden
    // søger i stedet efter navnet i den enkeltes egen Drev.
    ok: true, navn: fil.getName(), mappe: mappeNavn(fil), oprettet: oprettet, moede: iso(p.naeste),
    klaret: p.data.klaret.length, aabne: p.data.aabne.length, mangler: res.mangler, punkter: res.punkter,
    bevaret: res.bevaret,
    tid: Utilities.formatDate(new Date(), TZ, "d/M 'kl.' HH.mm")
  };
}

function mappeNavn(fil) {
  const it = fil.getParents();
  return it.hasNext() ? it.next().getName() : "";
}
// Mangler mellemmanden lov i Drev, siges det, så man kan gøre noget ved det
const MANGLER_LOV = "Mellemmanden mangler lov til Google Drev og Docs. Formanden skal åbne mellemmanden i Apps Script, " +
  "køre tjekReferat og trykke Tillad (se README).";
function drevFejl(e, hvad) {
  if (typeof e === "string") return e;
  const t = String(e && e.message || e);
  if (/googleapis\.com\/auth\//.test(t)) return MANGLER_LOV;                 // Google mangler formandens tilladelse
  if (/access denied|adgang nægtet|permission|tilladelse|insufficient/i.test(t)) {
    return "Mellemmanden må ikke skrive i " + hvad + " i Drev. Den kører som formandens Google-konto, så dokumentet " +
      "(eller mappen) skal være delt med den som redaktør.";
  }
  return e;
}

// Opgaverne og møderne fra GitHub: næste møde, sidste møde og opfølgningen siden da
function forbered(oensketMoede) {
  const issues = hentIssues();
  const m = moedeDatoer(issues);
  const i = idag();
  const naeste = m.liste.filter(function (d) { return d >= i; })[0] || null;
  if (!naeste) throw "Sæt datoen for næste møde først (📅 øverst på siden).";
  if (oensketMoede && oensketMoede !== iso(naeste)) {
    throw "Næste møde er flyttet til " + fuldDato(naeste) + " – genindlæs siden og prøv igen.";
  }
  let sidste = null;
  for (const d of m.liste) if (d < naeste) sidste = d;
  const siden = sidste || plusDage(i, -45);
  const opgaver = issues.filter(erOpgaveIssue).map(function (x) { return normaliserOpgave(x, m.liste); });
  const klaret = opgaver.filter(function (o) { return o.status === "faerdig" && o.lukket && o.lukket >= siden; })
    .sort(function (a, b) { return a.lukket - b.lukket; });
  const aabne = opgaver.filter(function (o) { return o.status !== "faerdig"; }).sort(efterDeadline);
  return { naeste: naeste, sidste: sidste, siden: siden, tekst: m.tekst, data: { klaret: klaret, aabne: aabne } };
}

function hentIssues() {
  const siden = new Date();
  siden.setUTCHours(0, 0, 0, 0);
  siden.setUTCDate(siden.getUTCDate() - 150);
  return hentAlle("/issues?state=open&per_page=100").concat(hentAlle("/issues?state=closed&per_page=100" +
    "&sort=updated&direction=desc&since=" + siden.toISOString().replace(/\.\d{3}Z$/, "Z")))
    .filter(function (i) { return !i.pull_request; });
}

// Samme regler som siden: 📅-issuet plus datoerne på tabellerne fra møderne (📥)
function moedeDatoer(issues) {
  const datoer = {};
  let moedeIssue = null, nyesteImport = null;
  for (const i of issues) if (erMoedeIssue(i) && i.state !== "closed" && !moedeIssue) moedeIssue = i;
  if (moedeIssue) Object.assign(datoer, laesMoeder(moedeIssue.body, idag()));
  for (const i of issues) {
    if (!erImportIssue(i) || !/møde/i.test(i.title || "")) continue;
    const opr = datoFraTid(i.created_at);
    const d = findDato(String(i.title).replace(/^\s*📥\s*/u, ""), opr) || opr;
    if (!datoer[iso(d)]) datoer[iso(d)] = fuldDato(d);
    if (!nyesteImport || i.created_at > nyesteImport.created_at) nyesteImport = i;
  }
  if (!moedeIssue && nyesteImport) {
    const m = /^[\s>*_#-]*næste\s+(?:bestyrelses)?møde\b(.*)$/im.exec(String(nyesteImport.body || "").replace(/<[^>]+>/g, ""));
    const d = m && findDato(m[1], datoFraTid(nyesteImport.created_at));
    if (d && !datoer[iso(d)]) datoer[iso(d)] = fuldDato(d);
  }
  return { tekst: datoer, liste: Object.keys(datoer).sort().map(isoTilDato).filter(Boolean) };
}

// ------------------------------------------------------------------ opgaverne (som på siden)
function erImportIssue(i) {
  return /^\s*📥/u.test(i.title || "") ||
    (i.labels || []).some(function (l) { return lav(typeof l === "string" ? l : l.name) === "import"; });
}
function erOpgaveIssue(i) {
  if (i.pull_request || erImportIssue(i) || erMoedeIssue(i)) return false;
  if (i.user && i.user.login === "github-actions[bot]") return true;
  return !i.author_association || /^(OWNER|MEMBER|COLLABORATOR)$/.test(i.author_association);
}
const AABNE_ORDEN = ["ny", "next", "igang", "venter"];
function renNoter(body) {
  let s = String(body || "").replace(/\r/g, "").replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/^[\s>*_#-]*(?:deadline|frist)[\s*_]*[:：].*$/gim, "");
  s = s.replace(/^#{1,6}\s*(?:deadline|frist)\s*\n+\s*.+$/gim, "");
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  return s === "_No response_" ? "" : s;
}
function delNoter(noter) {
  let s = noter || "", kilde = null, hel = null;
  const m = /^Oprettet af robotten fra #\d+ \((.*)\)\.[ \t]*\n*/.exec(s);
  if (m) { kilde = m[1]; s = s.slice(m[0].length); }
  const h = /(?:^|\n)Hele opgaven:[ \t]*([\s\S]+?)\s*$/.exec(s);
  if (h) { hel = h[1].trim(); s = s.slice(0, h.index); }
  return { kilde: kilde, hel: hel, noter: s.trim() };
}
function deadlineIBeskrivelse(body, ref) {
  const s = String(body || "");
  let m = /^[\s>*_#-]*(?:deadline|frist)[\s*_]*[:：][\s*_]*(.+)$/im.exec(s);
  if (m) { const d = tolkDato(m[1].replace(/[*_]/g, ""), ref); if (d) return d; }
  m = /^#{1,6}\s*(?:deadline|frist)\s*\n+\s*(.+)$/im.exec(s);
  if (m) return tolkDato(m[1], ref);
  return null;
}
function normaliserOpgave(i, moeder) {
  const oprettet = i.created_at ? new Date(i.created_at) : new Date();
  const oprettetDag = datoFraTid(oprettet);
  const personer = [], tags = [];
  let status = null, luk = null, pulje = false;
  for (const l of i.labels || []) {
    const navn = String(typeof l === "string" ? l : l.name || "").trim();
    if (!navn) continue;
    if (erPuljeLabel(navn)) { pulje = true; continue; }
    if (erPersonLabel(navn)) {
      const p = personNavn(navn);
      if (!personer.some(function (x) { return lav(x) === lav(p); })) personer.push(p);
      continue;
    }
    const st = statusFraLabel(navn);
    if (st === "faerdig" || st === "droppet") { luk = st; continue; }
    if (st) { if (AABNE_ORDEN.indexOf(st) > AABNE_ORDEN.indexOf(status)) status = st; continue; }
    tags.push(navn);
  }
  const bl = delLog(i.body);
  const n = delNoter(renNoter(bl.foer));
  const t = delTitel(i.title, oprettetDag);
  const lukket = i.state === "closed" || luk !== null;
  const droppet = (i.state === "closed" && (i.state_reason === "not_planned" || i.state_reason === "duplicate")) || luk === "droppet";
  const emneLabel = emneFraLabels(tags);
  if (emneLabel) tags.splice(tags.indexOf(emneLabel.tag), 1);
  const tilfoejet = bl.log.filter(function (e) { return e.type === "Tilføjet"; })[0] || null;
  const kildeDato = n.kilde ? findDato(n.kilde, oprettetDag) : null;
  let deadline = null, dlSlags = null;
  if (t.slags === "dato") { deadline = t.dato; dlSlags = "dato"; }
  else if (t.slags === "moede") {
    let ref = kildeDato || oprettetDag;
    for (const e of bl.log) if (e.type === "Rettet" && /deadline → næste møde/.test(e.tekst)) ref = e.dato;
    dlSlags = "moede";
    deadline = moeder.filter(function (x) { return x > ref; })[0] || null;
  }
  else if (t.slags === "tekst") dlSlags = "tekst";
  else { deadline = deadlineIBeskrivelse(bl.foer, oprettet); if (deadline) dlSlags = "dato"; }
  let resultat = null;
  if (lukket) for (const e of bl.log) if (e.type === "Færdig" || e.type === "Droppet") resultat = e.tekst || null;
  personer.sort(function (a, b) { return a.localeCompare(b, "da"); });
  return {
    nr: i.number, titel: t.tekst || i.title, helTitel: n.hel || t.tekst || i.title,
    emne: emneLabel ? emneLabel.emne : gaetEmne(n.hel || t.tekst || i.title, personer),
    tags: tags, personer: personer, pulje: pulje || !personer.length,
    status: lukket ? "faerdig" : (status || "ny"), droppet: droppet,
    lukket: i.state === "closed" && i.closed_at ? new Date(i.closed_at) : lukket ? new Date() : null,
    deadline: deadline, dlSlags: dlSlags, dlTekst: t.slags === "tekst" ? t.fristTekst : null,
    oprettetDag: oprettetDag, fraDato: kildeDato && kildeDato <= oprettetDag ? kildeDato : oprettetDag,
    tilfoejetAf: tilfoejet ? tilfoejet.af : null, log: bl.log, resultat: resultat
  };
}
function efterDeadline(a, b) {
  const v = function (o) { return o.deadline ? o.deadline.getTime() : o.dlSlags === "moede" ? 8.6e15 : 8.7e15; };
  return (v(a) - v(b)) || (a.nr - b.nr);
}
function hvemTekst(o) { return o.personer.length ? ogListe(o.personer) : PULJE; }
function dmKort(d) {
  return d.getDate() + "/" + (d.getMonth() + 1) + (d.getFullYear() === idag().getFullYear() ? "" : "-" + String(d.getFullYear()).slice(2));
}
const STATUS_ORD = { ny: "Ikke startet", next: "Next up", igang: "I gang", venter: "Venter" };
const NYT_ORD = { "I gang": "satte den i gang", "Venter": "venter på andre", "Next up": "næste i køen",
  "Ikke startet": "ikke nået endnu", "Tog opgaven": "tog opgaven", "Rettet": "rettede opgaven",
  "Lagt tilbage til bestyrelsen": "lagde den tilbage til bestyrelsen" };
// Mangler opgaven en status til de andre før mødet? (som på siden)
function manglerStatus(o, siden) {
  if (!o.personer.length) return false;
  if (o.status !== "faerdig") {
    const sidst = o.log.length ? o.log[o.log.length - 1].dato : o.fraDato;
    return sidst <= siden;
  }
  return !!(o.lukket && o.lukket >= siden && !o.resultat);
}
// Det seneste nye om en åben opgave siden sidste møde (som "seneste nyt" på siden)
function senesteNyt(o, siden) {
  const efter = o.log.filter(function (e) { return e.dato > siden && e.type !== "Tilføjet"; });
  const medTekst = efter.filter(function (e) { return e.tekst; });
  if (medTekst.length) { const e = medTekst[medTekst.length - 1]; return e.datoTekst + " · " + e.af + ": " + e.tekst; }
  if (efter.length) { const e = efter[efter.length - 1]; return e.datoTekst + " · " + e.af + " " + (NYT_ORD[e.type] || lav(e.type)); }
  if (o.fraDato > siden) return o.tilfoejetAf ? "Ny – tilføjet af " + o.tilfoejetAf + " " + dmKort(o.oprettetDag) : "Ny siden sidst";
  if (!o.personer.length) return "Ingen har taget den endnu";
  return "Ingen status siden " + dmKort(siden);
}
// Én linje i dokumentet
function opgaveLinje(o, siden) {
  if (o.status === "faerdig") {
    const res = o.resultat ? (o.droppet ? "Droppet – " : "") + o.resultat : (o.droppet ? "Droppet" : "intet resultat skrevet");
    return (o.droppet ? "✖️ " : "✅ ") + o.helTitel + " – " + hvemTekst(o) + ": " + res;
  }
  let meta = STATUS_ORD[o.status] || "Ikke startet";
  if (o.deadline) meta += " · deadline " + dmKort(o.deadline) + (o.deadline < idag() ? " (over tid)" : "");
  else if (o.dlSlags === "moede") meta += " · deadline næste møde";
  else if (o.dlTekst) meta += " · " + o.dlTekst;
  return (manglerStatus(o, siden) ? "⚠️ " : "⏳ ") + o.helTitel + " – " + hvemTekst(o) + " · " + meta + ": " + senesteNyt(o, siden);
}

// ------------------------------------------------------------------ punkterne på dagsordenen
const PUNKT_REGLER = [
  ["velkomst", /^velkomst|godkendelse af (sidste )?referat/],
  ["formand", /^formand/],
  ["hal", /^hal(len|ler|lerne)?(?![a-zæøå])/],
  ["oekonomi", /^økonomi/],
  ["aarshjul", /^årshjul/],
  ["kommunikation", /^hjemmeside|^sociale medier|^kommunikation/],
  ["ungdom", /^børn|^ungdom/],
  ["mix", /^mix/],
  ["ds", /^danmarksserie/],
  ["division", /^division/],
  ["sponsor", /^sponsor/],
  ["toej", /^tøj/],
  ["eventuelt", /^eventuelt/],
  ["dato", /^dato for næste/]
];
// "Økonomi" -> "oekonomi" · "13. Eventuelt" -> "eventuelt" · andre punkter -> "x:<titel>" · null = ikke et punkt
function punktNoegle(titel) {
  const t = lav(titel).replace(/^[\s\d.]+/, "").replace(/\s+/g, " ").trim();
  if (!t || /^punkt(er)?\s+(nr|til)/.test(t) || /^mødet tog/.test(t)) return null;
  for (const r of PUNKT_REGLER) if (r[1].test(t)) return r[0];
  return "x:" + t.slice(0, 40);
}
function punktTitel(noegle) {
  const i = PUNKT_REGLER.map(function (r) { return r[0]; }).indexOf(noegle);
  return i >= 0 ? SKABELON_PUNKTER[i] : String(noegle).replace(/^x:/, "");
}
// Hold-ord i teksten -> mix / Danmarksserie / division
function holdPunkt(tekst) {
  const t = " " + lav(tekst) + " ";
  if (/(?:^|[^a-zæøå])mix(?![a-zæøå])|mixhold/.test(t)) return "mix";
  if (/danmarksserie|jyllandsserie|(?:^|[^a-zæøå])(ds[dh]?|js[dhm]?)(?![a-zæøå])|(?:^|[^a-zæøå])[dh][4-9](?![0-9])|(dame|herre)\s?[4-9](?![0-9])|old ?(boys|girls)/.test(t)) return "ds";
  if (/division|(?:^|[^a-zæøå])liga|pokal|(?:^|[^a-zæøå])[dh][1-3](?![0-9])|(dame|herre)\s?[1-3](?![0-9])/.test(t)) return "division";
  return null;
}
const EMNE_PUNKT = { oekonomi: "oekonomi", sponsor: "sponsor", ungdom: "ungdom", arrangementer: "aarshjul",
  toej: "toej", kommunikation: "kommunikation", faciliteter: "hal", forening: "formand" };
function emnePunkt(id, tekst) {
  return EMNE_PUNKT[id] || holdPunkt(tekst) || (id === "traenere" ? "formand" : null);
}
function punktFraEmne(o) { return emnePunkt(o.emne.id, o.helTitel) || "eventuelt"; }
function punktFraLabels(tags) {
  for (const t of tags || []) {
    const n = punktNoegle(t);
    if (n && n.slice(0, 2) !== "x:") return n;
  }
  return null;
}
// Ord, der siger noget: små bogstaver, mindst 2 tegn (så "NM", "H4" og "JSH" tæller med), ikke fyldord,
// og uden bøjningsendelse ("trænerne" -> "træn", "hallen" -> "hal")
const FYLDORD = {};
("af at de dem den der det din dit du en er et for fra få gå ha har her hen hun han hvad hvem hvor hvis hvornår " +
  "hvordan i ift ifm ang vedr angående evt fx ca pr nr kl mv osv jo ja nej nu når og om op os på så se sig skal som " +
  "til ud ind ved vi vil kan med mod mig men mere meget alle andre anden andet noget nogle nogen også over under " +
  "mellem efter inden omkring være været blive bliver gøre lave sende skrive høre tjekke følge finde undersøge " +
  "undersøg kigge snakke spørge melde melder asap næste møde mødet klubben klubbens vores deres dette disse denne " +
  "sidst sidste igen hver enkelte dag dage uger måske samt både lige allerede sådan selv mand gang gange ville " +
  "skulle derfor fordi godt gerne have kunne ikke eller hos uden ny nye nyt besked beskeder mail mails info liste " +
  "prøve sørge tage tager give giver komme kommer holde holder sætte sætter stille stiller bruge bruger kende " +
  "kender stå står ligge ligger hjælpe hjælper mangler taget tog bestille bestil bestilt købe køb købt ringe ring " +
  "kontakte kontakt aftale aftal planlægge planlæg afklare afklar opdatere opdater opdateret udsende indhente " +
  "indhent booke book booket tilmelde tilmeld invitere inviter forhøre forhør arrangere sikre")
  .split(" ").forEach(function (w) { FYLDORD[w] = true; });
const ENDELSER = ["erne", "ende", "ene", "ere", "ens", "ets", "ers", "er", "en", "et", "es", "e", "s"];
function ordStamme(w) {
  const skaer = function (ord, liste) {      // lange endelser kun af lange ord ("udsende" er ikke "ud" + "sende")
    for (const e of liste) {
      if (ord.slice(-e.length) === e && ord.length - e.length >= (e.length >= 3 ? 4 : 3)) return ord.slice(0, -e.length);
    }
    return ord;
  };
  let s = skaer(w, ENDELSER);
  if (s !== w) s = skaer(s, ["er", "en", "e"]);                      // "sponsorerer", "generalforsamlingens"
  return /([bdfgklmnprstv])\1$/.test(s) ? s.slice(0, -1) : s;          // "hall" -> "hal"
}
function ordListe(s) {
  const ud = [];
  for (const w of lav(s).split(/[^a-zæøåéü0-9]+/)) {
    if (w.length < 2 || /^\d+$/.test(w) || FYLDORD[w]) continue;
    const st = ordStamme(w);
    if (ud.indexOf(st) < 0) ud.push(st);
  }
  return ud;
}
// Hvor godt to ord (stammer) passer: samme ord 1 · det ene er sidste led i det andet ("presselokalet" ~
// "lokale", "holdbillede" ~ "billeder") 0,75 · det ene er første led ("børneattester" ~ "børn") 0,5.
// Led på under 4 bogstaver tæller ikke ("afskrivningsmodel" handler ikke om at "dele").
function ordLigner(a, b) {
  if (a === b) return 1;
  const kort = a.length <= b.length ? a : b, lang = kort === a ? b : a;
  if (kort.length < 4 || lang.length < kort.length + 3) return 0;
  if (lang.slice(-kort.length) === kort) return 0.75;
  return lang.indexOf(kort) === 0 ? 0.5 : 0;
}
// Hvor meget teksten peger på hvert emne (samme ord som gaetEmne, uden at vælge ét)
function emnePoint(titel) {
  const t = " " + lav(titel).replace(/\s+/g, " ") + " ";
  const ud = {};
  for (const e of EMNER) {
    let p = 0;
    for (const r of e.regler) {
      r.re.lastIndex = 0;
      let antal = 0, m;
      while ((m = r.re.exec(t)) && antal < 2) { antal++; if (!m[0].length) r.re.lastIndex++; }
      p += antal * r.v;
    }
    if (p > 0) ud[e.id] = p;
  }
  return ud;
}
// Emnets bud på punktet: { nøgle: vægt }. Hvert emne, ordene i opgaven peger på, giver et bud (så "lokale
// til julefrokost" peger på både Hal og Årshjul), og opgavens eget emne (labelen fra robotten) giver fuldt bud.
const EMNE_VAEGT = 0.6;
function emneForslag(o) {
  const ud = {};
  const put = function (n, v) { if (n && v > (ud[n] || 0)) ud[n] = v; };
  const p = emnePoint(o.helTitel);
  let max = 0;
  for (const id in p) max = Math.max(max, p[id]);
  for (const id in p) put(emnePunkt(id, o.helTitel), EMNE_VAEGT * p[id] / max);
  if (o.emne && o.emne.id !== "andet") put(punktFraEmne(o), EMNE_VAEGT);
  return ud;
}
// Point for hvert punkt i sidste referat: hvert ord i opgaven giver 1, delt ud på de punkter, hvor det
// passer bedst (står det samme ord et sted, tæller dele af sammensatte ord ikke; står det kun i
// Ansvarlig-kolonnen, tæller det det halve). Oveni kommer emnets bud.
// punkter: [{ noegle, tekst, ansvarlig }] -> [{ noegle, ord, bud, i_alt, spor }]
function punktPoint(o, punkter) {
  if (!punkter._ord) punkter._ord = punkter.map(function (p) { return { a: ordListe(p.tekst), b: ordListe(p.ansvarlig || "") }; });
  const bedstI = function (w, liste) {
    let v = 0, hvilket = null;
    for (const x of liste) { const g = ordLigner(w, x); if (g > v) { v = g; hvilket = x; if (g === 1) break; } }
    return [v, hvilket];
  };
  const bud = emneForslag(o);
  const ud = punkter.map(function (p) { return { noegle: p.noegle, ord: 0, bud: bud[p.noegle] || 0, i_alt: 0, spor: [] }; });
  for (const w of ordListe(o.helTitel)) {
    const lv = punkter._ord.map(function (s) {
      const a = bedstI(w, s.a), b = bedstI(w, s.b);
      return a[0] >= b[0] ? { v: a[0], f: 1, x: a[1] } : { v: b[0], f: 0.5, x: b[1] };
    });
    const top = Math.max.apply(null, lv.map(function (x) { return x.v; }));
    if (!top) continue;
    const med = lv.filter(function (x) { return x.v === top; }).length;
    lv.forEach(function (x, i) {
      if (x.v !== top) return;
      ud[i].ord += top * x.f / med;
      ud[i].spor.push(w + (x.x !== w ? "~" + x.x : "") + (x.f < 1 ? " (ansvarlig)" : ""));
    });
  }
  for (const x of ud) x.i_alt = x.ord + x.bud;
  return ud;
}
// Det punkt, opgaven klart hører til – ellers null: mindst 0,3 fra ordene og 0,25 foran nummer to
function lignerPunkt(o, punkter) {
  if (!punkter || !punkter.length) return null;
  const pt = punktPoint(o, punkter).slice().sort(function (a, b) { return b.i_alt - a.i_alt; });
  const naest = pt.length > 1 ? Math.max(pt[1].i_alt, 0) : 0;
  return pt[0].ord >= 0.3 && pt[0].i_alt - naest >= 0.25 ? pt[0].noegle : null;
}
// { punkt-nøgle: [opgaver] } i dokumentets rækkefølge. findes: de punkter, dokumentet har (null = alle)
function fordelPaaPunkter(opgaver, forrigePunkter, findes) {
  const kan = function (n) { return !findes || findes.indexOf(n) >= 0; };
  const ud = {};
  for (const o of opgaver) {
    let n = punktFraLabels(o.tags);
    if (!n || !kan(n)) {
      const l = forrigePunkter ? lignerPunkt(o, forrigePunkter) : null;
      n = l && kan(l) && l !== "velkomst" && l !== "dato" ? l : punktFraEmne(o);
    }
    if (!kan(n)) n = ["eventuelt", "formand"].filter(kan)[0] || (findes && findes.filter(function (x) {
      return x !== "velkomst" && x !== "dato";
    }).pop()) || n;
    (ud[n] = ud[n] || []).push(o);
  }
  return ud;
}

// ------------------------------------------------------------------ Drev: skabelon, mapper og dokumenter
function findSkabelon() {
  try {
    const f = DriveApp.getFileById(SKABELON);
    if (!f.isTrashed()) return f;
  } catch (e) { /* søg på navnet herunder */ }
  const it = DriveApp.searchFiles('title contains "' + SKABELON_NAVN + '" and trashed = false');
  while (it.hasNext()) {
    const f = it.next();
    if (/document/.test(f.getMimeType())) return f;
  }
  throw "Fandt ikke skabelonen \"" + SKABELON_NAVN + "\" i Drev. Ret SKABELON øverst i afsnittet MØDEDOKUMENTET.";
}
// { skabelon, rod: mappen med skabelonen, saesoner: undermapper som "2026-2027", nyeste først }
function moedeMapper() {
  const skabelon = findSkabelon();
  const foraeldre = skabelon.getParents();
  if (!foraeldre.hasNext()) throw "Skabelonen ligger ikke i en mappe.";
  const rod = foraeldre.next();
  const saesoner = [];
  const it = rod.getFolders();
  while (it.hasNext()) {
    const f = it.next();
    const m = /^\s*(\d{4})\s*[-–\/]\s*(\d{2,4})\s*$/.exec(f.getName());
    if (m) saesoner.push({ mappe: f, start: +m[1] });
  }
  saesoner.sort(function (a, b) { return b.start - a.start; });
  return { skabelon: skabelon, rod: rod, saesoner: saesoner.map(function (s) { return s.mappe; }) };
}
function punktDato(d) { return ("0" + d.getDate()).slice(-2) + "." + ("0" + (d.getMonth() + 1)).slice(-2) + "." + d.getFullYear(); }
// "6. møde - 18.11.2026" / "4. møde 23.09.2026" / "3. Møde 10.08.2026" – ikke generalforsamlingen
function erDokTilMoede(navn, d) {
  const n = lav(navn);
  if (!/(?:^|[^a-zæøå])(bestyrelses)?møde(?![a-zæøå])/.test(n) || /generalforsamling/.test(n)) return false;
  const re = new RegExp("(?:^|\\D)0?" + d.getDate() + "\\s*[.\\/-]\\s*0?" + (d.getMonth() + 1) +
    "\\s*[.\\/-]\\s*(?:" + d.getFullYear() + "|" + String(d.getFullYear()).slice(2) + ")(?!\\d)");
  return re.test(n);
}
// Dokumentet til mødet d – helst et, der hedder "N. møde …" (ikke "Kopi af …")
function findMoedeDok(mapper, d) {
  const mapperne = mapper.saesoner.concat([mapper.rod]);
  for (const mappe of mapperne) {
    let reserve = null;
    const it = mappe.getFilesByType(MimeType.GOOGLE_DOCS);
    while (it.hasNext()) {
      const f = it.next();
      if (f.isTrashed() || !erDokTilMoede(f.getName(), d)) continue;
      if (/^\s*\d+\s*\.\s*møde/i.test(f.getName())) return f;
      reserve = reserve || f;
    }
    if (reserve) return reserve;
  }
  return null;
}
function nytNavn(mapper, d) {
  const mappe = mapper.saesoner[0] || mapper.rod;
  let nr = 0;
  const it = mappe.getFilesByType(MimeType.GOOGLE_DOCS);
  while (it.hasNext()) {
    const m = /^\s*(\d+)\s*\.\s*møde/i.exec(it.next().getName());
    if (m) nr = Math.max(nr, +m[1]);
  }
  return (nr + 1) + ". møde - " + punktDato(d);
}

// Nyt dokument til mødet: kopi af skabelonen (Word-filen laves om til Google Docs), med dato, sted og
// deltagere udfyldt og opgavetabellen nederst
function lavMoedeDok(mapper, p, forrige, k) {
  const mappe = mapper.saesoner[0] || mapper.rod;
  const navn = nytNavn(mapper, p.naeste);
  let id;
  if (mapper.skabelon.getMimeType() === MimeType.GOOGLE_DOCS) {
    id = mapper.skabelon.makeCopy(navn, mappe).getId();
  } else {
    try {
      id = konverterTilDocs(mapper.skabelon, mappe.getId());
    } catch (e) {
      Logger.log("Skabelonen kunne ikke laves om til Google Docs (" + e + ") – bygger dokumentet selv");
      id = bygMoedeDok(navn, mappe);
    }
    const fil = DriveApp.getFileById(id);
    if (fil.getName() !== navn) fil.setName(navn);
  }
  const doc = DocumentApp.openById(id);
  const tekst = p.tekst[iso(p.naeste)] || "";
  const kl = /kl\.?\s*(\d{1,2})(?:[.:](\d{2}))?/i.exec(tekst);
  let sted = "";
  try { if (forrige) sted = laesHovedfelt(DocumentApp.openById(forrige.getId()), "sted"); } catch (e) { /* så står det tomt */ }
  udfyldHoved(doc, {
    dato: punktDato(p.naeste) + (kl ? " kl " + kl[1] + ":" + (kl[2] || "00") : ""),
    sted: sted,
    deltagere: k.medlemmer.join(", ")
  });
  sikrOpgaveTabel(doc);
  doc.saveAndClose();
  return DriveApp.getFileById(id);
}
// Word -> Google Docs gennem Drevs eget API (samme som "Åbn med Google Docs"), lagt i mappen
function konverterTilDocs(fil, mappeId) {
  const blob = fil.getBlob();
  const graense = "aav" + Utilities.getUuid().replace(/-/g, "");
  const meta = JSON.stringify({ name: "Nyt mødedokument", mimeType: MimeType.GOOGLE_DOCS, parents: [mappeId] });
  const foer = "--" + graense + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + meta + "\r\n--" + graense +
    "\r\nContent-Type: " + (blob.getContentType() || "application/octet-stream") + "\r\n\r\n";
  const efter = "\r\n--" + graense + "--\r\n";
  const bytes = Utilities.newBlob(foer).getBytes().concat(blob.getBytes()).concat(Utilities.newBlob(efter).getBytes());
  const r = UrlFetchApp.fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id", {
    method: "post", contentType: "multipart/related; boundary=" + graense, payload: bytes, muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }
  });
  if (r.getResponseCode() !== 200) throw "Drev svarede " + r.getResponseCode() + ": " + r.getContentText().slice(0, 200);
  return JSON.parse(r.getContentText()).id;
}
// Reserve, hvis skabelonen ikke kan bruges: samme opbygning som skabelonen
function bygMoedeDok(navn, mappe) {
  const doc = DocumentApp.create(navn);
  const body = doc.getBody();
  const hoved = body.appendTable([["Dagsorden til bestyrelsesmøde i Aalborg Volleyball", ""], ["Dato & tid:", ""],
    ["Sted:", ""], ["Deltagere:", ""], ["Afbud:", ""], ["Evt. gæster:", ""], ["Referent:", ""], ["Ordstyrer:", ""]]);
  for (let r = 0; r < hoved.getNumRows(); r++) hoved.getRow(r).getCell(0).editAsText().setBold(true);
  body.appendParagraph("");
  const rows = [["Punkt nr.", "Punkter til drøftelse/beslutning", "Ansvarlig"]];
  SKABELON_PUNKTER.forEach(function (t, i) { rows.push([(i + 1) + ".", t, ""]); });
  rows.push(["", "Mødet tog:", ""]);
  const dag = body.appendTable(rows);
  for (let r = 0; r < dag.getNumRows(); r++) {
    dag.getRow(r).getCell(0).editAsText().setBold(true);
    dag.getRow(r).getCell(1).editAsText().setBold(true);
    if (r === 0) dag.getRow(r).getCell(2).editAsText().setBold(true);
  }
  const forste = body.getChild(0);
  if (forste.getType() === DocumentApp.ElementType.PARAGRAPH && !forste.asParagraph().getText()) forste.asParagraph().removeFromParent();
  doc.saveAndClose();
  const fil = DriveApp.getFileById(doc.getId());
  fil.moveTo(mappe);
  return doc.getId();
}
// Hovedtabellen: "Dato & tid:", "Sted:", "Deltagere:" … i venstre kolonne, værdien til højre
function hovedRaekker(doc) {
  const ud = {};
  for (const t of doc.getBody().getTables()) {
    for (let r = 0; r < t.getNumRows(); r++) {
      const row = t.getRow(r);
      if (row.getNumCells() < 2) continue;
      const m = /^\s*(dato\s*&\s*tid|sted|deltagere|afbud|evt\.?\s*gæster|referent|ordstyrer)\s*:/i.exec(row.getCell(0).getText());
      if (m && !ud[lav(m[1]).split(/[\s&.]/)[0]]) ud[lav(m[1]).split(/[\s&.]/)[0]] = row.getCell(1);
    }
    if (Object.keys(ud).length) break;
  }
  return ud;       // { dato, sted, deltagere, afbud, evt, referent, ordstyrer }
}
function laesHovedfelt(doc, felt) {
  const c = hovedRaekker(doc)[felt];
  return c ? c.getText().replace(/\s+/g, " ").trim() : "";
}
function udfyldHoved(doc, v) {
  const felter = hovedRaekker(doc);
  for (const navn in v) {
    const celle = felter[navn];
    if (!celle || !v[navn] || celle.getText().trim()) continue;
    const p = celle.getNumChildren() && celle.getChild(0).getType() === DocumentApp.ElementType.PARAGRAPH
      ? celle.getChild(0).asParagraph() : null;
    if (p) p.setText(v[navn]); else celle.setText(v[navn]);
  }
}
function sikrOpgaveTabel(doc) {
  const body = doc.getBody();
  for (const t of body.getTables()) {
    if (t.getNumRows() && t.getRow(0).getNumCells() >= 2 && /^\s*opgave\s*$/i.test(t.getRow(0).getCell(0).getText())) return;
  }
  const rows = [["Opgave", "Person", "Deadline"]];
  for (let i = 0; i < OPGAVE_RAEKKER; i++) rows.push(["", "", ""]);
  body.appendParagraph("");
  const t = body.appendTable(rows);
  for (let c = 0; c < 3; c++) t.getRow(0).getCell(c).editAsText().setBold(true);
}

// ------------------------------------------------------------------ dagsordenen i et dokument
// [{ noegle, celle (cellen med punktets tekst), tekst, ansvarlig (teksten i Ansvarlig) }] for punkterne i dagsordenstabellen
function dagsorden(doc) {
  let bedst = null;
  for (const t of doc.getBody().getTables()) {
    const raekker = [];
    for (let r = 0; r < t.getNumRows(); r++) {
      const row = t.getRow(r);
      if (row.getNumCells() < 2) continue;
      const celle = row.getCell(row.getNumCells() >= 3 ? 1 : row.getNumCells() - 1);
      const n = punktNoegle(forsteLinje(celle));
      if (!n) continue;
      const ansvarlig = row.getNumCells() >= 3 ? row.getCell(2) : null;
      raekker.push({ noegle: n, celle: celle, tekst: celle.getText(), ansvarlig: ansvarlig ? ansvarlig.getText() : "" });
    }
    const kendte = raekker.filter(function (x) { return x.noegle.slice(0, 2) !== "x:"; }).length;
    if (kendte >= 3 && (!bedst || kendte > bedst.kendte)) bedst = { raekker: raekker, kendte: kendte };
  }
  return bedst ? bedst.raekker : [];
}
function forsteLinje(celle) {
  for (let i = 0; i < celle.getNumChildren(); i++) {
    const t = elementTekst(celle.getChild(i)).trim();
    if (t) return t;
  }
  return "";
}
function elementTekst(el) {
  const T = DocumentApp.ElementType;
  const type = el.getType();
  if (type === T.PARAGRAPH) return el.asParagraph().getText();
  if (type === T.LIST_ITEM) return el.asListItem().getText();
  if (type === T.TABLE) return el.asTable().getText();
  return "";
}
// Sidste referats punkter til at genkende, hvor en opgave blev drøftet
function laesPunkter(doc) {
  return dagsorden(doc).filter(function (p) { return p.noegle !== "velkomst" && p.noegle !== "dato"; })
    .map(function (p) { return { noegle: p.noegle, tekst: p.tekst, ansvarlig: p.ansvarlig }; });
}

// ------------------------------------------------------------------ skriv opfølgningen
// Hver linje, knappen skriver, får et navngivet område "aav-opfoelgning:<fingeraftryk af teksten>". Næste
// gang fjernes kun de linjer, der står præcis som knappen skrev dem – har nogen skrevet i en linje, får den
// lov at blive stående. De nye linjer kommer samme sted, som de gamle stod.
function fingeraftryk(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
function celleAdresse(celle) {
  const raekke = celle.getParent(), tabel = raekke.getParent();
  return tabel.getParent().getChildIndex(tabel) + ":" + tabel.getChildIndex(raekke) + ":" + raekke.getChildIndex(celle);
}
// -> { pladser: { celleadresse: hvor de gamle linjer startede }, bevaret: linjer, nogen har rettet i }
function fjernOpfoelgning(doc) {
  const T = DocumentApp.ElementType;
  const ud = { pladser: {}, bevaret: 0 };
  const fjern = [];
  for (const nr of doc.getNamedRanges()) {
    const navn = nr.getName();
    if (navn !== OPF_OMRAADE && navn.indexOf(OPF_OMRAADE + ":") !== 0) continue;
    const aftryk = navn.slice(OPF_OMRAADE.length + 1);
    for (const re of nr.getRange().getRangeElements()) {
      let el = re.getElement();
      while (el && el.getType() !== T.PARAGRAPH && el.getType() !== T.LIST_ITEM) el = el.getParent();
      if (!el) continue;
      const p = el.getType() === T.LIST_ITEM ? el.asListItem() : el.asParagraph();
      if (aftryk && fingeraftryk(p.getText()) !== aftryk) { ud.bevaret++; continue; }   // nogen har skrevet i den
      fjern.push(p);
    }
    nr.remove();
  }
  for (const p of fjern) {
    try {
      const foraelder = p.getParent();
      if (foraelder.getType() === T.TABLE_CELL) {
        const adr = celleAdresse(foraelder), plads = foraelder.getChildIndex(p);
        if (ud.pladser[adr] === undefined || plads < ud.pladser[adr]) ud.pladser[adr] = plads;
      }
      if (foraelder.getNumChildren() > 1) p.removeFromParent();
      else p.clear();
    } catch (e) { /* allerede væk */ }
  }
  return ud;
}
// Et nyt afsnit i cellen (eller nederst i dokumentet), på plads nr. "plads" eller til sidst
function tilfoej(beholder, tekst, stil, skrift, plads) {
  const p = plads == null ? beholder.appendParagraph(tekst) : beholder.insertParagraph(plads, tekst);
  p.setHeading(DocumentApp.ParagraphHeading.NORMAL);
  const a = {};
  a[DocumentApp.Attribute.BOLD] = !!stil.fed;
  a[DocumentApp.Attribute.ITALIC] = !!stil.kursiv;
  a[DocumentApp.Attribute.UNDERLINE] = false;
  a[DocumentApp.Attribute.FOREGROUND_COLOR] = stil.farve || "#000000";
  if (skrift && skrift.familie) a[DocumentApp.Attribute.FONT_FAMILY] = skrift.familie;
  if (skrift && skrift.stoerrelse) a[DocumentApp.Attribute.FONT_SIZE] = skrift.stoerrelse;
  if (tekst) p.editAsText().setAttributes(a);
  return p;
}
// Skriften i punktets titel, så opfølgningen ser ud som resten af dokumentet
function cellensSkrift(celle) {
  for (let i = 0; i < celle.getNumChildren(); i++) {
    const el = celle.getChild(i);
    if (el.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;
    const t = el.asParagraph().editAsText();
    if (!t.getText().trim()) continue;
    return { familie: t.getFontFamily(0) || null, stoerrelse: t.getFontSize(0) || null };
  }
  return null;
}
function skrivOpfoelgning(fil, p, forrigePunkter) {
  const doc = DocumentApp.openById(fil.getId());
  const gammel = fjernOpfoelgning(doc);
  const punkter = dagsorden(doc);
  const siden = p.siden;
  const alle = p.data.klaret.concat(p.data.aabne);
  const nu = Utilities.formatDate(new Date(), TZ, "d/M 'kl.' HH.mm");
  // Hvem mangler at give status?
  const mangler = {};
  let iAlt = 0;
  for (const o of alle) {
    if (!manglerStatus(o, siden)) continue;
    iAlt++;
    for (const n of o.personer) mangler[n] = (mangler[n] || 0) + 1;
  }
  const manglerTekst = Object.keys(mangler).sort(function (a, b) { return mangler[b] - mangler[a] || a.localeCompare(b, "da"); })
    .map(function (n) { return n + " " + mangler[n]; }).join(", ");
  const sidenTekst = (p.sidste ? "mødet " : "") + dmKort(siden);
  const overblik = [
    { tekst: "Opfølgning på opgaverne siden " + sidenTekst + " – status pr. " + nu + ":", stil: { kursiv: true, farve: GRAA } },
    { tekst: "✅ " + p.data.klaret.length + " klaret · ⏳ " + p.data.aabne.length + " åbne" +
      (iAlt ? " · ⚠️ " + iAlt + " uden status siden " + sidenTekst + " (" + manglerTekst + ")" : " · alle har givet status"), stil: {} },
    { tekst: alle.length ? "Opgaverne står under de punkter, de hører til." : "Ingen opgaver at følge op på.", stil: { kursiv: true, farve: GRAA } }
  ];
  const fordelt = fordelPaaPunkter(alle, forrigePunkter, punkter.length ? punkter.map(function (x) { return x.noegle; }) : null);
  const resultat = {};
  const marker = function (afsnit, tekst) {
    doc.addNamedRange(OPF_OMRAADE + ":" + fingeraftryk(tekst), doc.newRange().addElement(afsnit).build());
  };
  const skriv = function (celle, linjer) {
    const skrift = cellensSkrift(celle);
    let plads = gammel.pladser[celleAdresse(celle)];
    if (plads !== undefined) plads = Math.min(plads, celle.getNumChildren());
    for (const l of linjer) {
      marker(tilfoej(celle, l.tekst, l.stil, skrift, plads), l.tekst);
      if (plads !== undefined) plads++;
    }
  };
  const blok = function (liste) {
    const sorteret = liste.filter(function (o) { return o.status === "faerdig"; })
      .concat(liste.filter(function (o) { return o.status !== "faerdig"; }));
    return [{ tekst: "Opgaver (status pr. " + nu + "):", stil: { kursiv: true, farve: GRAA } }]
      .concat(sorteret.map(function (o) { return { tekst: opgaveLinje(o, siden), stil: {} }; }));
  };
  if (punkter.length) {
    const velkomst = punkter.filter(function (x) { return x.noegle === "velkomst"; })[0] || punkter[0];
    skriv(velkomst.celle, overblik);
    for (const pk of punkter) {
      const liste = fordelt[pk.noegle];
      if (!liste || !liste.length) continue;
      skriv(pk.celle, blok(liste));
      resultat[punktTitel(pk.noegle)] = (resultat[punktTitel(pk.noegle)] || 0) + liste.length;
      delete fordelt[pk.noegle];                 // står et punkt to gange, kommer opgaverne kun under det første
    }
  } else {
    // Ingen dagsorden at finde: hele opfølgningen nederst i dokumentet
    const body = doc.getBody();
    const tilKrop = function (tekst, stil) { marker(tilfoej(body, tekst, stil, null), tekst); };
    tilKrop("Opfølgning på opgaverne", { fed: true });
    for (const l of overblik) tilKrop(l.tekst, l.stil);
    for (const n in fordelt) {
      tilKrop(punktTitel(n), { fed: true });
      for (const l of blok(fordelt[n]).slice(1)) tilKrop(l.tekst, l.stil);
      resultat[punktTitel(n)] = fordelt[n].length;
    }
  }
  doc.saveAndClose();
  return { mangler: iAlt, punkter: resultat, bevaret: gammel.bevaret };
}

// ------------------------------------------------------------------ emner (samme regler som siden)
// Står også i index.html – ret begge steder. En label med emnets navn i GitHub vinder over gættet.
const EMNER = [
  { id: "oekonomi", navn: "Økonomi", ikon: "💰", personer: [/^kasserer(en|ne|e)?$/],
    ord: ["økonomi", "kontingent", "betal", "faktura", "regnskab", "budget", "refusion", "mobilepay", "kasserer",
      "gæld", "penge", "takst", "udlæg", "indbetal", "opkræv", "bankkonto", "beløb", "~pris", "~gebyr", "tilskud", "moms", "løn"] },
  { id: "sponsor", navn: "Sponsorer & fonde", ikon: "🤝",
    ord: ["sponsor", "fond", "ansøgning", "bambusa", "kampagne", "donation", "partner", "~støtte", "lodseddel", "lotteri"] },
  { id: "hold", navn: "Hold & turneringer", ikon: "🏐",
    ord: ["jyllandsserie", "turnering", "licens", "kredskontakt", "melde fra", "kampprogram", "~serie", "division",
      "liga", "pokal", /\bmix\b/, "holdtilmeld", "~tilmeld", "spillere", { re: /\bspiller\b/, v: 0.5 },
      "dobbelt klub", "klubskifte", { re: /\b(dame|herre)\s?\d\b/, v: 0.5 }] },
  { id: "traenere", navn: "Trænere & kurser", ikon: "🎓",
    ord: ["træner", "trænerhjælp", "kursus", "kurset", "kurser", /\bdommer(e|ne|kursus|kurser|uddannelse)?\b/,
      "uddannelse", "dt-", "instruktør", "nødløsning"] },
  { id: "ungdom", navn: "Ungdom", ikon: "🧒",
    ord: ["ungdom", /\b[dhu]?u1\d\b/, "børn", "skoleforløb", "skole", "kickprojekt", "forælder", "forældre",
      "boldlanger", "junior"] },
  { id: "arrangementer", navn: "Arrangementer & frivillige", ikon: "🎉",
    ord: ["fest", "julefrokost", "arrangement", "baren", /\bbar\b/, "indkøb", "speaker", "hjemmekamp", "tjans",
      "frivillig", "stævneleder", "~stævne", "event", "afslutning", "reception", "jubilæum"] },
  { id: "toej", navn: "Tøj & udstyr", ikon: "👕",
    ord: ["tøj", "trøje", "trøjen", "tryk", "merchandise", "udstyr", /\bbolde?\b/, /\bnet(tet)?\b/, "hæverkurv",
      "dommerstol", "flyttekasse", "materiel", "rekvisit"] },
  { id: "kommunikation", navn: "Kommunikation", ikon: "📣",
    ord: ["hjemmeside", "facebook", "instagram", "nyhedsbrev", "presse", "interview", "dk4", /\btv\b/, "volley-tv",
      "medie", "billede", "holdbeskrivelse", "plakat", "annonce", "~opslag", "~chat", "~gruppebesked", "~manus",
      /\bsome\b/, "sociale medier"] },
  { id: "faciliteter", navn: "Haller & lokaler", ikon: "🔑",
    ord: [/\bhal(len|ler|lerne|tid|tider)?\b/, "haltid", "nøgle", "klubhus", "lokale", /\brum(met)?\b/, "brik",
      "katedral", "computer", "~låne", "lån af", "omklædning", "depot", /\bskab(e|et)?\b/] },
  { id: "forening", navn: "Forening & bestyrelse", ikon: "🏛️",
    ord: ["generalforsamling", "bestyrelse", "ordstyrer", "vedtægt", "referat", "kommune", "forening", "forbund",
      "medlem", "gældsbrev", "underskrift", "kontrakt", "~aftale", "strategi", "~næste sæson", "~dokument",
      "forsikring", "gdpr"] }
];
const ANDET = { id: "andet", navn: "Andet", ikon: "📌" };
(function () {          // gør ordene klar én gang: alt bliver til regex med vægt
  const esc = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); };
  const kilde = function (src) {      // \b kender ikke æ/ø/å – brug samme ordgrænser som robotten
    return src.replace(/^\\b/, "(?:^|[^a-z0-9æøåéü])").replace(/\\b$/, "(?=[^a-z0-9æøåéü]|$)");
  };
  for (const e of EMNER) {
    e.regler = e.ord.map(function (o) {
      if (o instanceof RegExp) return { re: new RegExp(kilde(o.source), "g"), v: 1 };
      if (o && o.re) return { re: new RegExp(kilde(o.re.source), "g"), v: o.v };
      const svag = o.charAt(0) === "~";
      return { re: new RegExp(esc(svag ? o.slice(1) : o), "g"), v: svag ? 0.5 : 1 };
    });
  }
})();
function gaetEmne(titel, personer) {
  const t = " " + lav(titel).replace(/\s+/g, " ") + " ";
  const point = EMNER.map(function () { return 0; });
  let tidligst = Infinity, tidligstI = -1;
  EMNER.forEach(function (e, i) {
    for (const r of e.regler) {
      r.re.lastIndex = 0;
      let antal = 0, m;
      while ((m = r.re.exec(t)) && antal < 2) {
        antal++;
        if (m.index < tidligst) { tidligst = m.index; tidligstI = i; }
        if (!m[0].length) r.re.lastIndex++;
      }
      point[i] += antal * r.v;
    }
    for (const navn of personer || []) {
      const n = lav(navn).trim();
      if ((e.personer || []).some(function (x) { return x.test(n); })) point[i] += 1;
    }
  });
  if (tidligstI >= 0) point[tidligstI] += 0.3;
  let bedst = -1, max = 0;
  point.forEach(function (p, i) { if (p > max + 1e-9) { max = p; bedst = i; } });
  return bedst >= 0 ? EMNER[bedst] : ANDET;
}
function normEmne(s) {
  return lav(s).replace(/^\s*(emne|kategori)\s*:\s*/, "").replace(/\bog\b/g, "&")
    .replace(/[^\p{L}\p{N}&]+/gu, " ").replace(/\s*&\s*/g, " & ").trim();
}
function emneFraLabels(tags) {
  for (const t of tags) {
    const n = normEmne(t);
    if (!n) continue;
    for (const e of EMNER.concat([ANDET])) {
      const en = normEmne(e.navn);
      if (n === en || n === en.split(" ")[0]) return { emne: e, tag: t };
    }
  }
  return null;
}
