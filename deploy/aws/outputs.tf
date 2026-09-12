output "url" {
  description = "Dónde queda el mercado."
  value       = "https://${var.domain_name}"
}

output "ecr_repository_url" {
  description = "Destino del docker push."
  value       = aws_ecr_repository.app.repository_url
}

output "alb_dns" {
  description = "El balanceador, por si el DNS todavía no propagó."
  value       = aws_lb.web.dns_name
}

output "control_token" {
  description = "Entra a la operación por https://<dominio>/arena?t=<token>. terraform output -raw control_token"
  value       = local.secretos["CONTROL_TOKEN"]
  sensitive   = true
}

output "logs" {
  description = "Seguir los logs en vivo."
  value       = "aws logs tail ${aws_cloudwatch_log_group.app.name} --follow --region ${var.region}"
}
