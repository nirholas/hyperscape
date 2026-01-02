# ============================================================================
# Hyperscape AWS Infrastructure - Variables
# ============================================================================
# Input variables for Terraform deployment
# These can be set via terraform.tfvars, environment variables, or CLI
# ============================================================================

variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
  default     = "prod"
}

variable "project_name" {
  description = "Project name prefix for all resources"
  type        = string
  default     = "hyperscape"
}

# ============================================================================
# VPC Configuration (using existing VPC)
# ============================================================================
variable "vpc_id" {
  description = "ID of existing VPC"
  type        = string
}

variable "subnet_ids" {
  description = "Comma-separated list of subnet IDs"
  type        = string
}

variable "security_group_ids" {
  description = "Comma-separated list of security group IDs"
  type        = string
}

# ============================================================================
# Database Configuration
# ============================================================================
variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.micro"
}

variable "db_allocated_storage" {
  description = "Allocated storage in GB"
  type        = number
  default     = 20
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "hyperscape"
}

variable "db_username" {
  description = "Database master username"
  type        = string
  default     = "hyperscape"
  sensitive   = true
}

variable "db_password" {
  description = "Database master password"
  type        = string
  sensitive   = true
}

# ============================================================================
# ECS Configuration
# ============================================================================
variable "server_cpu" {
  description = "Server task CPU units (1024 = 1 vCPU)"
  type        = number
  default     = 512
}

variable "server_memory" {
  description = "Server task memory in MB"
  type        = number
  default     = 1024
}

variable "server_desired_count" {
  description = "Desired number of server tasks"
  type        = number
  default     = 1
}

# ============================================================================
# SSL/TLS Configuration
# ============================================================================
variable "acm_certificate_arn" {
  description = "ARN of ACM certificate for HTTPS"
  type        = string
}

# ============================================================================
# Domain Configuration
# ============================================================================
variable "domain_name" {
  description = "Base domain name (e.g., hyperscape.game)"
  type        = string
  default     = ""
}

# ============================================================================
# API Keys (stored in Secrets Manager)
# ============================================================================
variable "anthropic_api_key" {
  description = "Anthropic API key for AI features"
  type        = string
  sensitive   = true
  default     = ""
}

variable "privy_app_id" {
  description = "Privy App ID for authentication"
  type        = string
  default     = ""
}

variable "privy_app_secret" {
  description = "Privy App Secret for authentication"
  type        = string
  sensitive   = true
  default     = ""
}

variable "livekit_api_key" {
  description = "LiveKit API key for voice chat"
  type        = string
  default     = ""
}

variable "livekit_api_secret" {
  description = "LiveKit API secret for voice chat"
  type        = string
  sensitive   = true
  default     = ""
}

variable "jwt_secret" {
  description = "JWT secret for token signing"
  type        = string
  sensitive   = true
  default     = ""
}

variable "admin_code" {
  description = "Admin code for protected endpoints"
  type        = string
  sensitive   = true
  default     = ""
}

variable "ai_gateway_api_key" {
  description = "AI Gateway API key for AI features"
  type        = string
  sensitive   = true
  default     = ""
}

variable "meshy_api_key" {
  description = "Meshy API key for 3D asset generation"
  type        = string
  sensitive   = true
  default     = ""
}

variable "elevenlabs_api_key" {
  description = "ElevenLabs API key for voice/music/sound generation"
  type        = string
  sensitive   = true
  default     = ""
}

# ============================================================================
# External Service URLs
# ============================================================================
variable "elizaos_url" {
  description = "ElizaOS API server URL"
  type        = string
  default     = ""
}

variable "image_server_url" {
  description = "Image server URL for asset-forge (defaults to API URL if not set)"
  type        = string
  default     = ""
}

# ============================================================================
# Tags
# ============================================================================
variable "tags" {
  description = "Additional tags for all resources"
  type        = map(string)
  default     = {}
}
