terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform"
    }
  }
}

# El estado queda local, en esta carpeta, y trae los valores de las llaves:
# está en .gitignore y no se sube. Para un equipo, un bucket S3 con
# use_lockfile = true (Terraform >= 1.10, sin DynamoDB).
