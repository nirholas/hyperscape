# AWS Deployment - Required GitHub Secrets

This document lists all GitHub secrets required for AWS deployment via CI/CD.

## Summary

**Total Required Secrets: 4**

| Secret Name | Required | Used In |
|------------|----------|---------|
| `AWS_ACCESS_KEY_ID` | ✅ Yes | All deployment jobs |
| `AWS_SECRET_ACCESS_KEY` | ✅ Yes | All deployment jobs |
| `PUBLIC_SERVER_URL` | ✅ Yes | Frontend build |
| `PUBLIC_CDN_URL` | ✅ Yes | Frontend build |

## Required Secrets

### AWS Authentication

The workflow currently uses AWS Access Keys. For better security, consider migrating to OIDC (OpenID Connect) authentication.

#### Option 1: Access Keys (Current Method)

| Secret Name | Description | Required For | How to Get |
|------------|-------------|-------------|------------|
| `AWS_ACCESS_KEY_ID` | AWS access key ID | All AWS operations (ECR, ECS, S3, CloudFront) | AWS IAM Console → Users → Security Credentials → Create Access Key |
| `AWS_SECRET_ACCESS_KEY` | AWS secret access key | All AWS operations (ECR, ECS, S3, CloudFront) | Generated when creating access key (save immediately) |

**Required IAM Permissions:**
The IAM user/role needs the following permissions:

```json
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
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket",
        "cloudfront:CreateInvalidation",
        "cloudfront:ListDistributions"
      ],
      "Resource": "*"
    }
  ]
}
```

**Quick Setup:**
1. Go to AWS IAM Console → Users → Create User
2. Attach policy with above permissions (or create custom policy)
3. Go to Security Credentials → Create Access Key
4. Copy Access Key ID and Secret Access Key
5. Add to GitHub Secrets

#### Option 2: OIDC (Recommended - More Secure)

The workflow already has `id-token: write` permission configured, suggesting OIDC support. To migrate:

1. Create an IAM OIDC Identity Provider in AWS:
   - Provider URL: `https://token.actions.githubusercontent.com`
   - Audience: `sts.amazonaws.com`

2. Create an IAM Role with trust policy:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:OWNER/REPO:*"
        }
      }
    }
  ]
}
```

3. Update workflow to use OIDC (replace lines 132-137 and similar):
```yaml
- name: Configure AWS Credentials
  uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: arn:aws:iam::ACCOUNT_ID:role/GITHUB_ACTIONS_ROLE
    aws-region: ${{ env.AWS_REGION }}
```

4. Add secret: `AWS_ROLE_TO_ASSUME` with the role ARN

### Frontend Build Secrets

| Secret Name | Description | Required For | Example Value |
|------------|-------------|-------------|---------------|
| `PUBLIC_SERVER_URL` | Server URL for frontend build | Frontend build step (line 92) | `https://hyperscape-prod-alb.us-east-1.elb.amazonaws.com` |
| `PUBLIC_CDN_URL` | CDN URL for assets | Frontend build step (line 93) | `https://d1234567890.cloudfront.net` |

**Note:** These are used during the build process to configure the frontend. They should match your actual AWS infrastructure URLs. You can find these values in:
- `PUBLIC_SERVER_URL`: AWS Console → EC2 → Load Balancers → Your ALB → DNS name
- `PUBLIC_CDN_URL`: AWS Console → CloudFront → Your distribution → Domain name

## How to Configure Secrets in GitHub

1. Go to your GitHub repository
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add each secret listed above with its corresponding value
5. Click **Add secret**

## Verification Checklist

Use this checklist to verify all secrets are correctly configured:

- [ ] `AWS_ACCESS_KEY_ID` is set in GitHub Secrets
- [ ] `AWS_SECRET_ACCESS_KEY` is set in GitHub Secrets
- [ ] `PUBLIC_SERVER_URL` is set (matches your ALB URL)
- [ ] `PUBLIC_CDN_URL` is set (matches your CloudFront distribution URL)
- [ ] AWS IAM user/role has all required permissions
- [ ] Secrets are configured for the correct repository
- [ ] Access keys are active (not disabled in AWS)
- [ ] URLs are accessible and correct

## Testing Secrets

To verify secrets are configured correctly:

1. **Manual Test:**
   - Go to **Actions** → **Deploy to AWS** → **Run workflow**
   - Select environment (prod or staging)
   - Check workflow logs for authentication errors
   - Verify deployment succeeds

2. **Check Workflow Logs:**
   - Look for "Configure AWS Credentials" step - should succeed
   - Look for "Login to Amazon ECR" step - should succeed
   - Look for "Deploy to S3" step - should succeed
   - Any "Access Denied" errors indicate missing IAM permissions
   - Any "Secret not found" errors indicate missing GitHub secrets

3. **Verify URLs:**
   - Test `PUBLIC_SERVER_URL` in browser (should show server response)
   - Test `PUBLIC_CDN_URL` in browser (should serve assets)

## Security Best Practices

1. **Use OIDC instead of access keys** - More secure, no long-lived credentials
2. **Rotate secrets regularly** - Especially access keys
3. **Use least privilege** - Only grant necessary IAM permissions
4. **Monitor access** - Enable CloudTrail to audit AWS API calls
5. **Use separate secrets for staging/prod** - Consider using GitHub Environments

## Troubleshooting

### "Access Denied" Errors
- Verify IAM permissions are correct
- Check if access key is active
- Ensure region matches (`us-east-1`)

### "Secret not found" Errors
- Verify secret names match exactly (case-sensitive)
- Check repository settings → Secrets and variables → Actions

### Build Failures
- Verify `PUBLIC_SERVER_URL` and `PUBLIC_CDN_URL` are valid URLs
- Check that URLs are accessible (not blocked by firewall)

## Workflow Configuration

The deployment workflow (`.github/workflows/deploy-aws.yml`) uses these secrets in the following jobs:

### Build Job
- Uses: `PUBLIC_SERVER_URL`, `PUBLIC_CDN_URL` (lines 92-93)
- Purpose: Configure frontend build with correct URLs

### Deploy Server Job
- Uses: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (lines 135-136)
- Purpose: Authenticate with AWS, push Docker image to ECR, update ECS service

### Deploy Frontend Job
- Uses: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (lines 206-207)
- Purpose: Upload frontend build to S3, invalidate CloudFront cache

### Deploy Assets Job
- Uses: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (lines 262-263)
- Purpose: Upload game assets to S3, invalidate CloudFront cache

## Environment Handling

The workflow supports two environments:
- **prod** (default) - Used when triggered by push to main branch
- **staging** - Can be selected in manual workflow dispatch

When triggered by push, environment defaults to `prod`. When manually triggered, you can select `prod` or `staging`.

## Related Files

- `.github/workflows/deploy-aws.yml` - Main deployment workflow (uses all secrets)
- `infrastructure/main.tf` - AWS infrastructure definition
- `scripts/deploy-aws.mjs` - Local deployment script (uses AWS CLI credentials)
