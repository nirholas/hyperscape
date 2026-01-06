#!/usr/bin/env node
/**
 * Verify CloudFront Assets Deployment
 * 
 * Checks if assets are accessible via CloudFront and provides troubleshooting steps.
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

function checkS3Bucket(bucketName) {
  console.log(`\n📦 Checking S3 bucket: ${bucketName}`);
  
  // List objects in bucket
  try {
    const result = exec(`aws s3 ls s3://${bucketName}/ --recursive --summarize`, { silent: true });
    const lines = result.split("\n");
    const totalLine = lines.find(line => line.includes("Total Objects"));
    if (totalLine) {
      console.log(`✅ ${totalLine}`);
    } else {
      console.log("⚠️  Could not determine object count");
    }
    
    // Check for key directories
    const hasManifests = result.includes("manifests/");
    const hasModels = result.includes("models/");
    const hasTerrain = result.includes("terrain/");
    
    console.log(`   - manifests/: ${hasManifests ? "✅" : "❌"}`);
    console.log(`   - models/: ${hasModels ? "✅" : "❌"}`);
    console.log(`   - terrain/: ${hasTerrain ? "✅" : "❌"}`);
    
    if (!hasManifests || !hasModels || !hasTerrain) {
      console.log("\n⚠️  Assets appear to be missing. Run: node scripts/deploy-aws.mjs --assets");
      return false;
    }
    
    return true;
  } catch (error) {
    console.log(`❌ Error checking S3 bucket: ${error.message}`);
    return false;
  }
}

function checkCloudFrontAccess(distributionDomain) {
  console.log(`\n🌐 Checking CloudFront access: ${distributionDomain}`);
  
  const testUrls = [
    "/manifests/biomes.json",
    "/manifests/music.json",
    "/terrain/textures/dirt/dirt_d.png",
  ];
  
  let allPassed = true;
  
  for (const path of testUrls) {
    const url = `https://${distributionDomain}${path}`;
    try {
      const result = exec(`curl -I -s "${url}"`, { silent: true });
      const statusLine = result.split("\n").find(line => line.startsWith("HTTP"));
      
      if (statusLine && statusLine.includes("200")) {
        console.log(`✅ ${path}`);
      } else if (statusLine && statusLine.includes("403")) {
        console.log(`❌ ${path} - 403 Forbidden`);
        allPassed = false;
      } else if (statusLine && statusLine.includes("404")) {
        console.log(`❌ ${path} - 404 Not Found`);
        allPassed = false;
      } else {
        console.log(`⚠️  ${path} - ${statusLine || "Unknown status"}`);
        allPassed = false;
      }
    } catch (error) {
      console.log(`❌ ${path} - Error: ${error.message}`);
      allPassed = false;
    }
  }
  
  return allPassed;
}

function checkBucketPolicy(bucketName) {
  console.log(`\n🔐 Checking S3 bucket policy: ${bucketName}`);
  
  try {
    const result = exec(`aws s3api get-bucket-policy --bucket ${bucketName}`, { silent: true });
    const policy = JSON.parse(result);
    const policyDoc = JSON.parse(policy.Policy);
    
    const hasCloudFrontAccess = policyDoc.Statement.some(
      stmt => stmt.Principal?.Service === "cloudfront.amazonaws.com"
    );
    
    if (hasCloudFrontAccess) {
      console.log("✅ Bucket policy allows CloudFront access");
      return true;
    } else {
      console.log("❌ Bucket policy does not allow CloudFront access");
      return false;
    }
  } catch (error) {
    console.log(`❌ Error checking bucket policy: ${error.message}`);
    console.log("   This might mean the policy doesn't exist yet.");
    return false;
  }
}

async function main() {
  console.log("🔍 Verifying CloudFront Assets Deployment\n");
  
  const bucketName = getTerraformOutput("assets_bucket_name");
  const distributionDomain = getTerraformOutput("assets_cloudfront_domain");
  
  if (!bucketName) {
    console.log("❌ Could not get assets bucket name from Terraform");
    console.log("   Run: cd infrastructure && terraform output assets_bucket_name");
    process.exit(1);
  }
  
  if (!distributionDomain) {
    console.log("❌ Could not get CloudFront domain from Terraform");
    console.log("   Run: cd infrastructure && terraform output assets_cloudfront_domain");
    process.exit(1);
  }
  
  console.log(`Bucket: ${bucketName}`);
  console.log(`CloudFront: ${distributionDomain}`);
  
  // Check S3 bucket
  const s3Ok = checkS3Bucket(bucketName);
  
  // Check bucket policy
  const policyOk = checkBucketPolicy(bucketName);
  
  // Check CloudFront access
  const cloudfrontOk = checkCloudFrontAccess(distributionDomain);
  
  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 Summary:");
  console.log(`   S3 Bucket: ${s3Ok ? "✅" : "❌"}`);
  console.log(`   Bucket Policy: ${policyOk ? "✅" : "❌"}`);
  console.log(`   CloudFront Access: ${cloudfrontOk ? "✅" : "❌"}`);
  
  if (!s3Ok) {
    console.log("\n💡 Fix: Upload assets to S3");
    console.log("   Run: node scripts/deploy-aws.mjs --assets");
  }
  
  if (!policyOk) {
    console.log("\n💡 Fix: Apply Terraform to create bucket policy");
    console.log("   Run: cd infrastructure && terraform apply");
  }
  
  if (!cloudfrontOk && s3Ok && policyOk) {
    console.log("\n💡 Fix: CloudFront may need cache invalidation or distribution update");
    console.log("   Run: node scripts/deploy-aws.mjs --assets");
    console.log("   Or: cd infrastructure && terraform apply");
  }
  
  if (s3Ok && policyOk && cloudfrontOk) {
    console.log("\n✅ All checks passed! Assets should be accessible.");
  } else {
    console.log("\n❌ Some checks failed. Follow the fixes above.");
    process.exit(1);
  }
}

main().catch(console.error);
