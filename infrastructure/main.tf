# ============================================================================
# Hyperscape AWS Infrastructure - Main Configuration
# ============================================================================
# Complete AWS infrastructure for Hyperscape game platform
# - PostgreSQL RDS for database
# - ECS Fargate for game server
# - S3 + CloudFront for frontend and assets
# - Application Load Balancer with WebSocket support
# ============================================================================

terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }

  # Uncomment to use S3 backend for state management
  # backend "s3" {
  #   bucket         = "hyperscape-terraform-state"
  #   key            = "prod/terraform.tfstate"
  #   region         = "us-east-1"
  #   encrypt        = true
  #   dynamodb_table = "hyperscape-terraform-locks"
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = merge(var.tags, {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
    })
  }
}

# Provider alias for CloudFront (must be in us-east-1 for certificates)
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

# ============================================================================
# Local Values
# ============================================================================
locals {
  name_prefix = "${var.project_name}-${var.environment}"
  subnet_list = split(",", var.subnet_ids)
  sg_list     = split(",", var.security_group_ids)

  common_tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

# ============================================================================
# Data Sources - Existing VPC Resources
# ============================================================================
data "aws_vpc" "main" {
  id = var.vpc_id
}

data "aws_subnets" "private" {
  filter {
    name   = "vpc-id"
    values = [var.vpc_id]
  }

  filter {
    name   = "subnet-id"
    values = local.subnet_list
  }
}

# ============================================================================
# Security Groups
# ============================================================================

# Security group for RDS
resource "aws_security_group" "rds" {
  name        = "${local.name_prefix}-rds-sg"
  description = "Security group for RDS PostgreSQL"
  vpc_id      = var.vpc_id

  ingress {
    description     = "PostgreSQL from ECS"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-rds-sg"
  }
}

# Security group for ECS tasks
resource "aws_security_group" "ecs_tasks" {
  name        = "${local.name_prefix}-ecs-tasks-sg"
  description = "Security group for ECS tasks"
  vpc_id      = var.vpc_id

  ingress {
    description     = "HTTP from ALB"
    from_port       = 5555
    to_port         = 5555
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-ecs-tasks-sg"
  }
}

# Security group for ALB
resource "aws_security_group" "alb" {
  name        = "${local.name_prefix}-alb-sg"
  description = "Security group for Application Load Balancer"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-alb-sg"
  }
}

# ============================================================================
# RDS PostgreSQL Database
# ============================================================================

resource "aws_db_subnet_group" "main" {
  name       = "${local.name_prefix}-db-subnet"
  subnet_ids = local.subnet_list

  tags = {
    Name = "${local.name_prefix}-db-subnet"
  }
}

resource "aws_db_instance" "main" {
  identifier = "${local.name_prefix}-postgres"

  engine         = "postgres"
  engine_version = "16.3"
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_allocated_storage * 2
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.db_name
  username = var.db_username
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  multi_az               = var.environment == "prod"
  publicly_accessible    = false
  skip_final_snapshot    = var.environment != "prod"
  deletion_protection    = var.environment == "prod"
  backup_retention_period = var.environment == "prod" ? 7 : 1

  performance_insights_enabled = true

  parameter_group_name = aws_db_parameter_group.main.name

  tags = {
    Name = "${local.name_prefix}-postgres"
  }
}

resource "aws_db_parameter_group" "main" {
  family = "postgres16"
  name   = "${local.name_prefix}-pg-params"

  parameter {
    name         = "max_connections"
    value        = "200"
    apply_method = "pending-reboot"
  }

  # Use RDS defaults for memory parameters (they auto-tune based on instance size)
  # shared_buffers is a static parameter that requires reboot

  tags = {
    Name = "${local.name_prefix}-pg-params"
  }
}

# ============================================================================
# ECR Repository
# ============================================================================

resource "aws_ecr_repository" "server" {
  name                 = "${local.name_prefix}-server"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = {
    Name = "${local.name_prefix}-server"
  }
}

resource "aws_ecr_lifecycle_policy" "server" {
  repository = aws_ecr_repository.server.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# ============================================================================
# ECS Cluster
# ============================================================================

resource "aws_ecs_cluster" "main" {
  name = "${local.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name = "${local.name_prefix}-cluster"
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name = aws_ecs_cluster.main.name

  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    base              = 1
    weight            = 100
    capacity_provider = "FARGATE"
  }
}

