# Feature 33: The Task Management switch (browser test)

**PASSED 26 Nov 2026** (parts 1–3), after the fixes in the changes doc's "Fixed after the browser test".

*On dev, during feature 27's test (Zz F27 Company). What changed: [33-task-management-permission-changes.md](33-task-management-permission-changes.md). The suite `taskperm` (23) checks the server; this is about the screens.*

## 1. The switch off
1. **Sign in as Zz F27 HR** (their switch was turned off in the test). Ctrl+F5.
   - The menu has **no Task Management**.
   - **My Task** is there and opens (added for HR and the Company Admin on 26 Nov; before, they had none).
2. **Type the Task Management address** (`/hrms/SuperAdmin/task-management`). The page says *"Task Management isn't switched on for you…"*

## 2. The switch on again
1. **As Zz F27 Admin (the Company Admin) → Roles & Permissions → edit Zz F27 HR:**
   - the row says **"Task Management (give and review KRA tasks)"**, with the amber line under it
   - switch it on (View, Add, Edit, Delete) and save
2. **As Zz F27 HR, sign in again:**
   - **Task Management** is back in the menu
   - the board opens with **New task**

## 3. View only
1. **As the Company Admin,** leave only **View** on for Zz F27 HR.
2. **As HR:** the board opens, without **New task**.

## 4. A Head's list
1. **On test-1 as the Company Admin, Roles & Permissions → edit a Production Head:** the Production module now lists **Task Management** (on, from the one-time fix).
