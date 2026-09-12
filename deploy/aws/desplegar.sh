#!/usr/bin/env bash
# Mercadia en AWS: ECS Fargate detrás de un ALB, SQLite en EFS, llaves en
# Parameter Store y mercadia.bacode.online en la zona de Route53 que ya existe.
#
#   aws login
#   ./deploy/aws/desplegar.sh        # imagen + infraestructura + servicio
#
# Cada despliegue es ese mismo comando. Es idempotente.
#
# Las llaves salen del .env de la raíz y viajan a Terraform en TF_VAR_llaves,
# sin escribirse en disco. Quedan en terraform.tfstate, que es local y está en
# .gitignore: no lo subas.
set -euo pipefail

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
tf() { terraform -chdir="$AQUI" "$@"; }

for BIN in aws terraform docker node; do
  command -v "$BIN" >/dev/null || { echo "falta $BIN en el PATH"; exit 1; }
done

# ── Credenciales ─────────────────────────────────────────────────────────────
# `aws login` deja una login_session que el SDK de Terraform no lee. Se
# traducen a variables de entorno. Las AWS_* viejas se borran primero, o la CLI
# se "refresca" con ellas mismas caducadas.
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_CREDENTIAL_EXPIRATION AWS_SECURITY_TOKEN
eval "$(aws configure export-credentials --format env)" || {
  echo "no hay sesión de AWS válida — corre: aws login"; exit 1;
}
export AWS_REGION="${AWS_REGION:-us-east-1}"
echo "▸ cuenta $(aws sts get-caller-identity --query Account --output text) · $AWS_REGION"

tf init -input=false >/dev/null

# ── Llaves desde el .env ─────────────────────────────────────────────────────
[ -f "$RAIZ/.env" ] || echo "   ! no hay .env: todo sale apagado salvo la compra desde la web"
if [ ! -f "$RAIZ/wallets.json" ]; then
  echo "▸ no hay wallets.json: generando las llaves de la casa"
  (cd "$RAIZ" && npm run --silent wallets)
fi

SECRETAS="DEEPINFRA_API_KEY OPENROUTER_API_KEY SLACK_APP_TOKEN SLACK_BOT_TOKEN TELEGRAM_BOT_TOKEN EXA_API_KEY AMBIGUOUS_API_KEY MAIL_API_KEY APPROVAL_SECRET CONTROL_TOKEN"
PLANAS="MARKET_PLACE MAIL_FROM BASE_SEPOLIA_RPC DEPOSITS_FROM_BLOCK AMBIGUOUS_MCP_URL APPROVAL_TTL_MS DEEPINFRA_MODEL LLM_MODEL"

eval "$(RAIZ="$RAIZ" SECRETAS="$SECRETAS" PLANAS="$PLANAS" node -e '
  const fs = require("fs");
  const env = {};
  try { Object.assign(env, require("util").parseEnv(fs.readFileSync(process.env.RAIZ + "/.env", "utf8"))); } catch {}
  const pick = (names) => Object.fromEntries(names.split(" ").filter((k) => env[k]).map((k) => [k, env[k]]));
  const llaves = pick(process.env.SECRETAS);
  // El CLI de Ambiguous deja la llave en .ambi/config.json, que no entra a la imagen.
  try { llaves.AMBIGUOUS_API_KEY ??= JSON.parse(fs.readFileSync(process.env.RAIZ + "/.ambi/config.json", "utf8")).authToken || undefined; } catch {}
  if (!llaves.AMBIGUOUS_API_KEY) delete llaves.AMBIGUOUS_API_KEY;
  // WALLETS_JSON del .env gana sobre wallets.json: así el equipo comparte las mismas llaves.
  if (env.WALLETS_JSON) llaves.WALLETS_JSON = env.WALLETS_JSON;
  else try { llaves.WALLETS_JSON = fs.readFileSync(process.env.RAIZ + "/wallets.json", "utf8"); } catch {}
  const q = (s) => "\x27" + s.replaceAll("\x27", "\x27\\\x27\x27") + "\x27";
  console.log("export TF_VAR_llaves=" + q(JSON.stringify(llaves)));
  console.log("export TF_VAR_entorno=" + q(JSON.stringify(pick(process.env.PLANAS))));
  console.error("   llaves: " + (Object.keys(llaves).join(" ") || "ninguna"));
')"

# ── Imagen ───────────────────────────────────────────────────────────────────
echo "▸ registro de imágenes"
tf apply -input=false -auto-approve -target=aws_ecr_repository.app >/dev/null
REPO="$(tf output -raw ecr_repository_url)"
TAG="$(git -C "$RAIZ" rev-parse --short HEAD 2>/dev/null || echo manual)-$(date +%Y%m%d%H%M%S)"

echo "▸ construyendo $REPO:$TAG (incluye el build de Angular)"
aws ecr get-login-password | docker login --username AWS --password-stdin "${REPO%%/*}" >/dev/null
docker build --platform linux/amd64 -t "$REPO:$TAG" "$RAIZ"
docker push "$REPO:$TAG"

# ── Infraestructura y servicio ───────────────────────────────────────────────
echo "▸ terraform apply"
tf apply -input=false -auto-approve -var "image_tag=$TAG"

echo
echo "▸ esperando a que el servicio quede estable"
aws ecs wait services-stable --cluster mercadia --services mercadia || \
  echo "   ! no quedó estable: revisa los logs"

echo
echo "  listo  → $(tf output -raw url)"
echo "  salud  → $(tf output -raw url)/api/health"
echo "  operar → $(tf output -raw url)/arena?t=\$(terraform -chdir=deploy/aws output -raw control_token)"
echo "  logs   → $(tf output -raw logs)"
