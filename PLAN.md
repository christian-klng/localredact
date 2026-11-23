# LocalRedact – Projektplan

Stand: 20.11.2026

LocalRedact ist eine Desktop-App für macOS, Windows und Linux, die sensible Daten in PDF- und DOCX-Dateien schwärzt. Sie ist ein Fork von [EasyRedact](https://github.com/datenlabor-bmz/easy-redact) (AGPL-3.0) und arbeitet vollständig offline.

## 1. Ziele und Leitplanken

**Ziele**

- Eine installierbare App für macOS, Windows und Linux (jeweils x64 und arm64).
- Alle Funktionen laufen ohne Internetverbindung, auch die KI-gestützte Erkennung.
- Die Schwärzung ist nachweisbar vollständig: Im exportierten Dokument ist der geschwärzte Inhalt nicht mehr enthalten, auch nicht in Metadaten oder versteckten Ebenen.
- PDF und DOCX werden ab der ersten Version unterstützt.

**Leitplanken**

- Die App baut von sich aus keine Verbindung ins Internet auf. Das wird technisch erzwungen und automatisch getestet, nicht nur zugesagt.
- Die Cloud-KI aus EasyRedact wird entfernt, nicht nur ausgeblendet.
- Lizenz bleibt AGPL-3.0, der Quellcode ist öffentlich, Copyright-Hinweise von EasyRedact bleiben erhalten.
- Eigener Name und eigenes Erscheinungsbild; EasyRedact, BMZ DataLab und die EU-Förderung erscheinen nur als Herkunftshinweis.
- Änderungen am übernommenen Code bleiben klein, damit Upstream-Updates übernehmbar bleiben.

**Nicht im Umfang von Version 1**

- Ausgabe als geschwärzte DOCX-Datei (Ausgabe ist immer PDF).
- Texterkennung (OCR) für gescannte PDFs, siehe Phase 6.
- Mehrbenutzer- oder Serverbetrieb.

## 2. Architektur

```
Electron-Hauptprozess
├── Fenster (Chromium)            ← übernommene Oberfläche von EasyRedact
│   ├── MuPDF (WASM, Worker)        PDF-Anzeige, Schwärzung, Export
│   ├── NER-Modell (transformers.js) Namen, Orte, Organisationen
│   └── IndexedDB                   Sitzung, Dokumente, Chat
├── Next.js-Server (Hilfsprozess, nur 127.0.0.1, Zufallsport, Zugriffstoken)
│   └── /api/chat, /api/docx, /api/nlp, /api/rules
├── LLM-Dienst (llama.cpp `llama-server`, nur 127.0.0.1)   ← optional, Stufe 2
└── DOCX-Konverter (verstecktes Fenster bzw. LibreOffice)
```

**Warum so**

- Der Next.js-Server aus EasyRedact läuft unverändert weiter, nur eingebettet. Das hält den Abstand zum Upstream klein.
- `llama-server` bietet eine OpenAI-kompatible Schnittstelle. Die bestehende Chat-Route von EasyRedact spricht genau diese Schnittstelle und braucht deshalb nur eine andere Adresse.
- Der gesamte Desktop-Code liegt in einem eigenen Ordner `desktop/`. Eingriffe in `src/` beschränken sich auf Konfiguration, Entfernen der Cloud-Option und Branding.

**Erkennung in zwei Stufen**

| Stufe | Technik | Verfügbarkeit | Leistet |
|---|---|---|---|
| 1 | Reguläre Ausdrücke und NER-Modell | immer, im Installer enthalten | E-Mail, Telefon, IBAN, Daten, Namen, Orte, Organisationen |
| 2 | Lokales Sprachmodell (LLM) mit Chat-Assistent | optional, Modell wird als Paket importiert | Kontextverständnis, Rückfragen, IFG-Rechtsgründe, Gruppierung nach Personen |

Stufe 1 funktioniert auf jedem Rechner. Stufe 2 braucht ein Modell von mehreren Gigabyte und entsprechend Arbeitsspeicher; deshalb ist es nicht im Installer, sondern wird als Datei importiert (auch per USB-Stick für abgeschottete Rechner).

## 3. Netzwerk-Abschottung

- Der Hauptprozess blockiert jede Anfrage, die nicht an `127.0.0.1` geht (`session.webRequest`), zusätzlich eine strikte Content-Security-Policy ohne externe Hosts.
- NER-Modell, ONNX-Runtime und IFG-Regeln liegen im App-Paket; transformers.js wird auf „nur lokale Modelle“ gestellt.
- Next.js-Telemetrie und alle Nachlade-Mechanismen sind abgeschaltet.
- Kein automatisches Update. Updates werden manuell installiert; eine Update-Prüfung gibt es höchstens als ausdrücklich einzuschaltende Option.
- Interne Dienste binden nur an `127.0.0.1` und verlangen ein pro Start erzeugtes Token.
- Ein automatischer Test fährt einen kompletten Durchlauf und schlägt fehl, sobald eine einzige ausgehende Verbindung versucht wird.

**Stand der Umsetzung (21.11.2026):**

- Fenster: Namensauflösung ist für alles außer localhost abgeschaltet, jede Anfrage an einen anderen Rechner wird abgebrochen und protokolliert, Hintergrunddienste von Chromium und die Rechtschreibprüfung sind aus (`desktop/network/lockdown.js`).
- Server-Prozess: Eine Sperre verweigert jede Verbindung, die nicht auf dem eigenen Rechner bleibt (`desktop/network/guard.js`). Sie wird über eine eigene Startdatei geladen, weil Electron das Laden per `--require` im Hilfsprozess ignoriert.
- Sicherheitsrichtlinie der Seiten nennt im Desktop-Build keinen fremden Host mehr.
- Selbsttest der paketierten App (`--smoke`): DOCX umwandeln, PDF öffnen, Analyse mit dem mitgelieferten Modell abwarten. Er schlägt fehl, wenn ein Fenster oder der Server eine Verbindung nach außen versucht hat, wenn die Server-Sperre nicht geladen ist oder wenn ein Kontrollversuch nicht abgefangen wurde.

Noch offen: der spätere LLM-Dienst (`llama-server`) ist ein eigenes Programm und braucht eine eigene Absicherung; Verbindungen, die Chromium an Sperre und Namensauflösung vorbei direkt an eine IP-Adresse richten würde, sind nicht durch eine Messung auf Netzwerkebene ausgeschlossen.

## 4. Wasserdichte Schwärzung

EasyRedact entfernt Text bereits über MuPDF aus dem PDF. LocalRedact ergänzt eine Absicherung beim Export:

1. **Schwärzen:** Text, Bildbereiche und Vektorgrafik unter jeder Schwärzung werden entfernt, nicht überdeckt.
2. **Bereinigen:** Metadaten (Info und XMP), Anhänge, Kommentare, Formularfelder, Lesezeichen, JavaScript und versteckte Ebenen werden entfernt bzw. geprüft. Gespeichert wird als komplett neu geschriebene Datei, nie als angehängte Änderung.
3. **Prüfen:** Die exportierte Datei wird erneut geöffnet. Die App extrahiert den gesamten Text und prüft, dass kein geschwärzter Begriff mehr vorkommt und unter keiner Schwärzungsfläche noch Text liegt.
4. **Bericht:** Der Nutzer sieht das Prüfergebnis. Bei einem Fund wird der Export als nicht sicher markiert.
5. **Maximalmodus (optional):** Export als reine Bilddatei-Seiten ohne Textebene, für Fälle mit höchstem Schutzbedarf.

Dazu kommt ein Testkorpus mit bekannten Problemfällen (Text in Bildern, Ligaturen, Silbentrennung über Zeilen, gedrehte Seiten, Formularfelder, versteckte Ebenen), der bei jedem Build durchläuft.

**Stand der Umsetzung (23.11.2026):** Schritte 1 bis 4 sind umgesetzt (`src/lib/pdf-export.ts`, Tests in `tests/pdf-export.test.mjs`).

- Die Analyse des bisherigen Exports zeigte: Ein geschwärzter Name blieb in einem Lesezeichen stehen; Anhänge, Skripte und Links überlebten immer; ohne ausgewählte Metadatenfelder blieben auch Autor, eingebettete Metadaten, gelöschte Kommentare und verwaiste alte Seiteninhalte in der Datei.
- Der Export entfernt jetzt zusätzlich zu den geschwärzten Flächen: Dokumenteigenschaften, eingebettete Metadaten, Anhänge, alle Lesezeichen, Kommentare, Skripte, Seitenvorschauen, private Programmdaten, die Strukturdaten für Barrierefreiheit sowie Links, die auf einer Schwärzung liegen oder ein Wort des geschwärzten Texts enthalten. Formularfelder werden vor dem Schwärzen in die Seite gezeichnet. Gespeichert wird immer als neu geschriebene Datei.
- Die Nachprüfung öffnet die Datei erneut und meldet: Text unter einer Schwärzung, geschwärzten Text in den Daten der Datei, verbliebene Anhänge, Skripte, Lesezeichen, Metadaten, Vorschauen, Formularfelder, Kommentare und frühere Fassungen. Geschwärzter Text, der an nicht markierter Stelle noch lesbar steht, wird als Hinweis gezeigt.
- Unsichtbarer Text (weiß auf weiß, unsichtbarer Darstellungsmodus, kleiner als 2 Punkt) wird beim Öffnen erkannt und als Schwärzungsvorschlag markiert.
- Nebenbei behoben: PDFs mit Notiz-Kommentaren ließen sich nicht öffnen, und beim Entfernen von Kommentaren blieb jeder zweite stehen.

Noch offen:

- Maximalmodus (Export als reine Bildseiten).
- Ausgeblendete Ebenen werden weder erkannt noch entfernt.
- Formularfelder: Das Einzeichnen ist nicht mit einem echten Formular getestet.
- Lesezeichen und Strukturdaten werden vollständig entfernt, auch wenn sie nichts Geschwärztes enthalten; das kostet Navigation und Barrierefreiheit.
- Text, der hinter einem Bild liegt, gilt als sichtbar und wird nicht als unsichtbar erkannt.
- Der Testkorpus ist ein selbst erzeugtes Dokument; Ligaturen, Silbentrennung über Zeilen, gedrehte Seiten und Dateien echter Programme fehlen.

Hinweis für die Oberfläche: Gescannte PDFs ohne Textebene kann die automatische Erkennung in Version 1 nicht lesen. Die App erkennt solche Seiten und weist darauf hin; manuelles Schwärzen funktioniert dort trotzdem.

## 5. DOCX

EasyRedact wandelt DOCX per LibreOffice in PDF um, was nur im Docker-Container funktioniert. Für die Desktop-App gibt es zwei Wege, die sich ergänzen:

| Weg | Vorteil | Nachteil |
|---|---|---|
| Eingebauter Konverter (DOCX → HTML → PDF über Chromium) | funktioniert immer, keine Zusatzinstallation | Layout weicht vom Original ab (Seitenumbrüche, Kopf- und Fußzeilen) |
| Installiertes LibreOffice, automatisch erkannt | originalgetreues Layout | muss auf dem Rechner vorhanden sein |

**Vorschlag:** Der eingebaute Konverter ist die Grundlage; ist LibreOffice installiert, wird es bevorzugt. LibreOffice mitzuliefern würde den Installer um mehrere hundert Megabyte vergrößern und die Signierung auf macOS deutlich erschweren, deshalb nicht in Version 1.

Welche Bibliothek der eingebaute Konverter nutzt und ob die Layouttreue reicht, klärt ein Versuch in Phase 0 mit echten Beispieldokumenten.

**DOCX-spezifische Risiken**, die der Konverter abfangen muss:

- Änderungsverfolgung: gelöschter Text darf nicht im PDF landen.
- Kommentare, ausgeblendeter Text, Fuß- und Endnoten, Textfelder.
- Dokumenteigenschaften (Autor, Firma, Vorlage).
- Eingebettete Objekte und Bilder.

Die App zeigt beim Import an, wenn ein Dokument Änderungsverfolgung oder Kommentare enthält, und was damit geschieht.

**Ergebnis des Versuchs (21.11.2026)** mit einem selbst erzeugten Testdokument (`desktop/spikes/docx`). Geprüft wurde, was im Text des erzeugten PDFs steht:

| Inhalt im DOCX | LibreOffice | mammoth + Chromium | docx-preview + Chromium |
|---|---|---|---|
| Fließtext, Tabelle, Textfeld, Fußnote | ja | ja | ja |
| Kopf- und Fußzeile | ja, auf jeder Seite | **fehlen** | ja, aber nur einmal je Abschnitt |
| Nachverfolgung: gelöschter Text | **ja, durchgestrichen sichtbar** | nein | nein |
| Ausgeblendeter Text | nein | **ja, wird sichtbar** | nein |
| Kommentar | nein | nein | nein |
| Weißer Text auf weißem Grund | ja, unsichtbar | ja, sichtbar (schwarz) | ja, unsichtbar |
| Autor in den PDF-Metadaten | **ja** | nein | nein |
| Layout | Referenz | geht verloren | nah an der Referenz, Zeilen- und Seitenumbrüche weichen ab |

Entscheidung: Der eingebaute Konverter nutzt **docx-preview** (Apache-2.0). mammoth (BSD-2-Clause) scheidet aus, weil Kopf- und Fußzeilen fehlen und ausgeblendeter Text sichtbar wird. LibreOffice bleibt die bevorzugte Wahl, wenn installiert, braucht aber dieselbe Vorbehandlung wie der eingebaute Weg.

Daraus folgen drei Aufgaben für Phase 2 und 3:

- **Vorbehandlung des DOCX vor jeder Umwandlung:** Änderungen annehmen (gelöschten Text entfernen), Kommentare und ausgeblendeten Text entfernen, Dokumenteigenschaften leeren. So verhalten sich beide Wege gleich.
- **Unsichtbarer Text:** Weißer Text bleibt bei LibreOffice und docx-preview unsichtbar im PDF. Der abgesicherte Export muss Text erkennen, der dieselbe Farbe wie der Hintergrund hat oder winzig ist, und ihn anzeigen oder entfernen.
- **Kopf- und Fußzeilen bei docx-preview** auf jeder gedruckten Seite wiederholen.

Offen: Layouttreue bei echten Dokumenten (Formatvorlagen, Bilder, mehrspaltiger Satz). Das Testdokument enthält nur einfache Formatierung.

**Stand der Umsetzung (21.11.2026):** Bereinigung (`desktop/docx/sanitize.js`) und Umwandlung (`desktop/docx/convert.js`) sind eingebaut und in der paketierten macOS-App getestet. LibreOffice wird verwendet, wenn es installiert ist, sonst der eingebaute Weg. Kopf- und Fußzeile stehen beim eingebauten Weg auf jeder Seite. Noch offen:

- Hinweis in der Oberfläche, was beim Import entfernt wurde (die Zahlen liefert der Konverter bereits mit).
- Der eingebaute Weg nutzt für das ganze Dokument Kopf- und Fußzeile des ersten Abschnitts; abweichende erste Seiten oder Abschnitte werden nicht unterschieden.
- Im Testdokument erschien eine Fußnote beim eingebauten Weg doppelt; mit echten Dokumenten prüfen.
- Schriften, die auf dem Rechner fehlen, werden ersetzt, wodurch sich Umbrüche verschieben.
- Erkennung von unsichtbarem Text (Phase 3).

## 6. Phasen

### Phase 0 – Fork und Machbarkeit

- Repo anlegen, EasyRedact als `upstream` einbinden, lokal zum Laufen bringen.
- Versuch 1: Next.js-Server im Electron-Hilfsprozess, gebaut für alle drei Systeme.
- Versuch 2: DOCX-Konverter mit 10 bis 20 echten Dokumenten.
- Versuch 3: `llama-server` mit zwei bis drei Modellkandidaten; Prüfung, ob die Werkzeugaufrufe des Assistenten (`suggest_redactions`, `ask_user`, `read_documents`) zuverlässig funktionieren.
- Lizenzprüfung aller mitgelieferten Teile (NER-Modell, llama.cpp, Schriften).

**Fertig, wenn:** die unveränderte Oberfläche als Electron-App auf macOS, Windows und Linux startet und für DOCX und LLM je eine belegte Entscheidung vorliegt.

### Phase 1 – Offline-Grundgerüst

- Cloud-KI, About-Seite und Onboarding-Texte zur Cloud entfernen; Branding auf LocalRedact.
- NER-Modell, ONNX-Runtime und IFG-Regeln einpacken.
- Netzwerk-Abschottung und der zugehörige Test.
- spaCy-Pfad entfernen (ersetzt durch das eingebaute NER-Modell).
- Electron-Härtung: Sandbox, Kontextisolation, keine Node-Integration im Fenster.

**Fertig, wenn:** PDF öffnen, Stufe-1-Erkennung, manuelles Schwärzen und Export bei gezogenem Netzwerkkabel funktionieren und der Netzwerk-Test grün ist.

### Phase 2 – DOCX

- Konverter nach Ergebnis aus Phase 0, LibreOffice-Erkennung je Betriebssystem.
- Behandlung von Änderungsverfolgung, Kommentaren und ausgeblendetem Text.
- Hinweise beim Import.

**Fertig, wenn:** die Beispieldokumente aus Phase 0 korrekt umgewandelt werden und kein gelöschter oder versteckter Text im PDF auftaucht.

### Phase 3 – Abgesicherter Export

- Bereinigung, Nachprüfung und Prüfbericht aus Abschnitt 4.
- Maximalmodus.
- Testkorpus mit Problemfällen im Build.

**Fertig, wenn:** der Testkorpus ohne Fund durchläuft und ein absichtlich fehlerhafter Export zuverlässig erkannt wird.

### Phase 4 – Lokaler KI-Assistent

- `llama-server` je Plattform mitliefern, Start und Stopp durch die App.
- Modellverwaltung: Import aus Datei, Prüfsumme, Anzeige von Speicherbedarf, Warnung bei zu wenig Arbeitsspeicher.
- Chat-Route auf den lokalen Dienst umstellen; Prompts und Wiederholungslogik an das gewählte Modell anpassen.
- Optional: bereits vorhandenes Ollama auf demselben Rechner nutzen.
- Dokumenttext vorab mitgeben (`PRELOAD_DOCUMENT`) und Kontextgröße fest auf 16.384 Token setzen; beides war im Versuch Voraussetzung für brauchbare Ergebnisse.
- Versuch: Stufe 1 liefert Muster-Treffer (IBAN, Telefon, E-Mail, Datum) vorab, der Assistent entscheidet nur noch über Rollen und Rechtsgründe. Ziel ist, den Denkmodus abschalten zu können (halbe Laufzeit), ohne dass harte Daten übersehen werden.
- Fortschrittsanzeige und seitenweises Arbeiten, weil ein Lauf über zwei Seiten 1,5 bis 4,5 Minuten dauert.

**Fertig, wenn:** der Assistent offline ein mehrseitiges Dokument liest und Schwärzungen mit Begründung vorschlägt, auf einem Rechner mit 16 GB Arbeitsspeicher.

### Phase 5 – Desktop-Integration und Auslieferung

- Native Dateidialoge, Ziehen und Ablegen, „Öffnen mit“, zuletzt geöffnete Dateien.
- Einstellungen: Sprache, Aufbewahrungsdauer, „alle Daten löschen“.
- Installer: dmg (macOS), NSIS (Windows), AppImage und deb (Linux); Build über GitHub Actions.
- Signierung: Apple Developer ID mit Notarisierung, Code-Signing-Zertifikat für Windows.
- Quellcode-Hinweis und Lizenzübersicht in der App (AGPL-Pflicht).

**Fertig, wenn:** signierte Installer für alle Zielsysteme aus einem getaggten Release entstehen und auf frischen Rechnern ohne Warnung installierbar sind.

### Phase 6 – Später

- OCR für gescannte PDFs (lokal, mit eingepackten Sprachdaten).
- Verschlüsselte Ablage der Sitzungsdaten.
- LibreOffice als optionales Zusatzpaket.
- Stapelverarbeitung ganzer Ordner.

## 7. Risiken

| Risiko | Auswirkung | Gegenmaßnahme |
|---|---|---|
| Kleine lokale Modelle rufen die Werkzeuge des Assistenten unzuverlässig auf | Assistent schlägt nichts oder Falsches vor | Versuch in Phase 0; Stufe 1 funktioniert unabhängig davon |
| Eingebauter DOCX-Konverter weicht stark vom Original ab | Seitenzahlen stimmen nicht mit dem Original überein | Versuch in Phase 0; LibreOffice wird bevorzugt, wenn vorhanden |
| NER übersieht Namen | unvollständige Schwärzung | Nutzer prüft immer; Suche nach weiteren Vorkommen eines Begriffs; LLM als zweite Stufe |
| Gescannte PDFs | automatische Erkennung findet nichts | deutlicher Hinweis in Version 1, OCR in Phase 6 |
| Upstream entwickelt sich weiter | Zusammenführen wird aufwendig | Desktop-Code getrennt halten, regelmäßig zusammenführen |
| Installergröße (Electron, NER-Modell, llama.cpp) | langer Download | LLM-Modell nicht einpacken; Größe in Phase 0 messen |

## 8. Offene Entscheidungen

1. **Repo:** echter GitHub-Fork (zwingend öffentlich, sichtbar mit EasyRedact verknüpft) oder eigenes Repo mit `upstream`-Remote.
2. **LLM-Modell:** entschieden am 20.11.2026 – Gemma 4 (8 Mrd. Parameter, Apache-2.0) ist das Referenzmodell. Im Versuch (`desktop/spikes/llm-eval.mjs`) lieferte es mit vorab mitgegebenem Dokumenttext (`PRELOAD_DOCUMENT=true`) in 4 von 4 Läufen Vorschläge mit 11 bis 12 von 12 Treffern, bei 3,3 GB geladenem Speicher und 16.384 Token Kontext. Mistral Nemo (kein Werkzeugaufruf) und Qwen 3.5 4B (nur 2 von 4 Läufen) sind ausgeschieden. Offen: Tempo (2,5 bis 3,5 Minuten für zwei Seiten) und ein Test mit echten, längeren Dokumenten.
3. **Sitzungsdaten:** EasyRedact speichert Dokumente bis zu sechs Monate lokal. Für LocalRedact steht zur Wahl: beibehalten, kürzen oder standardmäßig gar nicht speichern.
4. **Sprachen:** alle sieben Sprachen von EasyRedact behalten oder zunächst nur Deutsch und Englisch pflegen.
5. **Signierung:** Apple-Developer-Konto und Windows-Zertifikat müssen vor Phase 5 vorhanden sein.

## 9. Lizenzprüfung (Stand 20.11.2026)

Technische Bestandsaufnahme, keine Rechtsberatung.

| Bestandteil | Lizenz | Bewertung |
|---|---|---|
| EasyRedact (Ausgangscode) | AGPL-3.0 | Fork muss AGPL-3.0 bleiben |
| MuPDF | AGPL-3.0-or-later | Grund für die AGPL; ohne Kauflizenz von Artifex kein geschlossener Vertrieb |
| Übrige npm-Pakete (905 geprüft) | MIT, ISC, Apache-2.0, BSD | unkritisch |
| sharp/libvips | LGPL-3.0-or-later | verträglich; wird nur für Bildoptimierung gebraucht und kann entfallen |
| Electron mit Chromium und ffmpeg | MIT, BSD, LGPL | unkritisch; Lizenztexte liegen dem Paket bei und müssen im Installer bleiben |
| llama.cpp | MIT | unkritisch |
| Gemma 4 | Apache-2.0 | unkritisch; wird nicht mitgeliefert, sondern importiert |
| Schrift Inter | OFL-1.1 | unkritisch; Lizenzhinweis beilegen |
| IFG-Regeln (redaction-rules) | CC0-1.0 | unkritisch |
| NER-Modell `Xenova/bert-base-multilingual-cased-ner-hrl` | keine Angabe; Ausgangsmodell von Davlan: AFL-3.0 | **ungeklärt**, siehe unten |
| Logos BMZ DataLab und NextGenerationEU | nicht von der Code-Lizenz gedeckt | aus der App entfernen, Herkunft nur als Text nennen |
| Compliance-Dokumente (`docs/compliance`) | beschreiben EasyRedact | gelten nicht für LocalRedact; entfernen oder neu erstellen |

**Offener Punkt NER-Modell:** Die verwendete Fassung trägt keine Lizenzangabe, das Ausgangsmodell steht unter AFL-3.0. Die FSF stuft die AFL als nicht GPL-verträglich ein; ob ein mitgeliefertes Modell als Daten davon betroffen ist, ist rechtlich nicht geklärt. EasyRedact lädt das Modell zur Laufzeit nach, LocalRedact würde es selbst weiterverbreiten. Vor Phase 1 entweder rechtlich klären oder ein NER-Modell mit eindeutiger, freizügiger Lizenz wählen. Die Lizenzen der Trainingsdaten sind nicht geprüft.

**Vergleich möglicher Ersatzmodelle (21.11.2026)**, gemessen am Beispieldokument aus `desktop/spikes/sample-document.json` mit 12 erwarteten Stellen, ohne die Muster-Erkennung von Stufe 1:

| Modell | Lizenz | Größe | Vollständig erkannt | Dauer für 2 Seiten |
|---|---|---|---|---|
| Bisher: Xenova/bert-base-multilingual-cased-ner-hrl (q8) | ungeklärt | 178 MB | 2 von 12 | 0,07 s |
| OpenAI Privacy Filter (q4) | Apache-2.0 | 907 MB | 9 von 12 | 0,7 s |
| GLiNER Multi PII (int8) | Apache-2.0 (Basismodell) | 349 MB | 0 von 12 | 0,3 s |

Privacy Filter übersah zwei Straßenadressen und schnitt die IBAN um zwei Ziffern ab; es belegte im Test 2,6 GB Arbeitsspeicher. Die int8-Fassung von GLiNER lieferte nur sehr niedrige Trefferwerte; größere Fassungen (580 MB und mehr) sind nicht getestet. Ein Dokument und ein Lauf je Modell sind keine belastbare Quote.

**Pflichten aus der AGPL für LocalRedact:**

- Lizenztext und Herkunftshinweis auf EasyRedact beibehalten; geänderte Dateien als geändert kennzeichnen.
- Jedem Empfänger der App den vollständigen Quellcode anbieten (Link in der App und im Installer).
- Verkauf ist erlaubt; Käufer dürfen die App aber weitergeben und verändern.

**Noch zu prüfen:** die Bibliothek für den DOCX-Konverter, sobald sie gewählt ist.

**App-Symbol:** Das Schloss ist das Symbol „lock-keyhole“ aus Lucide (ISC-Lizenz, Lizenztext in `desktop/icons/LICENSE-lucide.txt`). Eine zuerst vorgesehene Vorlage von Magnific wurde verworfen, weil deren Lizenz die Nutzung als Logo und die Weitergabe der Datei verbietet.
