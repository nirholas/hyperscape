# Deployment Issues Fixed

This document describes the issues found and fixes applied for AWS deployment.

## Issues Identified

### 1. TerrainSystem BIOMES Data Not Loaded Error

**Problem:** TerrainSystem.start() was being called before DataManager finished initializing BIOMES data, causing terrain generation to fail.

**Root Cause:** DataManager.initialize() happens asynchronously in registerSystems(), but TerrainSystem.start() was called immediately without waiting.

**Fix Applied:**
- Added wait logic in TerrainSystem.start() to check if DataManager is ready
- Waits up to 10 seconds for DataManager to initialize before proceeding
- Added proper error handling and logging

**File:** `packages/shared/src/systems/shared/world/TerrainSystem.ts`

### 2. CloudFront 403 Forbidden Errors

**Problem:** All asset requests from CloudFront were returning 403 Forbidden errors.

**Root Causes:**
1. Assets were being uploaded to `/assets/` prefix in S3, but code expects root paths
2. Hardcoded CloudFront domain in vite.config.ts might not match actual distribution
3. Assets may not have been uploaded to S3 yet

**Fixes Applied:**

1. **Deployment Script** (`scripts/deploy-aws.mjs`):
   - Changed S3 upload from `s3://bucket/assets` to `s3://bucket` (root)
   - Updated content type setting to work with root paths
   - Updated CloudFront invalidation to invalidate all paths (`/*` instead of `/assets/*`)

2. **Vite Config** (`packages/client/vite.config.ts`):
   - Removed hardcoded CloudFront domain
   - Now relies entirely on `PUBLIC_CDN_URL` environment variable
   - Deployment script sets this from Terraform outputs during build

3. **Server Asset Headers** (`packages/server/src/startup/http-server.ts`):
   - Added WASM MIME type (`application/wasm`) to `setAssetHeaders()` function
   - Ensures WASM files are served with correct Content-Type for streaming compilation

**Files Modified:**
- `scripts/deploy-aws.mjs`
- `packages/client/vite.config.ts`
- `packages/server/src/startup/http-server.ts`

### 3. Asset Path Resolution

**Problem:** Assets uploaded to `/assets/` prefix but code loads from root paths like `/manifests/`, `/models/`, `/world/`.

**Fix:** Updated deployment script to upload assets to S3 root, matching how the code expects paths.

## Deployment Checklist

Before deploying, ensure:

1. **Terraform Infrastructure:**
   ```bash
   cd infrastructure
   terraform init
   terraform plan
   terraform apply
   ```

2. **Get CloudFront Domain:**
   ```bash
   terraform output assets_cloudfront_domain
   ```

3. **Upload Assets:**
   ```bash
   node scripts/deploy-aws.mjs --assets
   ```
   This will:
   - Upload all assets from `assets/` directory to S3 root
   - Set correct Content-Type headers (including `application/wasm` for WASM files)
   - Invalidate CloudFront cache

4. **Build Frontend with Correct URLs:**
   ```bash
   # The deployment script automatically sets PUBLIC_CDN_URL from Terraform outputs
   node scripts/deploy-aws.mjs --frontend
   ```

5. **Verify Environment Variables:**
   - Check ECS task definition has all required env vars
   - Verify `PUBLIC_CDN_URL` points to CloudFront assets distribution
   - Verify `PUBLIC_API_URL` and `PUBLIC_WS_URL` are set correctly

## Testing After Deployment

1. **Check CloudFront Distribution:**
   - Verify assets are accessible: `https://<cloudfront-domain>/manifests/biomes.json`
   - Verify WASM files have correct MIME type: `curl -I https://<cloudfront-domain>/web/physx-js-webidl.wasm`
   - Should return `Content-Type: application/wasm`

2. **Check S3 Bucket:**
   - Verify assets are at root level (not under `/assets/` prefix)
   - Verify Content-Type metadata is set correctly for all file types

3. **Check ECS Logs:**
   - Verify DataManager initializes successfully
   - Verify TerrainSystem waits for DataManager
   - Check for any 403 errors in CloudWatch logs

## Common Issues and Solutions

### Issue: 403 Forbidden from CloudFront

**Possible Causes:**
1. Assets not uploaded to S3
2. S3 bucket policy not allowing CloudFront access
3. CloudFront distribution not properly configured
4. Assets uploaded to wrong path (`/assets/` instead of root)

**Solution:**
1. Run `node scripts/deploy-aws.mjs --assets` to upload assets
2. Verify S3 bucket policy allows CloudFront service principal
3. Check CloudFront distribution origin configuration
4. Verify assets are at root level in S3

### Issue: TerrainSystem BIOMES Error

**Possible Causes:**
1. DataManager not initialized before TerrainSystem.start()
2. Manifests not loading from CDN
3. Network issues preventing manifest fetch

**Solution:**
1. Check DataManager initialization in logs
2. Verify manifests are accessible from CDN
3. Check network connectivity to CloudFront

### Issue: WASM MIME Type Error

**Possible Causes:**
1. Server not setting correct Content-Type header
2. CloudFront not preserving Content-Type from S3

**Solution:**
1. Verify server sets `application/wasm` header (already fixed)
2. Verify S3 objects have correct Content-Type metadata
3. Check CloudFront response headers policy

## Next Steps

1. **Deploy Infrastructure:**
   ```bash
   cd infrastructure
   terraform apply
   ```

2. **Upload Assets:**
   ```bash
   node scripts/deploy-aws.mjs --assets
   ```

3. **Deploy Frontend:**
   ```bash
   node scripts/deploy-aws.mjs --frontend
   ```

4. **Deploy Server:**
   ```bash
   node scripts/deploy-aws.mjs --server
   ```

5. **Verify:**
   - Check CloudFront domain matches what's in ECS env vars
   - Test asset loading in browser
   - Check for any remaining 403 errors
