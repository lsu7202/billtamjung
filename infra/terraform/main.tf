# 빌탐정 인프라 골격(Terraform). 착수 시 값·권한 세부 확정(01-상세설계 §5·7).
terraform {
  required_providers {
    google = { source = "hashicorp/google", version = "~> 5.0" }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ── DB: Cloud SQL (PostgreSQL + PostGIS) ────────────────
resource "google_sql_database_instance" "pg" {
  name             = "bt-pg"
  database_version = "POSTGRES_16"
  region           = var.region
  settings {
    tier = "db-custom-1-3840" # 베타 소형
    ip_configuration { ipv4_enabled = true }
    database_flags { name = "cloudsql.enable_pg_trgm" value = "on" }
  }
  deletion_protection = true
}
resource "google_sql_database" "app" {
  name     = "billtamjung"
  instance = google_sql_database_instance.pg.name
}

# ── Cloud Run: api(공개, min=1) · worker(비공개, min=0) ──
resource "google_cloud_run_v2_service" "api" {
  name     = "bt-api"
  location = var.region
  template {
    scaling { min_instance_count = 1 }
    containers {
      image = var.api_image
      ports { container_port = 8000 }
      env { name = "APP_MODULE" value = "app.main" }
    }
  }
}
resource "google_cloud_run_v2_service" "worker" {
  name     = "bt-worker"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  template {
    scaling { min_instance_count = 0 }
    containers {
      image = var.api_image
      ports { container_port = 8080 }
      env { name = "APP_MODULE" value = "app.worker" }
    }
  }
}

# ── 산출물 버킷 (서명 URL만) ────────────────────────────
resource "google_storage_bucket" "reports" {
  name     = "${var.project_id}-bt-reports"
  location = var.region
  uniform_bucket_level_access = true
}

# ── Cloud Tasks: 보고서 큐 ──────────────────────────────
resource "google_cloud_tasks_queue" "reports" {
  name     = "bt-report-queue"
  location = var.region
  retry_config { max_attempts = 1 } # 중복 생성 방지
}

# ── Cloud Scheduler: master 적재(소스별) ────────────────
resource "google_cloud_scheduler_job" "load_rtms" {
  name      = "bt-load-rtms"
  schedule  = "0 3 1 * *" # 매월(실거래)
  time_zone = "Asia/Seoul"
  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.worker.uri}/jobs/load?source=rtms"
    oidc_token { service_account_email = var.scheduler_sa }
  }
}

# ── Secret Manager (키·비번) ────────────────────────────
resource "google_secret_manager_secret" "jwt" {
  secret_id = "bt-jwt-secret"
  replication { auto {} }
}