# ============================================================================
# CloudWatch Log Group
# ============================================================================

resource "aws_cloudwatch_log_group" "server" {
  name              = "/ecs/${local.name_prefix}-server"
  retention_in_days = 30

  tags = {
    Name = "${local.name_prefix}-server-logs"
  }
}

# ============================================================================
# IAM Roles for ECS
# ============================================================================

# Task execution role (for pulling images, logging)
resource "aws_iam_role" "ecs_task_execution" {
  name = "${local.name_prefix}-ecs-task-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name = "${local.name_prefix}-ecs-task-execution"
  }
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Additional policy for Secrets Manager access
resource "aws_iam_role_policy" "ecs_secrets" {
  name = "${local.name_prefix}-ecs-secrets"
  role = aws_iam_role.ecs_task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          aws_secretsmanager_secret.app_secrets.arn
        ]
      }
    ]
  })
}

# Task role (for application permissions)
resource "aws_iam_role" "ecs_task" {
  name = "${local.name_prefix}-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name = "${local.name_prefix}-ecs-task"
  }
}

# S3 access for task role
resource "aws_iam_role_policy" "ecs_task_s3" {
  name = "${local.name_prefix}-ecs-s3"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.assets.arn,
          "${aws_s3_bucket.assets.arn}/*"
        ]
      }
    ]
  })
}

# ============================================================================
# Secrets Manager
# ============================================================================

resource "aws_secretsmanager_secret" "app_secrets" {
  name        = "${local.name_prefix}/app-secrets"
  description = "Application secrets for Hyperscape"

  tags = {
    Name = "${local.name_prefix}-app-secrets"
  }
}

resource "aws_secretsmanager_secret_version" "app_secrets" {
  secret_id = aws_secretsmanager_secret.app_secrets.id
  secret_string = jsonencode({
    DATABASE_URL        = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.main.endpoint}/${var.db_name}?sslmode=no-verify"
    ANTHROPIC_API_KEY   = var.anthropic_api_key
    PRIVY_APP_ID        = var.privy_app_id
    PRIVY_APP_SECRET    = var.privy_app_secret
    LIVEKIT_API_KEY     = var.livekit_api_key
    LIVEKIT_API_SECRET  = var.livekit_api_secret
    JWT_SECRET          = var.jwt_secret
    ADMIN_CODE          = var.admin_code
    # Asset Forge API keys
    AI_GATEWAY_API_KEY  = var.ai_gateway_api_key
    MESHY_API_KEY       = var.meshy_api_key
    ELEVENLABS_API_KEY  = var.elevenlabs_api_key
  })
}

# ============================================================================
# ECS Task Definition
# ============================================================================

