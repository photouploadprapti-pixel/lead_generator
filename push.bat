@echo off
git init
git add .
git commit -m "Initial commit with Netlify Functions"
git branch -M main
git remote add origin https://github.com/photouploadprapti-pixel/projshivmark.git
git push -u origin main --force
