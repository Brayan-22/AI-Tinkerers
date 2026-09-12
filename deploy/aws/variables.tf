variable "project" {
  description = "Prefijo de todos los nombres de recurso."
  type        = string
  default     = "mercadia"
}

variable "region" {
  description = "Región de todo el stack. us-east-1 es la más cercana a Bogotá con precio base."
  type        = string
  default     = "us-east-1"
}

variable "zonas" {
  description = "Zonas de disponibilidad. El ALB exige dos; us-east-1e no tiene Fargate."
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "domain_name" {
  description = "Dónde vive el mercado."
  type        = string
  default     = "mercadia.bacode.online"
}

variable "zona_padre" {
  description = "Zona de Route53, ya existente en la cuenta, donde se escriben los registros de domain_name."
  type        = string
  default     = "bacode.online"
}

variable "image_tag" {
  description = "Etiqueta de la imagen en ECR. desplegar.sh la fija con el commit."
  type        = string
  default     = "latest"
}

variable "cpu" {
  description = "Unidades de CPU de la tarea (1024 = 1 vCPU)."
  type        = number
  default     = 512
}

variable "memory" {
  description = "Memoria de la tarea en MiB."
  type        = number
  default     = 1024
}

variable "llaves" {
  description = <<-EOT
    Llaves del .env (DEEPINFRA_API_KEY, SLACK_BOT_TOKEN, …) y WALLETS_JSON con el
    contenido de wallets.json. Las vacías se omiten y esa pieza queda apagada.
    desplegar.sh la arma desde el .env en TF_VAR_llaves, sin tocar disco.
  EOT
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "entorno" {
  description = "Variables no secretas del .env (MARKET_PLACE, MAIL_FROM, BASE_SEPOLIA_RPC, …)."
  type        = map(string)
  default     = {}
}

variable "resend_dkim" {
  description = "Valor completo del TXT resend._domainkey que da Resend (empieza con p=). Es una llave pública. Vacío no crea el registro."
  type        = string
  default     = ""
}
