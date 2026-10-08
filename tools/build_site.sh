#!/bin/sh
# Собирает статический сайт документации в public/ для Vercel.
# README.md копируется как home.md, сайдбар — как sidebar.md: обычные имена файлов,
# без зависимости от того, как хостинг обращается с README и файлами на "_".
set -eu
cd "$(dirname "$0")/.."
rm -rf public
mkdir -p public
cp index.html public/
cp -R assets docs specs scenarios tasks decisions validation public/
cp README.md public/home.md
cp _sidebar.md public/sidebar.md
sed -i.bak 's#(/README.md)#(/home.md)#' public/sidebar.md && rm -f public/sidebar.md.bak
echo "site built: $(find public -type f | wc -l) files"
