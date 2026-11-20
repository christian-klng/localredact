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

## 4. Wasserdichte Schwärzung

EasyRedact entfernt Text bereits über MuPDF aus dem PDF. LocalRedact ergänzt eine Absicherung beim Export:

1. **Schwärzen:** Text, Bildbereiche und Vektorgrafik unter jeder Schwärzung werden entfernt, nicht überdeckt.
2. **Bereinigen:** Metadaten (Info und XMP), Anhänge, Kommentare, Formularfelder, Lesezeichen, JavaScript und versteckte Ebenen werden entfernt bzw. geprüft. Gespeichert wird als komplett neu geschriebene Datei, nie als angehängte Änderung.
3. **Prüfen:** Die exportierte Datei wird erneut geöffnet. Die App extrahiert den gesamten Text und prüft, dass kein geschwärzter Begriff mehr vorkommt und unter keiner Schwärzungsfläche noch Text liegt.
4. **Bericht:** Der Nutzer sieht das Prüfergebnis. Bei einem Fund wird der Export als nicht sicher markiert.
5. **Maximalmodus (optional):** Export als reine Bilddatei-Seiten ohne Textebene, für Fälle mit höchstem Schutzbedarf.

Dazu kommt ein Testkorpus mit bekannten Problemfällen (Text in Bildern, Ligaturen, Silbentrennung über Zeilen, gedrehte Seiten, Formularfelder, versteckte Ebenen), der bei jedem Build durchläuft.

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
