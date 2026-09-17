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
for VAR in DEEPINFRA_API_KEY OPENROUTER_API_KEY SLACK_APP_TOKEN SLACK_BOT_TOKEN \
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
# WALLETS_JSON aparte: es un array JSON y trae comillas dobles a propósito.
# El filtro de arriba las borra a todas (`tr -d '"'`) y deja el JSON roto, así
# que esta sí se copia tal cual, con el \r fuera pero las comillas intactas.
WALLETS_VALOR="$(grep -E '^WALLETS_JSON=' .env | head -1 | cut -d= -f2- | tr -d '\r')"
if [ -n "$WALLETS_VALOR" ]; then
  g secrets describe wallets-json >/dev/null 2>&1 || g secrets create wallets-json --replication-policy=automatic
  printf '%s' "$WALLETS_VALOR" | g secrets versions add wallets-json --data-file=- >/dev/null
  SECRETOS+=("WALLETS_JSON=wallets-json:latest")
  echo "   ✓ WALLETS_JSON"
fi

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
# Estas cuatro se leen del .env (como todo lo demás), con la variable de
# entorno como override para quien prefiera exportarla en la terminal.
# PUBLIC_URL en particular: si ya la pusiste (tu dominio detrás de Cloudflare),
# se respeta desde el primer despliegue. Si no, no se conoce hasta que Cloud
# Run asigna el *.run.app, así que se fija en una segunda pasada. Así el
# script sirve tanto para el primer despliegue como para el redespliegue
# final, sin pisar lo que ya pusiste.
desde_env() { grep -E "^${1}=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"' \r'; }
MARKET_PLACE="${MARKET_PLACE:-$(desde_env MARKET_PLACE)}"
MAIL_FROM="${MAIL_FROM:-$(desde_env MAIL_FROM)}"
CATALOGO_DEMO="${CATALOGO_DEMO:-$(desde_env CATALOGO_DEMO)}"
PUBLIC_URL_ENV="${PUBLIC_URL:-$(desde_env PUBLIC_URL)}"

echo "▸ desplegando"
g run deploy "$SERVICIO" --region "$REGION" --image "$IMAGEN" \
  --allow-unauthenticated --port 3000 --timeout 3600 \
  --min-instances 1 --max-instances 1 --no-cpu-throttling \
  --memory 512Mi \
  --set-env-vars "DB_PATH=/tmp/mercadia.db,MARKET_PLACE=${MARKET_PLACE:-Colombia},MAIL_FROM=${MAIL_FROM:-onboarding@resend.dev},CATALOGO_DEMO=${CATALOGO_DEMO}${PUBLIC_URL_ENV:+,PUBLIC_URL=$PUBLIC_URL_ENV}" \
  ${SECRETOS:+--set-secrets "$(IFS=,; echo "${SECRETOS[*]}")"}

URL="$(g run services describe "$SERVICIO" --region "$REGION" --format='value(status.url)')"
if [ -z "$PUBLIC_URL_ENV" ]; then
  echo "▸ fijando PUBLIC_URL=$URL (pon PUBLIC_URL en .env cuando tengas el dominio final y vuelve a correr)"
  g run services update "$SERVICIO" --region "$REGION" --update-env-vars "PUBLIC_URL=$URL" >/dev/null
else
  echo "▸ PUBLIC_URL=$PUBLIC_URL_ENV (de tu .env, no se pisa)"
fi

echo
echo "  listo → $URL"
echo "  salud → $URL/api/health"
echo "  operar → $URL/arena?t=\$CONTROL_TOKEN  (el de tu .env)"
echo
echo "  La base en /tmp es efímera: el catálogo se siembra al arrancar, pero el"
echo "  historial de precios del canal empieza de cero en cada reinicio. Para que"
echo "  persista, monta un bucket con Cloud Storage FUSE o mueve el store a Postgres."
