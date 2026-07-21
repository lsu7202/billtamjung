variable "project_id"   { type = string }
variable "region"       { type = string  default = "asia-northeast3" } # 서울
variable "api_image"    { type = string  description = "Artifact Registry api·worker 이미지" }
variable "scheduler_sa" { type = string  description = "Cloud Scheduler OIDC 서비스 계정" }
