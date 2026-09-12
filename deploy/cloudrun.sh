#!/usr/bin/env bash
# Mercadia en Cloud Run. Serverless en el sentido útil: no hay máquina que
# administrar y la imagen es la misma del compose.
#
# Lo que NO es: funciones por request. Mercadia mantiene abiertas dos
# conexiones largas (el socket de Slack y el long polling de Telegram) y
# espera minutos a que una persona conteste. Por eso las tres banderas de
# abajo no son opcionales.
set -euo pipefail

PROYECTO="${PROYECTO:?exporta PROYECTO=tu-proyecto-gcp}"
REGION="${REGION:-us-central1}"
SERVICIO="${SERVICIO:-mercadia}"

gcloud builds submit --project "$PROYECTO" --tag "gcr.io/$PROYECTO/$SERVICIO"

gcloud run deploy "$SERVICIO" \
  --project "$PROYECTO" --region "$REGION" \
  --image "gcr.io/$PROYECTO/$SERVICIO" \
  --allow-unauthenticated \
  --port 3000 \
  --timeout 3600 \
  --min-instances 1 \
  --max-instances 1 \
  --no-cpu-throttling \
  --set-env-vars "PUBLIC_URL=https://$SERVICIO-$(gcloud config get-value project 2>/dev/null | tr -d '\n')-$REGION.a.run.app,DB_PATH=/tmp/mercadia.db,MARKET_PLACE=Colombia" \
  --set-secrets "OPENAI_API_KEY_FILE=openai-key:latest,SLACK_APP_TOKEN_FILE=slack-app:latest,SLACK_BOT_TOKEN_FILE=slack-bot:latest,TELEGRAM_BOT_TOKEN_FILE=telegram-bot:latest,EXA_API_KEY_FILE=exa-key:latest"

# Por qué cada bandera:
#
#   --min-instances 1      el proceso tiene que existir aunque nadie entre, o
#                          el socket de Slack y el polling de Telegram no viven
#   --max-instances 1      SQLite tiene un solo escritor, y la cola de turnos,
#                          las aprobaciones abiertas y la arena viven en memoria.
#                          Con dos instancias, la mitad de los websockets le
#                          habla al proceso equivocado
#   --no-cpu-throttling    sin esto Cloud Run estrangula la CPU entre requests
#                          y el trabajo de fondo (polling, negociación) se muere
#   --timeout 3600         una compra con personas reales tarda minutos
#
# La base en /tmp es efímera: se pierde al reiniciar. No rompe la demo porque
# el catálogo se siembra al arrancar, pero el historial de precios del canal
# empieza de cero. Para que persista: monta un bucket con Cloud Storage FUSE
# (--add-volume type=cloud-storage) o mueve el store a Cloud SQL.
#
# Los secretos entran como ARCHIVO, no como variable: cualquier VAR del .env
# acepta VAR_FILE, así que Secret Manager funciona sin tocar una línea de
# código. Una variable se ve en `gcloud run services describe`; un archivo no.
