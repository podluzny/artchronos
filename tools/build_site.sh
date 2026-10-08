#!/bin/sh
# Собирает статический сайт SDD-документации (docsify) в каталог DEST (по умолчанию public/sdd).
# README.md копируется как home.md, сайдбар — как sidebar.md (обычные имена файлов для хостинга).
set -eu
cd "$(dirname "$0")/.."
DEST="${1:-public/sdd}"
rm -rf "$DEST"
mkdir -p "$DEST"
cp index.html "$DEST/"
cp -R assets docs specs scenarios tasks decisions validation "$DEST/"
cp README.md "$DEST/home.md"
cp _sidebar.md "$DEST/sidebar.md"
sed -i.bak 's#(/README.md)#(/home.md)#' "$DEST/sidebar.md" && rm -f "$DEST/sidebar.md.bak"
echo "site built in $DEST: $(find "$DEST" -type f | wc -l) files"
