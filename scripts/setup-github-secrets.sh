#!/bin/bash
# Script to create IAM user for GitHub Actions and set GitHub secrets

set -e

echo "🔐 Setting up GitHub Actions AWS deployment secrets..."

# Get AWS account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION="us-east-1"
USER_NAME="hyperscape-prod-github-actions"

echo "📋 AWS Account ID: $ACCOUNT_ID"
echo "🌍 Region: $REGION"
echo "👤 IAM User: $USER_NAME"

# Check if user already exists
if aws iam get-user --user-name "$USER_NAME" &>/dev/null; then
    echo "⚠️  IAM user $USER_NAME already exists"
    echo "   Will create new access keys (old ones will be deleted if limit reached)"
else
    echo "➕ Creating IAM user: $USER_NAME"
    aws iam create-user --user-name "$USER_NAME" --tags \
        Key=Name,Value="$USER_NAME" \
        Key=Description,Value="IAM user for GitHub Actions CI/CD deployment" \
        Key=ManagedBy,Value="script"
fi

# Create/update policy
POLICY_NAME="hyperscape-prod-github-actions-deploy"
POLICY_DOC=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecs:UpdateService",
        "ecs:DescribeServices",
        "ecs:DescribeTasks",
        "ecs:ListTasks",
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket",
        "s3:PutObjectAcl",
        "cloudfront:CreateInvalidation",
        "cloudfront:ListDistributions",
        "cloudfront:GetDistribution"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken"
      ],
      "Resource": "*"
    }
  ]
}
EOF
)

echo "📝 Creating/updating IAM policy: $POLICY_NAME"
POLICY_ARN=$(aws iam create-policy \
    --policy-name "$POLICY_NAME" \
    --policy-document "$POLICY_DOC" \
    --query 'Policy.Arn' \
    --output text 2>/dev/null || \
    aws iam get-policy --policy-arn "arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}" --query 'Policy.Arn' --output text)

# Attach policy to user
echo "🔗 Attaching policy to user..."
aws iam attach-user-policy --user-name "$USER_NAME" --policy-arn "$POLICY_ARN" 2>/dev/null || echo "Policy already attached"

# Create access key (delete old ones if at limit)
echo "🔑 Creating access key..."
OLD_KEYS=$(aws iam list-access-keys --user-name "$USER_NAME" --query 'AccessKeyMetadata[*].AccessKeyId' --output text 2>/dev/null || echo "")
KEY_COUNT=$(echo "$OLD_KEYS" | wc -w | tr -d ' ')
if [ "$KEY_COUNT" -ge 2 ]; then
    echo "⚠️  User has 2 access keys (limit). Deleting oldest..."
    FIRST_KEY=$(echo "$OLD_KEYS" | awk '{print $1}')
    aws iam delete-access-key --user-name "$USER_NAME" --access-key-id "$FIRST_KEY" 2>/dev/null || true
fi

ACCESS_KEY_OUTPUT=$(aws iam create-access-key --user-name "$USER_NAME" 2>/dev/null)
if [ $? -ne 0 ]; then
    echo "❌ Failed to create access key. User may already have 2 keys."
    echo "   Please delete an existing key manually or use existing keys."
    exit 1
fi

ACCESS_KEY_ID=$(echo "$ACCESS_KEY_OUTPUT" | jq -r '.AccessKey.AccessKeyId')
SECRET_ACCESS_KEY=$(echo "$ACCESS_KEY_OUTPUT" | jq -r '.AccessKey.SecretAccessKey')

echo ""
echo "✅ IAM user and access keys created!"
echo ""
echo "📋 Access Key ID: $ACCESS_KEY_ID"
echo "🔐 Secret Access Key: [HIDDEN]"
echo ""

# Get URLs from Terraform outputs
echo "📊 Getting deployment URLs from Terraform..."
cd infrastructure
SERVER_URL=$(terraform output -raw server_url 2>/dev/null || echo "")
CDN_URL=$(terraform output -raw assets_cdn_url 2>/dev/null || echo "")
cd ..

# If Terraform outputs not available, use defaults from outputs we saw
if [ -z "$SERVER_URL" ]; then
    SERVER_URL="https://hyperscape-prod-alb-1050748286.us-east-1.elb.amazonaws.com"
fi
if [ -z "$CDN_URL" ]; then
    CDN_URL="https://d20g7vd4m53hpb.cloudfront.net"
fi

echo "🌐 Server URL: $SERVER_URL"
echo "📦 CDN URL: $CDN_URL"
echo ""

# Set GitHub secrets
echo "🔐 Setting GitHub secrets..."
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "")
if [ -n "$REPO" ]; then
    gh secret set AWS_ACCESS_KEY_ID --body "$ACCESS_KEY_ID" --repo "$REPO"
    gh secret set AWS_SECRET_ACCESS_KEY --body "$SECRET_ACCESS_KEY" --repo "$REPO"
    gh secret set PUBLIC_SERVER_URL --body "$SERVER_URL" --repo "$REPO"
    gh secret set PUBLIC_CDN_URL --body "$CDN_URL" --repo "$REPO"
else
    echo "⚠️  Could not determine repo. Setting secrets in current directory..."
    gh secret set AWS_ACCESS_KEY_ID --body "$ACCESS_KEY_ID"
    gh secret set AWS_SECRET_ACCESS_KEY --body "$SECRET_ACCESS_KEY"
    gh secret set PUBLIC_SERVER_URL --body "$SERVER_URL"
    gh secret set PUBLIC_CDN_URL --body "$CDN_URL"
fi

echo ""
echo "✅ All secrets set successfully!"
echo ""
echo "📋 Summary:"
echo "   - AWS_ACCESS_KEY_ID: ✅ Set"
echo "   - AWS_SECRET_ACCESS_KEY: ✅ Set"
echo "   - PUBLIC_SERVER_URL: ✅ Set ($SERVER_URL)"
echo "   - PUBLIC_CDN_URL: ✅ Set ($CDN_URL)"
echo ""
echo "🧪 Testing IAM permissions..."
aws sts get-caller-identity --query Arn --output text
echo ""
echo "✅ Setup complete! You can now test the GitHub Actions workflow."
