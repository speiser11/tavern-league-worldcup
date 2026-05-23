@echo off
git add .
git commit -m "Update %date% %time%"
git push origin main
echo Done. Site live at https://loganthein.github.io/worldcup-elite-fantasy/
