#!/usr/bin/env bash
# Builds the marketing site and help docs and zips each one for upload to cPanel:
# relistic-website.zip goes in public_html (getrelistic.com), relistic-docs.zip in the
# doc.getrelistic.com folder. See website/README.md.
set -euo pipefail
node website/build.mjs
rm -f relistic-website.zip relistic-docs.zip
(cd website/dist/site && zip -qr ../../../relistic-website.zip .)
(cd website/dist/docs && zip -qr ../../../relistic-docs.zip .)
echo "Built relistic-website.zip and relistic-docs.zip"
