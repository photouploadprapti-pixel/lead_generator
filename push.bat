@echo off
git add .
git commit -m "feat(hosting): migrate serverless functions from Netlify to Vercel"
git branch -M main
git remote add origin https://github.com/photouploadprapti-pixel/lead_generator.git 2>nul
git push -u origin main
