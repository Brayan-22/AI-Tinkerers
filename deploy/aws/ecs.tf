# ---------------------------------------------------------------------------
# Imagen. La misma del compose, construida por desplegar.sh.
# ---------------------------------------------------------------------------

resource "aws_ecr_repository" "app" {
  name                 = var.project
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Conservar solo las 10 imágenes más recientes"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${var.project}"
  retention_in_days = 14
}

# ---------------------------------------------------------------------------
# Permisos. Dos roles, como pide ECS: el de ejecución baja la imagen y lee las
# llaves antes de arrancar; el de la tarea es lo que el proceso puede hacer
# (solo montar su disco).
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ejecucion" {
  name               = "${var.project}-ejecucion"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "ejecucion" {
  role       = aws_iam_role.ejecucion.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ejecucion_llaves" {
  name = "${var.project}-llaves"
  role = aws_iam_role.ejecucion.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ssm:GetParameters"]
      Resource = [for p in aws_ssm_parameter.llave : p.arn]
    }]
  })
}

resource "aws_iam_role" "tarea" {
  name               = "${var.project}-tarea"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy" "tarea_efs" {
  name = "${var.project}-efs"
  role = aws_iam_role.tarea.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["elasticfilesystem:ClientMount", "elasticfilesystem:ClientWrite"]
      Resource = aws_efs_file_system.datos.arn
      Condition = {
        StringEquals = { "elasticfilesystem:AccessPointArn" = aws_efs_access_point.datos.arn }
      }
    }]
  })
}

# ---------------------------------------------------------------------------
# La tarea.
# ---------------------------------------------------------------------------

resource "aws_ecs_cluster" "main" {
  name = var.project
}

locals {
  entorno = merge(
    {
      MARKET_PLACE     = "Colombia"
      BASE_SEPOLIA_RPC = "https://sepolia.base.org"
    },
    { for k, v in var.entorno : k => v if trimspace(v) != "" },
    # Estas no se pisan desde el .env: son del contenedor, no del mercado.
    {
      NODE_ENV     = "production"
      PORT         = "3000"
      DB_PATH      = "/data/mercadia.db"
      WEB_DIR      = "/app/public"
      WALLETS_FILE = "/tmp/wallets.json"
      PUBLIC_URL   = "https://${var.domain_name}"
    },
  )
}

resource "aws_ecs_task_definition" "app" {
  family                   = var.project
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.ejecucion.arn
  task_role_arn            = aws_iam_role.tarea.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  volume {
    name = "datos"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.datos.id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.datos.id
        iam             = "ENABLED"
      }
    }
  }

  container_definitions = jsonencode([{
    name      = var.project
    image     = "${aws_ecr_repository.app.repository_url}:${var.image_tag}"
    essential = true

    # wallets.js solo lee un archivo, y ECS entrega las llaves como variables.
    # El puente se hace acá, sin tocar el código: se escribe a /tmp y se quita
    # la variable del entorno del proceso.
    command = [
      "sh", "-c",
      "if [ -n \"$WALLETS_JSON\" ]; then printf '%s' \"$WALLETS_JSON\" > /tmp/wallets.json; fi; exec env -u WALLETS_JSON node src/main.js",
    ]

    portMappings = [{ containerPort = 3000, protocol = "tcp" }]

    environment = [for k, v in local.entorno : { name = k, value = v }]
    secrets     = [for k in local.nombres_secretos : { name = k, valueFrom = aws_ssm_parameter.llave[k].arn }]

    mountPoints = [{ sourceVolume = "datos", containerPath = "/data", readOnly = false }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "app"
      }
    }
  }])
}

# ---------------------------------------------------------------------------
# El servicio. Una sola tarea, siempre prendida, por las mismas razones que en
# Cloud Run: el socket de Slack y el polling de Telegram tienen que existir
# aunque nadie entre, SQLite tiene un solo escritor, y las aprobaciones
# abiertas y la arena viven en memoria.
#
# minimum 0 / maximum 100 es stop-first: la tarea vieja se apaga antes de que
# arranque la nueva. Dos procesos escribiendo la misma base, o dos bots
# haciendo polling al mismo token de Telegram (409 Conflict), es peor que
# treinta segundos sin servicio.
# ---------------------------------------------------------------------------

resource "aws_ecs_service" "app" {
  name            = var.project
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  health_check_grace_period_seconds  = 60

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = data.aws_subnets.publicas.ids
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = var.project
    container_port   = 3000
  }

  depends_on = [aws_lb_listener.https, aws_efs_mount_target.datos]
}
