# Betriebskonzept – LocalRedact

> **Platzhalter.** Dieses Dokument ist noch nicht erstellt und darf nicht für eine Freigabe verwendet werden.

**Stand:** 20.11.2026

## Zweck

Beschreibt Installation, Einrichtung, Aktualisierung und Deinstallation.

## Was für LocalRedact bereits feststeht

- Auslieferung als Installer je Betriebssystem statt als Docker-Container.
- Das Sprachmodell wird als Datei importiert, auch auf Rechnern ohne Netz.

## Noch offen

- Verteilung in verwalteten Umgebungen (Softwareverteilung, stille Installation).
- Update-Verfahren ohne Internetverbindung.
- Systemanforderungen; bisher nur ein Messwert: Gemma 4 lief auf einem Rechner mit 16 GB Arbeitsspeicher.

## Vorlage

Das entsprechende Dokument von EasyRedact kann als Gliederung dienen: [07_betriebskonzept.md](https://github.com/datenlabor-bmz/easy-redact/blob/main/docs/compliance/07_betriebskonzept.md). Es beschreibt eine Webanwendung mit Cloud-KI und Serverbetrieb und gilt inhaltlich nicht für LocalRedact.