resource "aws_ecs_task_definition" "server" {
  family                   = "${local.name_prefix}-server"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.server_cpu
  memory                   = var.server_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name  = "server"
      image = "${aws_ecr_repository.server.repository_url}:latest"

      portMappings = [
        {
          containerPort = 5555
          hostPort      = 5555
          protocol      = "tcp"
        }
      ]

      environment = [
        { name = "PORT", value = "5555" },
        { name = "NODE_ENV", value = var.environment },
        # CDN and Asset URLs
        { name = "PUBLIC_CDN_URL", value = "https://${aws_cloudfront_distribution.assets.domain_name}" },
        # Application URLs
        { name = "PUBLIC_APP_URL", value = "https://hyperscape.lol" },
        { name = "CLIENT_URL", value = "https://hyperscape.lol" },
        # API URLs
        { name = "PUBLIC_API_URL", value = "https://api.hyperscape.lol" },
        { name = "PUBLIC_WS_URL", value = "wss://api.hyperscape.lol/ws" },
        { name = "SERVER_URL", value = "https://api.hyperscape.lol" },
        { name = "SERVER_HOST", value = "api.hyperscape.lol" },
        { name = "SERVER_PROTOCOL", value = "https:" },
        # Plugin/Service URLs
        { name = "HYPERSCAPE_SERVER_URL", value = "wss://api.hyperscape.lol/ws" },
        { name = "ELIZAOS_URL", value = var.elizaos_url != "" ? var.elizaos_url : "https://api.hyperscape.lol" },
        { name = "ELIZAOS_API_URL", value = var.elizaos_url != "" ? var.elizaos_url : "https://api.hyperscape.lol" },
        { name = "IMAGE_SERVER_URL", value = var.image_server_url != "" ? var.image_server_url : "https://api.hyperscape.lol" },
        # Database Configuration
        { name = "USE_LOCAL_POSTGRES", value = "false" },
        { name = "POSTGRES_HOST", value = aws_db_instance.main.address }
      ]

      secrets = [
        {
          name      = "DATABASE_URL"
          valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:DATABASE_URL::"
        },
        {
          name      = "ANTHROPIC_API_KEY"
          valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:ANTHROPIC_API_KEY::"
        },
        {
          name      = "PRIVY_APP_ID"
          valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:PRIVY_APP_ID::"
        },
        {
          name      = "PRIVY_APP_SECRET"
          valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:PRIVY_APP_SECRET::"
        },
        {
          name      = "LIVEKIT_API_KEY"
          valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:LIVEKIT_API_KEY::"
        },
        {
          name      = "LIVEKIT_API_SECRET"
          valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:LIVEKIT_API_SECRET::"
        },
        {
          name      = "JWT_SECRET"
          valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:JWT_SECRET::"
        },
        {
          name      = "ADMIN_CODE"
          valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:ADMIN_CODE::"
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.server.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "wget -q -O - http://localhost:5555/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  tags = {
    Name = "${local.name_prefix}-server"
  }
}

# ============================================================================
# Application Load Balancer
# ============================================================================

resource "aws_lb" "main" {
  name               = "${local.name_prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = local.subnet_list

  enable_deletion_protection = var.environment == "prod"
  
  # Increase idle timeout for WebSocket connections (default 60s, max 4000s)
  # WebSocket connections can be long-lived, so we set a higher timeout
  idle_timeout = 3600  # 1 hour

  tags = {
    Name = "${local.name_prefix}-alb"
  }
}

resource "aws_lb_target_group" "server" {
  name        = "${local.name_prefix}-server-tg"
  port        = 5555
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = "/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    timeout             = 5
    unhealthy_threshold = 3
  }

  # Enable sticky sessions for WebSocket connections
  stickiness {
    type            = "lb_cookie"
    cookie_duration = 86400
    enabled         = true
  }

  tags = {
    Name = "${local.name_prefix}-server-tg"
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.server.arn
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
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

# ============================================================================
# ECS Service
# ============================================================================

resource "aws_ecs_service" "server" {
  name            = "${local.name_prefix}-server"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.server.arn
  desired_count   = var.server_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = local.subnet_list
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.server.arn
    container_name   = "server"
    container_port   = 5555
  }

  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [
    aws_lb_listener.https,
    aws_iam_role_policy_attachment.ecs_task_execution
  ]

  lifecycle {
    ignore_changes = [task_definition]
  }

  tags = {
    Name = "${local.name_prefix}-server"
  }
}

# ============================================================================
# S3 Buckets for Frontend and Assets
# ============================================================================

# Frontend bucket
resource "aws_s3_bucket" "frontend" {
  bucket = "${local.name_prefix}-frontend"

  tags = {
    Name = "${local.name_prefix}-frontend"
  }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Assets bucket
resource "aws_s3_bucket" "assets" {
  bucket = "${local.name_prefix}-assets"

  tags = {
    Name = "${local.name_prefix}-assets"
  }
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket = aws_s3_bucket.assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "assets" {
  bucket = aws_s3_bucket.assets.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_cors_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}

# ============================================================================
# CloudFront Origin Access Control
# ============================================================================

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${local.name_prefix}-frontend-oac"
  description                       = "OAC for frontend S3 bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_origin_access_control" "assets" {
  name                              = "${local.name_prefix}-assets-oac"
  description                       = "OAC for assets S3 bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ============================================================================
# CloudFront Distribution - Frontend
# ============================================================================

resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  comment             = "Hyperscape Frontend"
  price_class         = "PriceClass_100"
  aliases             = ["hyperscape.lol"]

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "S3-${aws_s3_bucket.frontend.id}"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-${aws_s3_bucket.frontend.id}"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400
    compress               = true
  }

  # Cache static assets longer
  ordered_cache_behavior {
    path_pattern     = "/assets/*"
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-${aws_s3_bucket.frontend.id}"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 86400
    default_ttl            = 604800
    max_ttl                = 31536000
    compress               = true
  }

  # SPA fallback for client-side routing
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = var.acm_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = {
    Name = "${local.name_prefix}-frontend-cdn"
  }
}

# ============================================================================
# CloudFront Distribution - Assets
# ============================================================================

resource "aws_cloudfront_distribution" "assets" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "Hyperscape Game Assets CDN"
  price_class     = "PriceClass_100"

  origin {
    domain_name              = aws_s3_bucket.assets.bucket_regional_domain_name
    origin_id                = "S3-${aws_s3_bucket.assets.id}"
    origin_access_control_id = aws_cloudfront_origin_access_control.assets.id
  }

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-${aws_s3_bucket.assets.id}"

    # Use cache_policy_id instead of forwarded_values for better control
    # This ensures Content-Type headers from S3 are preserved
    cache_policy_id = aws_cloudfront_cache_policy.assets.id

    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    # CORS support
    response_headers_policy_id = aws_cloudfront_response_headers_policy.cors.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = {
    Name = "${local.name_prefix}-assets-cdn"
  }
}

# Cache policy for assets - preserves Content-Type from S3
resource "aws_cloudfront_cache_policy" "assets" {
  name        = "${local.name_prefix}-assets-cache-policy"
  comment     = "Cache policy for game assets - preserves Content-Type"
  default_ttl = 604800
  max_ttl     = 31536000
  min_ttl     = 86400

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true

    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

resource "aws_cloudfront_response_headers_policy" "cors" {
  name    = "${local.name_prefix}-cors-policy"
  comment = "CORS policy for game assets"

  cors_config {
    access_control_allow_credentials = false

    access_control_allow_headers {
      items = ["*"]
    }

    access_control_allow_methods {
      items = ["GET", "HEAD", "OPTIONS"]
    }

    access_control_allow_origins {
      items = ["*"]
    }

    access_control_max_age_sec = 86400

    origin_override = true
  }
}

# ============================================================================
# S3 Bucket Policies for CloudFront
# ============================================================================

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontServicePrincipal"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.frontend.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn
          }
        }
      }
    ]
  })
}

