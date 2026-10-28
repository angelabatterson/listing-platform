#!/usr/bin/env bash
# Builds relistic-cpanel.zip: the app ready to upload to a cPanel "Setup Node.js App"
# folder, with nothing to install on the server. Run from the repo root.
set -euo pipefail

npm run build

out=.next/standalone
# Public files (favicon etc.), if the project has any.
if [ -d public ]; then cp -r public "$out/"; fi
mkdir -p "$out/.next"
cp -r .next/static "$out/.next/"
# Database changes, applied when the app starts (MIGRATE_ON_START below).
cp -r drizzle "$out/"

# cPanel's Node.js app tool starts this file. It turns on start-up migrations and
# hands over to Next.js's own server.
cat > "$out/app.js" <<'JS'
process.env.MIGRATE_ON_START ??= "true";
process.env.NODE_ENV = "production";
require("./server.js");
JS

rm -f relistic-cpanel.zip
(cd "$out" && zip -qr ../../relistic-cpanel.zip . -x ".env*")
echo "Built relistic-cpanel.zip"
