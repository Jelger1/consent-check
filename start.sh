#!/usr/bin/env bash
# Dubbelklik dit bestand (macOS/Linux) om de tool te starten, of draai ./start.sh
# Het installeert de eerste keer zelf wat nodig is en opent daarna je browser.
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js is nog niet geïnstalleerd. Dat heeft de tool nodig."
  echo "  Download de LTS-versie op https://nodejs.org en probeer het opnieuw."
  echo
  exit 1
fi

node scripts/start.js
