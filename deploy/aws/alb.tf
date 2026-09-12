# ---------------------------------------------------------------------------
# Balanceador. Sirve el front, el API y el WebSocket (/ws) por el mismo
# dominio; el backend ya sirve los tres. Sin CloudFront: no hay nada que
# cachear que valga la complicación, y el WebSocket pasa directo.
# ---------------------------------------------------------------------------

resource "aws_lb" "web" {
  name               = var.project
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = data.aws_subnets.publicas.ids

  # El WebSocket de la pantalla se queda abierto mientras dura la negociación.
  # Con los 60 s por defecto el ALB lo corta en cada pausa.
  idle_timeout = 3600
}

resource "aws_lb_target_group" "app" {
  name        = var.project
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = data.aws_vpc.default.id

  # Una sola tarea: sin drenado largo, el reemplazo entra antes.
  deregistration_delay = 10

  health_check {
    path                = "/api/health"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.web.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.web.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.web.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}
