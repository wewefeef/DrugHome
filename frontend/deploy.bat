@echo off
echo --- 1. Dang lay code moi nhat tu GitHub ---
git pull origin main

echo --- 2. Dang cai dat thu vien moi (neu co) ---
call npm install

echo --- 3. Dang Build lai ung dung ---
call npm run build

echo --- THANH CONG! Website da duoc cap nhat ---
pause