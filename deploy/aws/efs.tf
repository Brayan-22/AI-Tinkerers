# ---------------------------------------------------------------------------
# Disco. SQLite necesita un archivo que sobreviva al reemplazo de la tarea: sin
# esto el historial de precios empieza de cero en cada despliegue y el
# detector de explotación se queda ciego.
#
# SQLite sobre NFS es seguro aquí por dos razones: hay un solo escritor (una
# tarea, despliegue stop-first) y el store no usa WAL, que es el modo que sí
# se rompe en disco de red porque necesita memoria compartida.
# ---------------------------------------------------------------------------

resource "aws_efs_file_system" "datos" {
  creation_token = "${var.project}-datos"
  encrypted      = true

  tags = {
    Name = "${var.project}-datos"
  }
}

resource "aws_efs_mount_target" "datos" {
  for_each = toset(data.aws_subnets.publicas.ids)

  file_system_id  = aws_efs_file_system.datos.id
  subnet_id       = each.value
  security_groups = [aws_security_group.efs.id]
}

# El contenedor corre como el usuario node (uid 1000). El punto de acceso crea
# la carpeta con ese dueño, así que no hace falta correr como root.
resource "aws_efs_access_point" "datos" {
  file_system_id = aws_efs_file_system.datos.id

  posix_user {
    uid = 1000
    gid = 1000
  }

  root_directory {
    path = "/mercadia"
    creation_info {
      owner_uid   = 1000
      owner_gid   = 1000
      permissions = "0750"
    }
  }
}

resource "aws_efs_backup_policy" "datos" {
  file_system_id = aws_efs_file_system.datos.id

  backup_policy {
    status = "ENABLED"
  }
}
