# ============================================================================
# Hyperscape AWS Infrastructure - Outputs
# ============================================================================
# Export important resource identifiers and endpoints
# ============================================================================

# ============================================================================
# Database Outputs
# ============================================================================
output "rds_endpoint" {
  description = "RDS instance endpoint"
  value       = aws_db_instance.main.endpoint
}

output "rds_address" {
  description = "RDS instance hostname"
  value       = aws_db_instance.main.address
}

output "database_url" {
  description = "Full PostgreSQL connection URL"
  value       = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.main.endpoint}/${var.db_name}"
  sensitive   = true
}

# ============================================================================
# ECR Outputs
# ============================================================================
output "ecr_repository_url" {
  description = "ECR repository URL for server image"
  value       = aws_ecr_repository.server.repository_url
}

output "ecr_repository_name" {
  description = "ECR repository name"
  value       = aws_ecr_repository.server.name
}

# ============================================================================
# ECS Outputs
# ============================================================================
output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.main.name
}

output "ecs_cluster_arn" {
  description = "ECS cluster ARN"
  value       = aws_ecs_cluster.main.arn
}

output "ecs_service_name" {
  description = "ECS service name"
  value       = aws_ecs_service.server.name
}

# ============================================================================
# Load Balancer Outputs
# ============================================================================
output "alb_dns_name" {
  description = "Application Load Balancer DNS name"
  value       = aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "ALB Route53 zone ID (for DNS alias records)"
  value       = aws_lb.main.zone_id
}

output "server_url" {
  description = "Server API URL (via ALB)"
  value       = "https://${aws_lb.main.dns_name}"
}

# ============================================================================
# Frontend Outputs
# ============================================================================
output "frontend_bucket_name" {
  description = "Frontend S3 bucket name"
  value       = aws_s3_bucket.frontend.id
}

output "frontend_cloudfront_domain" {
  description = "Frontend CloudFront distribution domain"
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "frontend_cloudfront_id" {
  description = "Frontend CloudFront distribution ID"
  value       = aws_cloudfront_distribution.frontend.id
}

output "frontend_url" {
  description = "Frontend URL"
  value       = "https://${aws_cloudfront_distribution.frontend.domain_name}"
}

# ============================================================================
# Assets CDN Outputs
# ============================================================================
output "assets_bucket_name" {
  description = "Assets S3 bucket name"
  value       = aws_s3_bucket.assets.id
}

output "assets_cloudfront_domain" {
  description = "Assets CloudFront distribution domain"
  value       = aws_cloudfront_distribution.assets.domain_name
}

output "assets_cloudfront_id" {
  description = "Assets CloudFront distribution ID"
  value       = aws_cloudfront_distribution.assets.id
}

output "assets_cdn_url" {
  description = "Assets CDN URL (for PUBLIC_CDN_URL)"
  value       = "https://${aws_cloudfront_distribution.assets.domain_name}"
}

# ============================================================================
# Secrets Manager
# ============================================================================
output "secrets_arn" {
  description = "ARN of Secrets Manager secret"
  value       = aws_secretsmanager_secret.app_secrets.arn
}

# ============================================================================
# CloudWatch
# ============================================================================
output "log_group_name" {
  description = "CloudWatch log group name for ECS logs"
  value       = aws_cloudwatch_log_group.server.name
}

# ============================================================================
# Asset Forge Outputs
# ============================================================================
output "asset_forge_bucket_name" {
  description = "Asset Forge S3 bucket name"
  value       = aws_s3_bucket.asset_forge.id
}

output "asset_forge_cloudfront_domain" {
  description = "Asset Forge CloudFront distribution domain"
  value       = aws_cloudfront_distribution.asset_forge.domain_name
}

output "asset_forge_cloudfront_id" {
  description = "Asset Forge CloudFront distribution ID"
  value       = aws_cloudfront_distribution.asset_forge.id
}

output "asset_forge_url" {
  description = "Asset Forge URL"
  value       = "https://forge.${var.domain_name}"
}

output "asset_forge_api_ecr_url" {
  description = "Asset Forge API ECR repository URL"
  value       = aws_ecr_repository.asset_forge_api.repository_url
}

output "asset_forge_api_url" {
  description = "Asset Forge API URL"
  value       = "https://forge-api.${var.domain_name}"
}

# ============================================================================
# Deployment Summary
# ============================================================================
output "deployment_summary" {
  description = "Summary of deployed resources"
  value = <<-EOT

  ╔══════════════════════════════════════════════════════════════════╗
  ║                   HYPERSCAPE AWS DEPLOYMENT                       ║
  ╠══════════════════════════════════════════════════════════════════╣
  ║                                                                   ║
  ║  🌐 Frontend URL:                                                 ║
  ║     https://${aws_cloudfront_distribution.frontend.domain_name}
  ║                                                                   ║
  ║  🎮 Game Server URL:                                              ║
  ║     https://${aws_lb.main.dns_name}
  ║                                                                   ║
  ║  📦 Assets CDN URL:                                               ║
  ║     https://${aws_cloudfront_distribution.assets.domain_name}
  ║                                                                   ║
  ║  🗄️  Database:                                                    ║
  ║     ${aws_db_instance.main.endpoint}
  ║                                                                   ║
  ║  🐳 ECR Repository:                                               ║
  ║     ${aws_ecr_repository.server.repository_url}
  ║                                                                   ║
  ╚══════════════════════════════════════════════════════════════════╝

  EOT
}
