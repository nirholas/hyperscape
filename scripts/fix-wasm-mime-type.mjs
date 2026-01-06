#!/usr/bin/env node
/**
 * Fix WASM MIME Type in S3
 * 
 * Ensures all WASM files in S3 have the correct Content-Type: application/wasm
 * This is critical for WebAssembly streaming compilation to work.
 */

import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, "..");

function exec(command, options = {}) {
  try {
    return execSync(command, {
      cwd: ROOT_DIR,
      encoding: "utf-8",
      stdio: options.silent ? "pipe" : "inherit",
      ...options,
    });
  } catch (error) {
    if (!options.ignoreError) {
      throw error;
    }
    return null;
  }
}

function getTerraformOutput(name) {
  try {
    const result = exec(`terraform -chdir=infrastructure output -raw ${name}`, { silent: true });
    return result?.trim();
  } catch {
    return null;
  }
}

async function main() {
  console.log("🔧 Fixing WASM MIME Type in S3\n");
  
  const bucketName = getTerraformOutput("assets_bucket_name");
  const region = "us-east-1";
  
  if (!bucketName) {
    console.error("❌ Could not get assets bucket name from Terraform");
    console.error("   Run: cd infrastructure && terraform output assets_bucket_name");
    process.exit(1);
  }
  
  console.log(`Bucket: ${bucketName}`);
  console.log(`Region: ${region}\n`);
  
  // Step 1: List all WASM files
  console.log("📋 Finding all WASM files...");
  const listResult = exec(
    `aws s3 ls s3://${bucketName}/ --recursive --region ${region}`,
    { silent: true }
  );
  
  const wasmFiles = listResult
    .split("\n")
    .filter(line => line.includes(".wasm"))
    .map(line => {
      const parts = line.trim().split(/\s+/);
      return parts[parts.length - 1]; // Last part is the key
    })
    .filter(Boolean);
  
  if (wasmFiles.length === 0) {
    console.log("⚠️  No WASM files found in S3 bucket");
    console.log("   Run: node scripts/deploy-aws.mjs --assets");
    process.exit(1);
  }
  
  console.log(`Found ${wasmFiles.length} WASM file(s):`);
  wasmFiles.forEach(file => console.log(`   - ${file}`));
  
  // Step 2: Check current Content-Type
  console.log("\n🔍 Checking current Content-Type...");
  for (const file of wasmFiles) {
    try {
      const metadata = exec(
        `aws s3api head-object --bucket ${bucketName} --key "${file}" --region ${region}`,
        { silent: true }
      );
      const obj = JSON.parse(metadata);
      const contentType = obj.ContentType || "not set";
      
      if (contentType === "application/wasm") {
        console.log(`✅ ${file}: ${contentType}`);
      } else {
        console.log(`❌ ${file}: ${contentType} (should be application/wasm)`);
      }
    } catch (error) {
      console.log(`⚠️  ${file}: Could not check metadata`);
    }
  }
  
  // Step 3: Fix Content-Type for all WASM files
  console.log("\n🔧 Setting Content-Type to application/wasm...");
  const command = `aws s3 cp s3://${bucketName} s3://${bucketName} --recursive --exclude "*" --include "*.wasm" --metadata-directive REPLACE --content-type "application/wasm" --cache-control "public, max-age=31536000" --region ${region}`;
  
  try {
    exec(command, { silent: false });
    console.log("\n✅ Content-Type updated for all WASM files");
  } catch (error) {
    console.error("\n❌ Failed to update Content-Type:", error.message);
    process.exit(1);
  }
  
  // Step 4: Verify fix
  console.log("\n✅ Verifying fix...");
  for (const file of wasmFiles) {
    try {
      const metadata = exec(
        `aws s3api head-object --bucket ${bucketName} --key "${file}" --region ${region}`,
        { silent: true }
      );
      const obj = JSON.parse(metadata);
      const contentType = obj.ContentType;
      
      if (contentType === "application/wasm") {
        console.log(`✅ ${file}: ${contentType}`);
      } else {
        console.log(`❌ ${file}: ${contentType} (still incorrect!)`);
        process.exit(1);
      }
    } catch (error) {
      console.log(`⚠️  ${file}: Could not verify`);
    }
  }
  
  // Step 5: Invalidate CloudFront cache
  console.log("\n🔄 Invalidating CloudFront cache...");
  const distributionId = getTerraformOutput("assets_cloudfront_id");
  
  if (distributionId) {
    try {
      exec(
        `aws cloudfront create-invalidation --distribution-id ${distributionId} --paths "/web/*.wasm" --region us-east-1`,
        { silent: false }
      );
      console.log("✅ CloudFront cache invalidated");
    } catch (error) {
      console.log("⚠️  Failed to invalidate CloudFront cache:", error.message);
    }
  } else {
    console.log("⚠️  Could not get CloudFront distribution ID");
  }
  
  console.log("\n✅ Done! WASM files should now have correct MIME type.");
  console.log("\n💡 Note: It may take a few minutes for CloudFront to propagate the changes.");
}

main().catch(console.error);
