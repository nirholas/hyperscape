# Environment Variables Configuration

This document describes all environment variables used in the Hyperscape AWS deployment and where they are configured.

## Server-Side Environment Variables (ECS Task Definition)

These are set in `infrastructure/main.tf` in the ECS task definition:

### Core Configuration
- `PORT` - Server port (default: `5555`)
- `NODE_ENV` - Environment (`prod`, `staging`, `dev`)

### CDN and Asset URLs
- `PUBLIC_CDN_URL` - CloudFront distribution URL for game assets
  - Set to: `https://${aws_cloudfront_distribution.assets.domain_name}`
  - Example: `https://d20g7vd4m53hpb.cloudfront.net`

### Application URLs
- `PUBLIC_APP_URL` - Frontend application URL
  - Set to: `https://hyperscape.lol`
- `CLIENT_URL` - Client application URL (alias for PUBLIC_APP_URL)
  - Set to: `https://hyperscape.lol`

### API URLs
- `PUBLIC_API_URL` - Game server HTTP API URL
  - Set to: `https://api.hyperscape.lol`
- `PUBLIC_WS_URL` - WebSocket URL for game server
  - Set to: `wss://api.hyperscape.lol/ws`
- `SERVER_URL` - Game server URL (same as PUBLIC_API_URL)
  - Set to: `https://api.hyperscape.lol`
- `SERVER_HOST` - Server hostname
  - Set to: `api.hyperscape.lol`
- `SERVER_PROTOCOL` - Server protocol
  - Set to: `https:`

### Plugin/Service URLs
- `HYPERSCAPE_SERVER_URL` - Hyperscape WebSocket URL (for plugins)
  - Set to: `wss://api.hyperscape.lol/ws`
- `ELIZAOS_URL` - ElizaOS API server URL
  - Defaults to: `https://api.hyperscape.lol` (if `elizaos_url` variable not set)
  - Can be overridden via `terraform.tfvars`: `elizaos_url = "https://elizaos.hyperscape.lol"`
- `ELIZAOS_API_URL` - ElizaOS API URL (alias for ELIZAOS_URL)
  - Same as `ELIZAOS_URL`
- `IMAGE_SERVER_URL` - Image server URL for asset-forge
  - Defaults to: `https://api.hyperscape.lol` (if `image_server_url` variable not set)
  - Can be overridden via `terraform.tfvars`: `image_server_url = "https://assets-api.hyperscape.lol"`

### Database Configuration
- `USE_LOCAL_POSTGRES` - Disable local PostgreSQL
  - Set to: `false`
- `POSTGRES_HOST` - PostgreSQL hostname
  - Set to: `${aws_db_instance.main.address}` (RDS endpoint hostname)
- `DATABASE_URL` - Full PostgreSQL connection string (stored in Secrets Manager)
  - Format: `postgresql://${db_username}:${db_password}@${rds_endpoint}/${db_name}?sslmode=no-verify`

## Secrets (Stored in AWS Secrets Manager)

These are stored securely in AWS Secrets Manager and referenced in the ECS task definition:

- `DATABASE_URL` - PostgreSQL connection string
- `ANTHROPIC_API_KEY` - Anthropic API key for AI features
- `PRIVY_APP_ID` - Privy App ID for authentication
- `PRIVY_APP_SECRET` - Privy App Secret
- `LIVEKIT_API_KEY` - LiveKit API key for voice chat
- `LIVEKIT_API_SECRET` - LiveKit API secret
- `JWT_SECRET` - JWT secret for token signing
- `ADMIN_CODE` - Admin code for protected endpoints

## Client-Side Environment Variables (Build Time)

These are set during the frontend build process in `packages/client/vite.config.ts`:

### Production Defaults (if env vars not set)
- `PUBLIC_API_URL` - `https://api.hyperscape.lol`
- `PUBLIC_WS_URL` - `wss://api.hyperscape.lol/ws`
- `PUBLIC_CDN_URL` - `https://d20g7vd4m53hpb.cloudfront.net` (should be updated after Terraform creates CloudFront)
- `PUBLIC_APP_URL` - `https://hyperscape.lol`

### Development Defaults
- `PUBLIC_API_URL` - `http://localhost:5555`
- `PUBLIC_WS_URL` - `ws://localhost:5555/ws`
- `PUBLIC_CDN_URL` - `http://localhost:8080`
- `PUBLIC_APP_URL` - `http://localhost:3333`

**Note:** To override production defaults, set these environment variables before building:
```bash
PUBLIC_API_URL=https://api.hyperscape.lol \
PUBLIC_WS_URL=wss://api.hyperscape.lol/ws \
PUBLIC_CDN_URL=https://<cloudfront-domain>.cloudfront.net \
PUBLIC_APP_URL=https://hyperscape.lol \
npm run build
```

## Terraform Variables

Optional variables that can be set in `terraform.tfvars`:

- `elizaos_url` - ElizaOS API server URL (if running separately)
- `image_server_url` - Image server URL for asset-forge (if running separately)

## Verification Checklist

After deploying, verify all environment variables are set correctly:

- [ ] `PUBLIC_CDN_URL` points to CloudFront assets distribution
- [ ] `PUBLIC_API_URL` points to API domain (api.hyperscape.lol)
- [ ] `PUBLIC_WS_URL` uses `wss://` protocol for secure WebSocket
- [ ] `PUBLIC_APP_URL` points to frontend domain (hyperscape.lol)
- [ ] `SERVER_URL` matches `PUBLIC_API_URL`
- [ ] `SERVER_HOST` is set correctly
- [ ] `SERVER_PROTOCOL` is `https:`
- [ ] `POSTGRES_HOST` points to RDS endpoint
- [ ] `HYPERSCAPE_SERVER_URL` uses `wss://` protocol
- [ ] `ELIZAOS_URL` is set (or defaults to API URL)
- [ ] `IMAGE_SERVER_URL` is set (or defaults to API URL)
- [ ] All secrets are stored in Secrets Manager
- [ ] Frontend build uses correct production URLs

## Updating Environment Variables

To update environment variables:

1. **Server-side**: Update `infrastructure/main.tf` and run `terraform apply`
2. **Client-side**: Update `packages/client/vite.config.ts` or set env vars during build
3. **Secrets**: Update `infrastructure/main.tf` secrets section and run `terraform apply`

## Important Notes

- All URLs in production should use `https://` (except WebSocket which uses `wss://`)
- WebSocket URLs must use `wss://` protocol for secure connections
- The CloudFront domain for `PUBLIC_CDN_URL` is created by Terraform and should be updated in vite.config.ts after first deployment
- Secrets are stored securely in AWS Secrets Manager and never exposed in environment variables
- Environment variables are case-sensitive
