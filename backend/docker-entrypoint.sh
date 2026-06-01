#!/bin/sh
set -e

echo "Starting API (SQL crudo, sin Prisma)..."
echo "El esquema y el seed se aplican automaticamente al arrancar (DB_AUTO_INIT / DB_RUN_SEED)."

MAIN_JS=$(find dist -name 'main.js' | head -n 1)
if [ -z "$MAIN_JS" ]; then
  echo "ERROR: no se encontro main.js en dist/. Contenido de dist:"
  ls -R dist || true
  exit 1
fi

echo "Ejecutando: $MAIN_JS"
exec node "$MAIN_JS"
