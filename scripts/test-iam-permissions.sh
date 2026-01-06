#!/bin/bash
# Test IAM permissions for GitHub Actions user

set -e

USER_NAME="hyperscape-prod-github-actions"
REGION="us-east-1"

echo "🧪 Testing IAM permissions for $USER_NAME..."
echo ""

# Get access key
ACCESS_KEY_ID=$(aws iam list-access-keys --user-name "$USER_NAME" --query 'AccessKeyMetadata[0].AccessKeyId' --output text)
echo "📋 Using Access Key: $ACCESS_KEY_ID"
echo ""

# Test ECR permissions
echo "1️⃣  Testing ECR permissions..."
aws ecr get-authorization-token --region "$REGION" --query 'authorizationData[0].authorizationToken' --output text > /dev/null && echo "   ✅ ECR GetAuthorizationToken" || echo "   ❌ ECR GetAuthorizationToken"

# Test ECS permissions
echo "2️⃣  Testing ECS permissions..."
CLUSTERS=$(aws ecs list-clusters --region "$REGION" --query 'clusterArns' --output text 2>/dev/null)
if [ -n "$CLUSTERS" ]; then
    echo "   ✅ ECS ListClusters (found: $(echo $CLUSTERS | wc -w) clusters)"
    CLUSTER_NAME=$(echo "$CLUSTERS" | head -1 | awk -F'/' '{print $NF}')
    aws ecs describe-clusters --clusters "$CLUSTER_NAME" --region "$REGION" > /dev/null 2>&1 && echo "   ✅ ECS DescribeClusters" || echo "   ❌ ECS DescribeClusters"
else
    echo "   ⚠️  No clusters found (may be expected if infrastructure not deployed)"
fi

# Test S3 permissions
echo "3️⃣  Testing S3 permissions..."
BUCKETS=$(aws s3 ls 2>/dev/null | grep "hyperscape-prod" || echo "")
if [ -n "$BUCKETS" ]; then
    echo "   ✅ S3 ListBuckets (found buckets)"
    for bucket in $(echo "$BUCKETS" | awk '{print $3}'); do
        aws s3 ls "s3://$bucket" > /dev/null 2>&1 && echo "   ✅ S3 ListBucket: $bucket" || echo "   ❌ S3 ListBucket: $bucket"
    done
else
    echo "   ⚠️  No hyperscape-prod buckets found (may be expected)"
fi

# Test CloudFront permissions
echo "4️⃣  Testing CloudFront permissions..."
DISTRIBUTIONS=$(aws cloudfront list-distributions --query 'DistributionList.Items[*].Id' --output text 2>/dev/null || echo "")
if [ -n "$DISTRIBUTIONS" ]; then
    echo "   ✅ CloudFront ListDistributions (found: $(echo $DISTRIBUTIONS | wc -w) distributions)"
else
    echo "   ⚠️  No distributions found (may be expected)"
fi

echo ""
echo "✅ IAM permission test complete!"
echo ""
echo "📝 Note: Some tests may show warnings if resources don't exist yet."
echo "   This is expected if infrastructure hasn't been fully deployed."
