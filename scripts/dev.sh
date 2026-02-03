#!/bin/bash
# Hyperscape Development Server Startup Script
# Starts all services in the correct order for local/Codespaces development

set -e

echo "============================================================"
echo "🚀 Starting Hyperscape Development Environment"
echo "============================================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Kill any existing processes on our ports
echo -e "${YELLOW}Cleaning up existing processes...${NC}"
pkill -f "bun build/index.js" 2>/dev/null || true
pkill -f "vite --host --port 3333" 2>/dev/null || true
sleep 1

# Navigate to workspace root
cd /workspaces/hyperscape

# Step 1: Build shared package (if needed)
echo -e "${YELLOW}Step 1/4: Checking shared package...${NC}"
if [ ! -d "packages/shared/build" ]; then
    echo "Building shared package..."
    cd packages/shared
    bun scripts/build.mjs
    cd ../..
else
    echo -e "${GREEN}✓ Shared package already built${NC}"
fi

# Step 2: Build server
echo -e "${YELLOW}Step 2/4: Building server...${NC}"
cd packages/server
bunx esbuild src/index.ts --outfile=build/index.js --platform=node --format=esm --bundle --packages=external --sourcemap --target=node22
echo -e "${GREEN}✓ Server built${NC}"

# Step 3: Start server in background
echo -e "${YELLOW}Step 3/4: Starting game server (port 5555)...${NC}"
bun build/index.js &
SERVER_PID=$!
echo -e "${GREEN}✓ Server started (PID: $SERVER_PID)${NC}"

# Wait for server to be ready
sleep 3

# Step 4: Start client dev server
echo -e "${YELLOW}Step 4/4: Starting client dev server (port 3333)...${NC}"
cd ../client
bun run dev &
CLIENT_PID=$!
echo -e "${GREEN}✓ Client started (PID: $CLIENT_PID)${NC}"

echo ""
echo "============================================================"
echo -e "${GREEN}✅ Hyperscape Development Environment Ready${NC}"
echo "============================================================"
echo ""
echo "  🎮 Client:  http://localhost:3333"
echo "  🖥️  Server:  http://localhost:5555"
echo "  🗄️  DB:      PostgreSQL on port 5432"
echo ""
echo "  Press Ctrl+C to stop all services"
echo ""

# Trap Ctrl+C to cleanup
cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down...${NC}"
    kill $CLIENT_PID 2>/dev/null || true
    kill $SERVER_PID 2>/dev/null || true
    echo -e "${GREEN}✓ All services stopped${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM

# Wait for processes
wait
