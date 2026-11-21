# IT-Sicherheitskonzept – LocalRedact

> **Platzhalter.** Dieses Dokument ist noch nicht erstellt und darf nicht für eine Freigabe verwendet werden.

**Stand:** 20.11.2026

## Zweck

An BSI IT-Grundschutz angelehntes Konzept mit Schutzbedarf, Bedrohungen und Maßnahmen.

## Was für LocalRedact bereits feststeht

- Interne Dienste binden nur an 127.0.0.1 (umgesetzt für den internen Server).
- Fenster mit Sandbox und Kontextisolation (umgesetzt).
- Geplant: Blockade aller ausgehenden Verbindungen, signierte Installer, keine automatischen Updates.

## Noch offen

- Schutzbedarfsfeststellung und Bedrohungsanalyse für eine Desktop-App.
- Umgang mit Updates und Sicherheitslücken in Electron und MuPDF.
- Verschlüsselung der Sitzungsdaten.

## Vorlage

Das entsprechende Dokument von EasyRedact kann als Gliederung dienen: [06_sicherheitskonzept.md](https://github.com/datenlabor-bmz/easy-redact/blob/main/docs/compliance/06_sicherheitskonzept.md). Es beschreibt eine Webanwendung mit Cloud-KI und Serverbetrieb und gilt inhaltlich nicht für LocalRedact.
