#!/usr/bin/env node
/**
 * Verify GitHub Secrets for AWS Deployment
 * 
 * Checks that all required secrets are set in GitHub and validates AWS credentials
 */

import { execSync } from "child_process";

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  bright: "\x1b[1m",
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✓ ${message}`, colors.green);
}

function logError(message) {
  log(`✗ ${message}`, colors.red);
}

function logWarning(message) {
  log(`⚠ ${message}`, colors.yellow);
}

function logInfo(message) {
  log(`ℹ ${message}`, colors.cyan);
}

// Required secrets for deployment
const REQUIRED_SECRETS = [
  {
    name: "AWS_ACCESS_KEY_ID",
    required: true,
    description: "AWS access key ID for GitHub Actions",
    usedIn: "All deployment jobs (ECR, ECS, S3, CloudFront)",
  },
  {
    name: "AWS_SECRET_ACCESS_KEY",
    required: true,
    description: "AWS secret access key for GitHub Actions",
    usedIn: "All deployment jobs (ECR, ECS, S3, CloudFront)",
  },
];

// Optional secrets (set but may not be used in workflow)
const OPTIONAL_SECRETS = [
  {
    name: "PUBLIC_CDN_URL",
    required: false,
    description: "CDN URL for assets (hardcoded in workflow but kept as secret)",
    usedIn: "Documentation only - workflow hardcodes URLs",
  },
  {
    name: "PUBLIC_SERVER_URL",
    required: false,
    description: "Server URL (hardcoded in workflow but kept as secret)",
    usedIn: "Documentation only - workflow hardcodes URLs",
  },
];

async function main() {
  console.log(`
${colors.bright}${colors.cyan}
╔══════════════════════════════════════════════════════════════════╗
║            GitHub Secrets Verification for Deployment             ║
╚══════════════════════════════════════════════════════════════════╝
${colors.reset}
`);

  // Get repo name
  let repo;
  try {
    repo = execSync("gh repo view --json nameWithOwner -q .nameWithOwner", {
      encoding: "utf-8",
    }).trim();
    logInfo(`Repository: ${repo}`);
  } catch (error) {
    logError("Failed to get repository name. Make sure you're in a git repo with gh CLI configured.");
    process.exit(1);
  }

  // List all secrets
  log("\n📋 Checking GitHub secrets...\n");
  let secretsList;
  try {
    secretsList = execSync(`gh secret list --repo ${repo}`, {
      encoding: "utf-8",
    });
  } catch (error) {
    logError("Failed to list GitHub secrets. Make sure gh CLI is authenticated.");
    process.exit(1);
  }

  const secretsMap = new Map();
  const lines = secretsList.split("\n").filter((line) => line.trim());
  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length >= 1) {
      secretsMap.set(parts[0], true);
    }
  }

  // Check required secrets
  log(`${colors.bright}Required Secrets:${colors.reset}\n`);
  let allRequiredPresent = true;
  for (const secret of REQUIRED_SECRETS) {
    if (secretsMap.has(secret.name)) {
      logSuccess(`${secret.name} - Set`);
      log(`   ${secret.description}`);
      log(`   Used in: ${secret.usedIn}\n`);
    } else {
      logError(`${secret.name} - MISSING`);
      log(`   ${secret.description}`);
      log(`   Used in: ${secret.usedIn}\n`);
      allRequiredPresent = false;
    }
  }

  // Check optional secrets
  log(`${colors.bright}Optional Secrets:${colors.reset}\n`);
  for (const secret of OPTIONAL_SECRETS) {
    if (secretsMap.has(secret.name)) {
      logSuccess(`${secret.name} - Set (optional)`);
      log(`   ${secret.description}\n`);
    } else {
      logWarning(`${secret.name} - Not set (optional, workflow hardcodes values)`);
      log(`   ${secret.description}\n`);
    }
  }

  // Verify AWS IAM user exists
  log(`${colors.bright}Verifying AWS IAM Configuration:${colors.reset}\n`);
  try {
    const userName = execSync(
      "aws iam get-user --user-name hyperscape-prod-github-actions --query 'User.UserName' --output text",
      { encoding: "utf-8" }
    ).trim();

    if (userName === "hyperscape-prod-github-actions") {
      logSuccess(`IAM user exists: ${userName}`);

      // Check policies
      const policies = execSync(
        "aws iam list-attached-user-policies --user-name hyperscape-prod-github-actions --query 'AttachedPolicies[*].PolicyName' --output text",
        { encoding: "utf-8" }
      ).trim();

      if (policies.includes("hyperscape-prod-github-actions-deploy")) {
        logSuccess("IAM policy attached: hyperscape-prod-github-actions-deploy");
      } else {
        logWarning("IAM policy may not be attached correctly");
      }
    }
  } catch (error) {
    logWarning("Could not verify IAM user (may need AWS CLI configured)");
  }

  // Summary
  console.log(`\n${colors.bright}${colors.cyan}╔══════════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}║                         Summary                                  ║${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}╚══════════════════════════════════════════════════════════════════╝${colors.reset}\n`);

  if (allRequiredPresent) {
    logSuccess("All required secrets are configured!");
    log("\n✅ GitHub Actions deployment should work once infrastructure is deployed.\n");
    log("Next steps:");
    log("  1. Deploy infrastructure: cd infrastructure && terraform apply");
    log("  2. Test deployment: Push to main or manually trigger workflow");
  } else {
    logError("Some required secrets are missing!");
    log("\nTo set missing secrets, run:");
    log("  gh secret set AWS_ACCESS_KEY_ID --body '<value>' --repo " + repo);
    log("  gh secret set AWS_SECRET_ACCESS_KEY --body '<value>' --repo " + repo);
    log("\nOr use the setup script:");
    log("  bash scripts/setup-github-secrets.sh\n");
    process.exit(1);
  }

  // Check workflow URLs
  log("\n📝 Note: The workflow hardcodes these URLs in the build step:");
  log("   PUBLIC_CDN_URL: https://d20g7vd4m53hpb.cloudfront.net");
  log("   PUBLIC_API_URL: https://api.hyperscape.lol");
  log("   PUBLIC_WS_URL: wss://api.hyperscape.lol/ws");
  log("   PUBLIC_APP_URL: https://hyperscape.lol");
  log("\n   These should match your actual deployed infrastructure.\n");
}

main().catch((error) => {
  logError(`Verification failed: ${error.message}`);
  process.exit(1);
});
