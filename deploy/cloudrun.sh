#!/usr/bin/env bash
# Mercadia en Cloud Run. Serverless de contenedor: no hay máquina que
# administrar y la imagen es la misma del compose.
#
# Es idempotente: se puede correr las veces que haga falta.
#
#   gcloud auth login
#   PROYECTO=tu-proyecto ./deploy/cloudrun.sh
#
# Requiere un .env con las llaves (cp .env.example .env) y facturación
# habilitada en el proyecto.
set -euo pipefail

PROYECTO="${PROYECTO:?exporta PROYECTO=tu-proyecto-gcp}"
REGION="${REGION:-us-central1}"
SERVICIO="${SERVICIO:-mercadia}"
IMAGEN="gcr.io/$PROYECTO/$SERVICIO"
g() { gcloud --project "$PROYECTO" --quiet "$@"; }

echo "▸ habilitando APIs"
g services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com \
  artifactregistry.googleapis.com containerregistry.googleapis.com

# ── Secretos ─────────────────────────────────────────────────────────────────
# Cada llave del .env que tenga valor se sube a Secret Manager. Las que estén
# vacías se omiten, y esa pieza simplemente queda apagada en producción.
echo "▸ secretos desde .env"
[ -f .env ] || { echo "falta .env — corre: cp .env.example .env"; exit 1; }
# La URL va a ser pública: sin token de operación cualquiera aprueba una compra
# que no es suya. Se genera uno si no está puesto.
if ! grep -qE "^CONTROL_TOKEN=.+" .env; then
  NUEVO="$(openssl rand -hex 16)"
  printf '\nCONTROL_TOKEN=%s\n' "$NUEVO" >> .env
  echo "   ! generé CONTROL_TOKEN y lo guardé en .env"
  echo "     la pantalla de operación entra por  <url>/arena?t=$NUEVO"
fi
SECRETOS=()
for VAR in OPENAI_API_KEY OPENROUTER_API_KEY SLACK_APP_TOKEN SLACK_BOT_TOKEN \
           TELEGRAM_BOT_TOKEN EXA_API_KEY AMBIGUOUS_API_KEY MAIL_API_KEY \
           APPROVAL_SECRET CONTROL_TOKEN; do
  VALOR="$(grep -E "^${VAR}=" .env | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')"
  [ -n "$VALOR" ] || continue
  NOMBRE="$(echo "$VAR" | tr 'A-Z_' 'a-z-')"
  g secrets describe "$NOMBRE" >/dev/null 2>&1 || g secrets create "$NOMBRE" --replication-policy=automatic
  printf '%s' "$VALOR" | g secrets versions add "$NOMBRE" --data-file=- >/dev/null
  SECRETOS+=("$VAR=$NOMBRE:latest")
  echo "   ✓ $VAR"
done

echo "▸ construyendo la imagen (incluye el build de Angular)"
g builds submit --tag "$IMAGEN"

# ── Despliegue ───────────────────────────────────────────────────────────────
# Por qué cada bandera:
#   --min-instances 1     el proceso tiene que existir aunque nadie entre, o el
#                         socket de Slack y el polling de Telegram no viven
#   --max-instances 1     SQLite tiene un solo escritor, y la cola de turnos,
#                         las aprobaciones abiertas y la arena viven en memoria
#   --no-cpu-throttling   sin esto Cloud Run estrangula la CPU entre requests y
#                         el trabajo de fondo se muere en silencio
#   --timeout 3600        una compra con personas reales tarda minutos
echo "▸ desplegando"
g run deploy "$SERVICIO" --region "$REGION" --image "$IMAGEN" \
  --allow-unauthenticated --port 3000 --timeout 3600 \
  --min-instances 1 --max-instances 1 --no-cpu-throttling \
  --memory 512Mi \
  --set-env-vars "DB_PATH=/tmp/mercadia.db,MARKET_PLACE=${MARKET_PLACE:-Colombia}" \
  ${SECRETOS:+--set-secrets "$(IFS=,; echo "${SECRETOS[*]}")"}

# La URL no se conoce hasta después del primer despliegue, así que los enlaces
# de autorización se configuran en una segunda pasada. Por eso este script se
# corre dos veces la primera vez, o simplemente se deja terminar.
URL="$(g run services describe "$SERVICIO" --region "$REGION" --format='value(status.url)')"
echo "▸ fijando PUBLIC_URL=$URL"
g run services update "$SERVICIO" --region "$REGION" --update-env-vars "PUBLIC_URL=$URL" >/dev/null

echo
echo "  listo → $URL"
echo "  salud → $URL/api/health"
echo "  operar → $URL/arena?t=\$CONTROL_TOKEN  (el de tu .env)"
echo
echo "  La base en /tmp es efímera: el catálogo se siembra al arrancar, pero el"
echo "  historial de precios del canal empieza de cero en cada reinicio. Para que"
echo "  persista, monta un bucket con Cloud Storage FUSE o mueve el store a Postgres."
