#!/bin/sh
set -e

echo "Starting API (SQL crudo, sin Prisma)..."
echo "El esquema y el seed se aplican automaticamente al arrancar (DB_AUTO_INIT / DB_RUN_SEED)."
exec node dist/src/main.js
