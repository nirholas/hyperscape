# ============================================================================
# IAM User for GitHub Actions CI/CD
# ============================================================================
# Creates an IAM user with permissions for GitHub Actions to deploy
# to AWS (ECR, ECS, S3, CloudFront)
# ============================================================================

resource "aws_iam_user" "github_actions" {
  name = "${local.name_prefix}-github-actions"
  path = "/"

  tags = {
    Name        = "${local.name_prefix}-github-actions"
    Description = "IAM user for GitHub Actions CI/CD deployment"
    ManagedBy   = "terraform"
  }
}

# Policy for GitHub Actions deployment
resource "aws_iam_user_policy" "github_actions_deploy" {
  name = "${local.name_prefix}-github-actions-deploy"
  user = aws_iam_user.github_actions.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          # ECR permissions
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          # ECS permissions
          "ecs:UpdateService",
          "ecs:DescribeServices",
          "ecs:DescribeTasks",
          "ecs:ListTasks",
          # S3 permissions (frontend and assets buckets)
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject",
          "s3:ListBucket",
          "s3:PutObjectAcl",
          # CloudFront permissions
          "cloudfront:CreateInvalidation",
          "cloudfront:ListDistributions",
          "cloudfront:GetDistribution"
        ]
        Resource = [
          # ECR - allow access to server repository
          aws_ecr_repository.server.arn,
          "${aws_ecr_repository.server.arn}/*",
          # ECS - allow access to cluster and service
          aws_ecs_cluster.main.arn,
          "${aws_ecs_cluster.main.arn}/*",
          aws_ecs_service.server.id,
          # S3 - frontend bucket
          aws_s3_bucket.frontend.arn,
          "${aws_s3_bucket.frontend.arn}/*",
          # S3 - assets bucket
          aws_s3_bucket.assets.arn,
          "${aws_s3_bucket.assets.arn}/*",
          # CloudFront - all distributions (needed for list and invalidation)
          "*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken"
        ]
        Resource = "*"
      }
    ]
  })
}

# Data source to get current AWS account ID
data "aws_caller_identity" "current" {}

# Access keys for GitHub Actions (outputs will be shown, but secrets should be set manually)
resource "aws_iam_access_key" "github_actions" {
  user = aws_iam_user.github_actions.name
}

# Outputs (sensitive - will be shown in terraform output)
output "github_actions_access_key_id" {
  description = "Access key ID for GitHub Actions (set as AWS_ACCESS_KEY_ID secret)"
  value       = aws_iam_access_key.github_actions.id
  sensitive   = true
}

output "github_actions_secret_access_key" {
  description = "Secret access key for GitHub Actions (set as AWS_SECRET_ACCESS_KEY secret)"
  value       = aws_iam_access_key.github_actions.secret
  sensitive   = true
}

output "github_actions_user_arn" {
  description = "ARN of the GitHub Actions IAM user"
  value       = aws_iam_user.github_actions.arn
}
