# ---------------------------------------------------------------------------
# DNS. bacode.online ya es una zona de Route53 en esta cuenta, así que no se
# crea ni se delega nada: los registros del subdominio se escriben ahí. Solo se
# agregan nombres bajo mercadia.; lo que ya tenga el dominio no se toca.
# ---------------------------------------------------------------------------

data "aws_route53_zone" "padre" {
  name         = var.zona_padre
  private_zone = false
}

resource "aws_acm_certificate" "web" {
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "validacion" {
  for_each = {
    for o in aws_acm_certificate.web.domain_validation_options :
    o.domain_name => {
      name   = o.resource_record_name
      record = o.resource_record_value
      type   = o.resource_record_type
    }
  }

  zone_id         = data.aws_route53_zone.padre.zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "web" {
  certificate_arn         = aws_acm_certificate.web.arn
  validation_record_fqdns = [for r in aws_route53_record.validacion : r.fqdn]
}

resource "aws_route53_record" "alias" {
  zone_id = data.aws_route53_zone.padre.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_lb.web.dns_name
    zone_id                = aws_lb.web.zone_id
    evaluate_target_health = true
  }
}

# ---------------------------------------------------------------------------
# Correo con Resend, para el dominio registrado allá como mercadia.bacode.online.
# Sin resend_dkim no se crea ninguno, para no dejar un correo a medio armar.
# ---------------------------------------------------------------------------

locals {
  # Route53 no acepta cadenas TXT de más de 255 caracteres: una llave DKIM
  # larga va partida en trozos, que el resolvedor vuelve a unir.
  dkim_trozos = var.resend_dkim == "" ? [] : [
    for i in range(0, length(var.resend_dkim), 255) : substr(var.resend_dkim, i, 255)
  ]
}

resource "aws_route53_record" "resend_dkim" {
  count = var.resend_dkim == "" ? 0 : 1

  zone_id = data.aws_route53_zone.padre.zone_id
  name    = "resend._domainkey.${var.domain_name}"
  type    = "TXT"
  ttl     = 300
  records = [join("\"\"", local.dkim_trozos)]
}

# SPF y rebotes: Resend los resuelve con dos CNAME hacia su propia
# infraestructura, en vez del MX y el TXT de antes.
resource "aws_route53_record" "resend_send" {
  count = var.resend_dkim == "" ? 0 : 1

  zone_id = data.aws_route53_zone.padre.zone_id
  name    = "send.${var.domain_name}"
  type    = "CNAME"
  ttl     = 300
  records = ["send.forge.rmta.net"]
}

resource "aws_route53_record" "resend_rsend" {
  count = var.resend_dkim == "" ? 0 : 1

  zone_id = data.aws_route53_zone.padre.zone_id
  name    = "rsend.${var.domain_name}"
  type    = "CNAME"
  ttl     = 300
  records = ["rsend-sae1.forge.rmta.net"]
}

# DMARC va en el dominio padre, como lo pide Resend: _dmarc.bacode.online. Es el
# único registro fuera de mercadia., y con p=none solo reporta: no rechaza ni
# manda a spam nada de lo que ya envíe bacode.online.
resource "aws_route53_record" "dmarc" {
  count = var.resend_dkim == "" ? 0 : 1

  zone_id = data.aws_route53_zone.padre.zone_id
  name    = "_dmarc.${var.zona_padre}"
  type    = "TXT"
  ttl     = 300
  records = ["v=DMARC1; p=none;"]
}
