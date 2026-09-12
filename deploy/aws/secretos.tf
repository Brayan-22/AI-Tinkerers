# ---------------------------------------------------------------------------
# Llaves. Parameter Store (SecureString) en vez de Secrets Manager: el nivel
# estándar es gratis y ECS lo inyecta igual como variable de entorno.
#
# La URL es pública, así que CONTROL_TOKEN no puede faltar: sin él cualquiera
# aprueba una compra ajena. Si el .env no trae uno, se genera acá.
# ---------------------------------------------------------------------------

resource "random_password" "control" {
  length  = 32
  special = false
}

resource "random_password" "approval" {
  length  = 48
  special = false
}

locals {
  secretos = merge(
    {
      CONTROL_TOKEN   = random_password.control.result
      APPROVAL_SECRET = random_password.approval.result
    },
    { for k, v in var.llaves : k => v if trimspace(v) != "" },
  )

  # Los nombres no son secretos, los valores sí. for_each no acepta un conjunto
  # marcado como sensible, y los nombres heredan la marca al filtrar por valor.
  nombres_secretos = nonsensitive(toset(keys(local.secretos)))
}

resource "aws_ssm_parameter" "llave" {
  for_each = local.nombres_secretos

  name  = "/${var.project}/${each.value}"
  type  = "SecureString"
  tier  = "Standard"
  value = local.secretos[each.value]
}
