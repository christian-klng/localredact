# Technische Systemdokumentation – LocalRedact

> **Platzhalter.** Dieses Dokument ist noch nicht erstellt und darf nicht für eine Freigabe verwendet werden.

**Stand:** 20.11.2026

## Zweck

Beschreibt Aufbau, Bestandteile, Datenflüsse und Schnittstellen der App.

## Was für LocalRedact bereits feststeht

- Desktop-App auf Basis von Electron für macOS, Windows und Linux.
- PDF-Verarbeitung mit MuPDF innerhalb der App.
- Keine Cloud-KI; die App baut von sich aus keine Verbindung ins Internet auf (geplant, siehe PLAN.md Abschnitt 3).

## Noch offen

- Endgültige Liste der mitgelieferten Bestandteile und Versionen.
- NER-Modell (Ersatz für das bisherige Modell steht aus).
- Art der DOCX-Umwandlung.
- Speicherort und Aufbewahrung der Sitzungsdaten.

## Vorlage

Das entsprechende Dokument von EasyRedact kann als Gliederung dienen: [01_systemdokumentation.md](https://github.com/datenlabor-bmz/easy-redact/blob/main/docs/compliance/01_systemdokumentation.md). Es beschreibt eine Webanwendung mit Cloud-KI und Serverbetrieb und gilt inhaltlich nicht für LocalRedact.