resource "aws_s3_bucket_policy" "assets" {
  bucket = aws_s3_bucket.assets.id

  # Ensure CloudFront distribution exists before creating policy
  depends_on = [aws_cloudfront_distribution.assets]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontServicePrincipal"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.assets.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.assets.arn
          }
        }
      }
    ]
  })
}

# ============================================================================
# Asset Forge - S3 Bucket for Frontend
# ============================================================================

resource "aws_s3_bucket" "asset_forge" {
  bucket = "${local.name_prefix}-asset-forge"

  tags = {
    Name = "${local.name_prefix}-asset-forge"
  }
}

resource "aws_s3_bucket_public_access_block" "asset_forge" {
  bucket = aws_s3_bucket.asset_forge.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "asset_forge" {
  bucket = aws_s3_bucket.asset_forge.id

  versioning_configuration {
    status = "Enabled"
  }
}

# CloudFront Origin Access Control for Asset Forge
resource "aws_cloudfront_origin_access_control" "asset_forge" {
  name                              = "${local.name_prefix}-asset-forge-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# CloudFront Distribution for Asset Forge
resource "aws_cloudfront_distribution" "asset_forge" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  comment             = "Asset Forge CDN for ${var.environment}"
  price_class         = "PriceClass_100"
  aliases             = ["forge.${var.domain_name}"]

  origin {
    domain_name              = aws_s3_bucket.asset_forge.bucket_regional_domain_name
    origin_id                = "S3-asset-forge"
    origin_access_control_id = aws_cloudfront_origin_access_control.asset_forge.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-asset-forge"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false

      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 86400
  }

  # Handle SPA routing
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = var.acm_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = {
    Name = "${local.name_prefix}-asset-forge-cdn"
  }
}

# S3 Bucket Policy for Asset Forge
resource "aws_s3_bucket_policy" "asset_forge" {
  bucket = aws_s3_bucket.asset_forge.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontServicePrincipal"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.asset_forge.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.asset_forge.arn
          }
        }
      }
    ]
  })
}

# Route53 zone data source - using the hosted zone ID directly
# There are two zones for hyperscape.lol, we use the one created manually
locals {
  route53_zone_id = "Z00333522QBZNYBTLUV9G"
}

