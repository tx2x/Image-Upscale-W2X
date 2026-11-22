#!/usr/bin/env sh
# Image Upscale W2X launcher (Linux / macOS)
#   ./start.sh              local only (default)
#   ./start.sh --network    share on your local network
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18 or newer is required. Get it from https://nodejs.org/ or your package manager."
  exit 1
fi

# First run only (needs internet): install dependencies and the engine.
# Models are downloaded later, from the web interface.
if [ ! -d node_modules ]; then
  echo "First run: installing dependencies..."
  npm install --omit=dev --no-audit --no-fund || exit 1
fi
if [ ! -x bin/realesrgan-ncnn-vulkan ]; then
  node scripts/setup.js || exit 1
fi

exec node server.js "$@"
