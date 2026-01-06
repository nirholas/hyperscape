# Troubleshooting CloudFront 403 Forbidden Errors

## Quick Fix

If you're seeing 403 Forbidden errors from CloudFront, run these commands in order:

```bash
# 1. Verify Terraform infrastructure is deployed
cd infrastructure
terraform apply

# 2. Upload assets to S3
cd ..
node scripts/deploy-aws.mjs --assets

# 3. Verify everything is working
node scripts/verify-cloudfront-assets.mjs
```

## Common Causes

### 1. Assets Not Uploaded to S3

**Symptoms:**
- All asset requests return 403 Forbidden
- S3 bucket is empty or missing key directories

**Fix:**
```bash
node scripts/deploy-aws.mjs --assets
```

This will:
- Upload all assets from `assets/` directory to S3 root
- Set correct Content-Type headers
- Invalidate CloudFront cache

### 2. S3 Bucket Policy Not Applied

**Symptoms:**
- Assets exist in S3 but CloudFront returns 403
- Bucket policy check fails

**Fix:**
```bash
cd infrastructure
terraform apply
```

This ensures:
- S3 bucket policy allows CloudFront access
- CloudFront distribution is properly configured
- Origin Access Control (OAC) is set up correctly

### 3. CloudFront Distribution Not Updated

**Symptoms:**
- Assets uploaded but still 403
- Bucket policy is correct

**Fix:**
```bash
# Option 1: Re-apply Terraform (updates CloudFront config)
cd infrastructure
terraform apply

# Option 2: Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id $(terraform -chdir=infrastructure output -raw assets_cloudfront_id) \
  --paths "/*"
```

### 4. Wrong CloudFront Domain

**Symptoms:**
- Using hardcoded domain that doesn't match actual distribution
- Assets accessible on different domain

**Fix:**
```bash
# Get the actual CloudFront domain
terraform -chdir=infrastructure output assets_cdn_url

# Update environment variables in ECS task definition
# Or rebuild frontend with correct CDN URL
node scripts/deploy-aws.mjs --frontend
```

## Verification Steps

### Step 1: Check S3 Bucket

```bash
# Get bucket name
BUCKET=$(terraform -chdir=infrastructure output -raw assets_bucket_name)

# List objects
aws s3 ls s3://$BUCKET/ --recursive | head -20

# Check for key directories
aws s3 ls s3://$BUCKET/manifests/
aws s3 ls s3://$BUCKET/models/
aws s3 ls s3://$BUCKET/terrain/
```

### Step 2: Check S3 Bucket Policy

```bash
BUCKET=$(terraform -chdir=infrastructure output -raw assets_bucket_name)

# Get bucket policy
aws s3api get-bucket-policy --bucket $BUCKET

# Should show policy allowing cloudfront.amazonaws.com service principal
```

### Step 3: Check CloudFront Distribution

```bash
# Get distribution ID
DIST_ID=$(terraform -chdir=infrastructure output -raw assets_cloudfront_id)

# Get distribution config
aws cloudfront get-distribution --id $DIST_ID

# Check origin configuration
aws cloudfront get-distribution-config --id $DIST_ID | jq '.DistributionConfig.Origins.Items[0]'
```

### Step 4: Test CloudFront Access

```bash
# Get CloudFront domain
DOMAIN=$(terraform -chdir=infrastructure output -raw assets_cloudfront_domain)

# Test access
curl -I "https://$DOMAIN/manifests/biomes.json"
curl -I "https://$DOMAIN/terrain/textures/dirt/dirt_d.png"
```

Expected: `HTTP/2 200` or `HTTP/2 304`
If you see `HTTP/2 403`: Assets aren't uploaded or bucket policy is wrong

## Automated Verification

Use the verification script:

```bash
node scripts/verify-cloudfront-assets.mjs
```

This will check:
- ✅ S3 bucket has assets
- ✅ Bucket policy allows CloudFront
- ✅ CloudFront can access assets

## Manual Fix Steps

If automated fixes don't work:

### 1. Re-upload Assets

```bash
# Get bucket name
BUCKET=$(terraform -chdir=infrastructure output -raw assets_bucket_name)

# Upload assets
aws s3 sync assets/ s3://$BUCKET/ --delete --region us-east-1

# Set content types
aws s3 cp s3://$BUCKET s3://$BUCKET --recursive \
  --exclude "*" --include "*.wasm" \
  --metadata-directive REPLACE \
  --content-type "application/wasm" \
  --cache-control "public, max-age=31536000" \
  --region us-east-1
```

### 2. Re-apply Bucket Policy

```bash
cd infrastructure
terraform apply -target=aws_s3_bucket_policy.assets
```

### 3. Update CloudFront Distribution

```bash
cd infrastructure
terraform apply -target=aws_cloudfront_distribution.assets
```

### 4. Invalidate CloudFront Cache

```bash
DIST_ID=$(terraform -chdir=infrastructure output -raw assets_cloudfront_id)
aws cloudfront create-invalidation \
  --distribution-id $DIST_ID \
  --paths "/*" \
  --region us-east-1
```

## Expected File Structure in S3

Assets should be at the **root** of the S3 bucket (not under `/assets/`):

```
s3://hyperscape-prod-assets/
├── manifests/
│   ├── biomes.json
│   ├── items.json
│   ├── music.json
│   └── ...
├── models/
│   ├── goblin/
│   ├── sword-steel/
│   └── ...
├── terrain/
│   └── textures/
│       ├── dirt/
│       ├── stylized_grass/
│       └── ...
└── ...
```

## Still Not Working?

1. **Check CloudWatch Logs:**
   ```bash
   # Check CloudFront access logs (if enabled)
   aws cloudfront list-distributions --query "DistributionList.Items[?Id=='$DIST_ID']"
   ```

2. **Verify IAM Permissions:**
   - Ensure your AWS credentials have permissions to:
     - `s3:PutObject`, `s3:GetObject` on the assets bucket
     - `cloudfront:CreateInvalidation`
     - `cloudfront:GetDistribution`

3. **Check Terraform State:**
   ```bash
   cd infrastructure
   terraform state list | grep assets
   terraform state show aws_s3_bucket.assets
   terraform state show aws_cloudfront_distribution.assets
   ```

4. **Contact Support:**
   - Share output of `node scripts/verify-cloudfront-assets.mjs`
   - Share CloudFront distribution ID
   - Share S3 bucket name