# Route53 DNS Record for Asset Forge Frontend
resource "aws_route53_record" "asset_forge" {
  zone_id = local.route53_zone_id
  name    = "forge.${var.domain_name}"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.asset_forge.domain_name
    zone_id                = aws_cloudfront_distribution.asset_forge.hosted_zone_id
    evaluate_target_health = false
  }
}

# ============================================================================
# Asset Forge API - ECS Backend Service
# ============================================================================

# ECR Repository for Asset Forge API
resource "aws_ecr_repository" "asset_forge_api" {
  name                 = "${local.name_prefix}-asset-forge-api"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "${local.name_prefix}-asset-forge-api"
  }
}

# ECR Lifecycle Policy
resource "aws_ecr_lifecycle_policy" "asset_forge_api" {
  repository = aws_ecr_repository.asset_forge_api.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# CloudWatch Log Group for Asset Forge API
resource "aws_cloudwatch_log_group" "asset_forge_api" {
  name              = "/ecs/${local.name_prefix}-asset-forge-api"
  retention_in_days = 30

  tags = {
    Name = "${local.name_prefix}-asset-forge-api-logs"
  }
}

# ECS Task Definition for Asset Forge API
resource "aws_ecs_task_definition" "asset_forge_api" {
  family                   = "${local.name_prefix}-asset-forge-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name  = "asset-forge-api"
      image = "${aws_ecr_repository.asset_forge_api.repository_url}:latest"

      portMappings = [
        {
          containerPort = 3401
          hostPort      = 3401
          protocol      = "tcp"
        }
      ]

      environment = [
        { name = "NODE_ENV", value = var.environment },
        { name = "API_PORT", value = "3401" },
        { name = "ASSET_FORGE_API_PORT", value = "3401" },
        { name = "FRONTEND_URL", value = "https://forge.${var.domain_name}" },
        { name = "IMAGE_SERVER_URL", value = "https://forge-api.${var.domain_name}" }
      ]

      secrets = [
        { name = "AI_GATEWAY_API_KEY", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:AI_GATEWAY_API_KEY::" },
        { name = "ANTHROPIC_API_KEY", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:ANTHROPIC_API_KEY::" },
        { name = "MESHY_API_KEY", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:MESHY_API_KEY::" },
        { name = "ELEVENLABS_API_KEY", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:ELEVENLABS_API_KEY::" }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.asset_forge_api.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:3401/api/health || exit 1"]
        interval    = 30
        timeout     = 10
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  tags = {
    Name = "${local.name_prefix}-asset-forge-api-task"
  }
}

# ALB Target Group for Asset Forge API
resource "aws_lb_target_group" "asset_forge_api" {
  name        = "${local.name_prefix}-forge-api-tg"
  port        = 3401
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 10
    interval            = 30
    path                = "/api/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    matcher             = "200"
  }

  tags = {
    Name = "${local.name_prefix}-forge-api-tg"
  }
}

# ALB Listener Rule for Asset Forge API (host-based routing)
resource "aws_lb_listener_rule" "asset_forge_api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 90

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.asset_forge_api.arn
  }

  condition {
    host_header {
      values = ["forge-api.${var.domain_name}"]
    }
  }

  tags = {
    Name = "${local.name_prefix}-forge-api-rule"
  }
}

# ECS Service for Asset Forge API
resource "aws_ecs_service" "asset_forge_api" {
  name                               = "${local.name_prefix}-asset-forge-api"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.asset_forge_api.arn
  desired_count                      = 1
  launch_type                        = "FARGATE"
  platform_version                   = "LATEST"
  health_check_grace_period_seconds  = 120
  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100

  network_configuration {
    subnets          = split(",", var.subnet_ids)
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.asset_forge_api.arn
    container_name   = "asset-forge-api"
    container_port   = 3401
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [
    aws_lb_listener.https,
    aws_lb_listener_rule.asset_forge_api
  ]

  tags = {
    Name = "${local.name_prefix}-asset-forge-api"
  }
}

# Route53 DNS Record for Asset Forge API
resource "aws_route53_record" "asset_forge_api" {
  zone_id = local.route53_zone_id
  name    = "forge-api.${var.domain_name}"
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

# Route53 DNS Record for API (api.hyperscape.lol)
resource "aws_route53_record" "api" {
  zone_id = local.route53_zone_id
  name    = "api.${var.domain_name}"
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}
