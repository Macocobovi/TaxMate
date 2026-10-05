# Taxmate — Complete Beginner Setup Guide (Windows)

**Who this is for:** someone who has never set up a software project before, on a Windows 10 or Windows 11 laptop.

**What you will end up with:**

1. Every tool this project needs, installed on your machine.
2. A copy of the Taxmate code on your computer, disconnected from the original owner's GitHub account.
3. Your own GitHub repository containing that code, pushed and live.
4. The app running locally: a website at `http://localhost:3000` and an API at `http://localhost:4000`.

**Time needed:** about 60–90 minutes, most of it waiting on downloads.

**How to use this guide:** do the steps in order. Every grey box is a command — copy it, paste it into the terminal, press Enter, wait for it to finish before moving to the next one. Do not skip steps.

---

## Table of contents

- [Part 0 — Words you need to know](#part-0--words-you-need-to-know)
- [Part 1 — Install the tools](#part-1--install-the-tools)
- [Part 2 — Get the code onto your computer](#part-2--get-the-code-onto-your-computer)
- [Part 3 — Remove the original owner's Git and start your own](#part-3--remove-the-original-owners-git-and-start-your-own)
- [Part 4 — Create your GitHub repo and push](#part-4--create-your-github-repo-and-push)
- [Part 5 — Install the project's dependencies](#part-5--install-the-projects-dependencies)
- [Part 6 — Configuration files (.env)](#part-6--configuration-files-env)
- [Part 7 — Set up the database](#part-7--set-up-the-database)
- [Part 8 — Run the app](#part-8--run-the-app)
- [Part 9 — Optional: the smart contracts](#part-9--optional-the-smart-contracts)
- [Part 10 — Saving your future work to GitHub](#part-10--saving-your-future-work-to-github)
- [Troubleshooting](#troubleshooting)
- [Command cheat sheet](#command-cheat-sheet)

---

## Part 0 — Words you need to know

Read this once. It will make the rest of the guide make sense.

| Word | What it actually means |
|---|---|
| **Terminal / PowerShell** | A window where you type commands instead of clicking buttons. Windows comes with one called **PowerShell**. |
| **Git** | A program that tracks every change to the code. It is not GitHub. |
| **GitHub** | A website that stores copies of Git projects online. |
| **Repository ("repo")** | One project folder that Git is tracking. |
| **Clone** | Download a copy of a repo from GitHub to your computer. |
| **Commit** | A saved snapshot of your changes. |
| **Push** | Upload your commits to GitHub. |
| **Node.js** | The program that runs this project's JavaScript/TypeScript code. |
| **npm** | Node's package installer. It downloads the ~1000 free code libraries this project depends on. Comes bundled with Node.js. |
| **PostgreSQL ("Postgres")** | The database — where user accounts, invoices and records are stored. |
| **`.env` file** | A plain text file holding secrets and settings (database password, API keys). **Never** upload this to GitHub. |
| **Frontend** | The part users see — the website. Built with Next.js. Runs on port 3000. |
| **Backend** | The server that the website talks to. Runs on port 4000. |
| **Submodule** | A repo living inside another repo. This project's `frontend` folder is one. Part 3 removes that complication for you. |

### How to open PowerShell

Press the **Windows key**, type `powershell`, and click **Windows PowerShell**.

For a few steps you will need it opened **as Administrator**: press the Windows key, type `powershell`, right-click **Windows PowerShell**, choose **Run as administrator**, and click **Yes**.

### Terminal survival kit

| Command | What it does |
|---|---|
| `cd C:\dev\taxmate` | Move into a folder ("change directory"). |
| `cd ..` | Move up one folder. |
| `ls` | List what is in the current folder. |
| `pwd` | Show which folder you are currently in. |
| `Ctrl` + `C` | Stop a running program (you will use this to stop the servers). |
| Up arrow | Bring back the previous command. |

> **Important habit:** commands only work if you are in the right folder. If a command fails, run `pwd` first and check where you are.

---

## Part 1 — Install the tools

You need five things: **Git**, **Node.js**, **PostgreSQL**, **VS Code**, and a **GitHub account**.

### 1.1 — Allow PowerShell to run npm

Windows blocks npm's scripts by default and this trips up almost every beginner. Fix it once, now.

Open PowerShell **as Administrator** and paste:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
```

You can close the Administrator window after this. Everything else uses a normal PowerShell window.

### 1.2 — Install Git, Node.js, PostgreSQL and VS Code

Windows 10 and 11 include an installer tool called `winget`. Open a **normal** PowerShell window and paste these four commands, **one at a time**, waiting for each to finish:

```powershell
winget install --id Git.Git -e --source winget
```

```powershell
winget install --id OpenJS.NodeJS.LTS -e --source winget
```

```powershell
winget install --id PostgreSQL.PostgreSQL.17 -e --source winget
```

```powershell
winget install --id Microsoft.VisualStudioCode -e --source winget
```

If you are asked to agree to source terms, type `Y` and press Enter.

<details>
<summary><b>If <code>winget</code> is not recognized — install manually instead</b></summary>

Download and run each installer, accepting all default options:

- Git: <https://git-scm.com/download/win>
- Node.js (choose the **LTS** version): <https://nodejs.org/en/download>
- PostgreSQL (choose version 16 or 17, Windows x86-64): <https://www.postgresql.org/download/windows/>
- VS Code: <https://code.visualstudio.com/download>

</details>

> **PostgreSQL installer note:** it asks you to set a **password for the `postgres` user**. Type something you will remember — for example `postgres` — and **write it down**. You need it in Part 6 and Part 7. Leave the port as `5432`. When it offers "Stack Builder" at the end, click **Cancel**; you do not need it.

### 1.3 — Close and reopen PowerShell

Newly installed programs are only visible to **new** terminal windows. Close every PowerShell window and open a fresh one.

### 1.4 — Verify everything installed

Paste this whole block into the new PowerShell window:

```powershell
git --version
node --version
npm --version
```

You should see three version numbers, similar to:

```
git version 2.51.0.windows.1
v22.20.0
10.9.3
```

✅ **Checkpoint:** Node must be **v20.11 or higher**. If any command says *"is not recognized"*, that program did not install — redo Part 1.2 for it, then reopen PowerShell.

### 1.5 — Add PostgreSQL to your PATH

The database's command-line tool (`psql`) is not automatically available in PowerShell. Add it:

```powershell
$pgBin = (Get-ChildItem "C:\Program Files\PostgreSQL\*\bin" | Select-Object -Last 1).FullName
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";" + $pgBin, "User")
Write-Host "Added to PATH: $pgBin"
```

**Close PowerShell and open it again**, then check:

```powershell
psql --version
```

You should see something like `psql (PostgreSQL) 17.2`.

✅ **Checkpoint:** if you get a version number, the database tools are ready.

### 1.6 — Tell Git who you are

Replace the name and email with your own (use the email you will sign up to GitHub with):

```powershell
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
git config --global init.defaultBranch main
```

### 1.7 — Create a GitHub account

If you do not already have one, go to <https://github.com/signup> and create an account. Verify your email address. You will need it in Part 4.

---

## Part 2 — Get the code onto your computer

### 2.1 — Create a working folder

```powershell
mkdir C:\dev
cd C:\dev
```

If it says the folder already exists, ignore the error and just run `cd C:\dev`.

### 2.2 — Clone the project

```powershell
git clone https://github.com/Taxmateng/proxy-contract.git taxmate
```

> The repository is named `proxy-contract` for historical reasons, but it contains the whole Taxmate project. **If the project owner gave you a different link, use theirs instead** — keep the ` taxmate` at the end, which names the folder on your computer.

A browser window may pop up asking you to sign in to GitHub. Sign in and allow it.

### 2.3 — Go into the project folder

```powershell
cd C:\dev\taxmate
ls
```

You should see folders named `backend`, `frontend`, `proxy-contract` and files like `package.json` and `README.md`.

### 2.4 — Download the frontend code

The `frontend` folder arrives **empty**, because it is stored as a separate repository (a "submodule"). Fill it:

```powershell
git config submodule.frontend.url https://github.com/Taxmateng/frontend.git
git submodule update --init --recursive
```

Check it worked:

```powershell
ls frontend
```

You should see files such as `package.json`, `next.config.ts` and an `app` or `src` folder.

> **If this fails with a permission or "repository not found" error**, the frontend repo is private and your GitHub account has not been granted access. Ask the project owner to add your GitHub username as a collaborator on `Taxmateng/frontend`, then run the two commands again.

✅ **Checkpoint:** `frontend` is no longer empty.

---

## Part 3 — Remove the original owner's Git and start your own

Right now this folder is still connected to the original owner's GitHub account. This part cuts that connection and makes the project 100% yours.

You will also **flatten the frontend submodule into normal files**, so your repository is one simple project instead of two linked ones. This is what you want as a beginner.

Make sure you are in the project folder:

```powershell
cd C:\dev\taxmate
pwd
```

It must print `C:\dev\taxmate`. Now run these commands one at a time:

**3.1 — Delete the original Git history**

```powershell
Remove-Item -Recurse -Force .git
```

**3.2 — Delete the frontend's own Git history**

```powershell
Remove-Item -Recurse -Force frontend\.git
```

**3.3 — Remove the submodule declaration**

```powershell
Remove-Item -Force .gitmodules
```

**3.4 — Start a fresh, empty Git repository that belongs to you**

```powershell
git init
git branch -M main
```

**3.5 — Confirm the old owner is gone**

```powershell
git remote -v
```

✅ **Checkpoint:** this should print **nothing at all**. Blank output means there is no connection to anyone else's GitHub. That is exactly right.

**3.6 — Make your first commit**

```powershell
git add .
git commit -m "Initial commit: Taxmate project"
```

You will see a long list of added files ending with a summary line. That is your first saved snapshot.

> **Why no `.env` files appear in that list:** the project is already configured to never track them. Your secrets stay on your machine. Good.

---

## Part 4 — Create your GitHub repo and push

### 4.1 — Create an empty repository on GitHub

1. Go to <https://github.com/new>.
2. **Repository name:** `taxmate` (or any name you like).
3. Choose **Private** if you do not want it publicly visible.
4. **Do NOT tick** "Add a README file", "Add .gitignore", or "Choose a license". The repository must be completely empty.
5. Click **Create repository**.

GitHub now shows a page with a URL like:

```
https://github.com/YOUR-USERNAME/taxmate.git
```

Copy that URL.

### 4.2 — Connect your folder to that repository

Replace `YOUR-USERNAME` with your actual GitHub username:

```powershell
git remote add origin https://github.com/YOUR-USERNAME/taxmate.git
```

### 4.3 — Push your code up

```powershell
git push -u origin main
```

A window will pop up asking you to sign in to GitHub — click **Sign in with your browser**, authorise it, and return to PowerShell. (GitHub no longer accepts your account password in the terminal; this browser sign-in is the correct way.)

### 4.4 — Confirm

Refresh your GitHub repository page in the browser. All the project files should now be there.

✅ **Checkpoint:** you own a complete copy of the project on GitHub. The rest of the guide gets it running.

---

## Part 5 — Install the project's dependencies

This downloads the code libraries the project is built on. It downloads a lot — expect several minutes on each command, and a wall of scrolling text. Warnings in yellow are normal. Only red **error** text matters.

### 5.1 — Install the main dependencies

```powershell
cd C:\dev\taxmate
npm install
```

### 5.2 — Install the frontend's dependencies

The frontend keeps its own separate list, so it must be installed on its own:

```powershell
cd C:\dev\taxmate\frontend
npm install
cd C:\dev\taxmate
```

### 5.3 — Verify

```powershell
ls node_modules | Measure-Object
ls frontend\node_modules | Measure-Object
```

✅ **Checkpoint:** both should report a `Count` in the hundreds. If either says `0` or errors, re-run the matching install command in 5.1 / 5.2.

---

## Part 6 — Configuration files (.env)

The project reads its settings from files called `.env`. They do not exist yet — you create them from the provided examples.

### 6.1 — Create the backend and contract config files

```powershell
cd C:\dev\taxmate
Copy-Item backend\.env.example backend\.env
Copy-Item proxy-contract\.env.example proxy-contract\.env
```

### 6.2 — Create the frontend config file

```powershell
Set-Content -Path frontend\.env.local -Value "NEXT_PUBLIC_API_URL=http://localhost:4000/api"
```

### 6.3 — Generate two security keys

The backend needs two long random secrets to sign login tokens. Generate them:

```powershell
node -e "const c=require('crypto');console.log('JWT_SECRET=' + c.randomBytes(32).toString('hex'));console.log('JWT_REFRESH_SECRET=' + c.randomBytes(32).toString('hex'));"
```

This prints two lines like:

```
JWT_SECRET=8f3a...long random text...c21
JWT_REFRESH_SECRET=b7d0...different long random text...9ae
```

**Select both lines and copy them** (in PowerShell: highlight with the mouse, then press Enter to copy).

### 6.4 — Edit the backend config

Open the project in VS Code:

```powershell
code C:\dev\taxmate
```

In VS Code's left sidebar, click `backend`, then the file `.env`. Make **three** changes:

**a) Paste your generated secrets.** Find these two lines:

```
JWT_SECRET=replace_me
JWT_REFRESH_SECRET=replace_me
```

Delete them and paste the two lines you copied in step 6.3 in their place.

**b) Set the database password.** Find this line:

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/taxmate
```

The second `postgres` (between `:` and `@`) is the password. If you chose a different password when installing PostgreSQL in Part 1.2, replace it. For example, if your password is `MyPass123`:

```
DATABASE_URL=postgresql://postgres:MyPass123@localhost:5432/taxmate
```

**c) Leave everything else exactly as it is.** All the blank API keys (`CIRCLE_API_KEY`, `MONNIFY_API_KEY`, `PINATA_JWT`, `RESEND_API_KEY`, `VERIFYME_API_KEY`) are **meant to be empty**. Each of those services automatically runs in a fake "mock" mode when its key is missing, so the app works fully on your machine without any paid accounts.

**Save the file:** `Ctrl` + `S`.

> ⚠️ **Never share or upload your `.env` files.** They are already excluded from Git, so `git push` will not send them. Keep it that way.

---

## Part 7 — Set up the database

PostgreSQL is installed and running, but the project's specific database does not exist yet. You create it, then load the project's table structure into it.

### 7.1 — Create the database

```powershell
psql -U postgres -h localhost -c "CREATE DATABASE taxmate;"
```

It will ask: `Password for user postgres:` — type the password you set during the PostgreSQL install and press Enter. **Nothing appears as you type the password. That is normal — keep typing.**

Success looks like:

```
CREATE DATABASE
```

> If it says `database "taxmate" already exists`, that is fine — it is already there. Move on.

<details>
<summary><b>If <code>psql</code> is not recognized, or you prefer clicking</b></summary>

1. Press the Windows key, type `pgAdmin`, open **pgAdmin 4**.
2. Enter your `postgres` password when asked.
3. In the left tree, expand **Servers → PostgreSQL**.
4. Right-click **Databases** → **Create** → **Database…**.
5. In **Database**, type `taxmate`. Click **Save**.

</details>

### 7.2 — Create the tables

```powershell
cd C:\dev\taxmate
npm run db:migrate --workspace backend
```

This reads the project's schema and builds every table. You may be asked to confirm applying changes — press Enter to accept.

### 7.3 — Verify

```powershell
psql -U postgres -h localhost -d taxmate -c "\dt"
```

Enter your password again.

✅ **Checkpoint:** you should see a table listing including names like `users`, `invoices`, `tax_items_cache`, `individual_profiles`. If the list is empty, re-run 7.2 and read the error text.

---

## Part 8 — Run the app

The project is two programs that run at the same time, so you need **two PowerShell windows** open side by side.

### 8.1 — Window 1: the backend (API server)

Open a PowerShell window and run:

```powershell
cd C:\dev\taxmate
npm run dev:backend
```

Leave this window open and running. You should see log lines ending with something like `listening on port 4000`.

**Test it:** open <http://localhost:4000/api/health> in your browser. You should see a small JSON response, not an error page.

### 8.2 — Window 2: the frontend (website)

Open a **second, separate** PowerShell window:

```powershell
cd C:\dev\taxmate
npm run dev:frontend
```

Wait for `Ready in ...`, then open <http://localhost:3000> in your browser.

✅ **Checkpoint:** the Taxmate website loads in your browser, and the backend window shows activity as you click around. **The project is running.**

### 8.3 — Stopping and restarting

- **To stop** either server: click that PowerShell window and press `Ctrl` + `C`.
- **To start again later:** repeat 8.1 and 8.2. You never need to redo Parts 1–7.

### 8.4 — Things that are normal in development

- **Signing up does not send a real email.** Email is in mock mode, so the API response contains a `debugOtp` field with the verification code. Use that code.
- **Identity checks (NIN / RC number) are mocked** — they read from a local sample file rather than a live service.
- **Payments** need real Monnify sandbox test keys to go through checkout; without them, that step is disabled.

---

## Part 9 — Optional: the smart contracts

Only do this if you want to work on the blockchain contracts in `proxy-contract/`. **Skip it entirely if you just want the app running** — Parts 1–8 are enough.

```powershell
cd C:\dev\taxmate\proxy-contract
npm run compile
npm run test
```

If compiling fails with an error mentioning `@noble/curves`, reinstall this folder on its own:

```powershell
cd C:\dev\taxmate\proxy-contract
Remove-Item -Recurse -Force node_modules
npm install --workspaces=false
npm run compile
```

> ⚠️ `proxy-contract\.env` contains a field called `DEPLOYER_PRIVATE_KEY`. **Only ever put a throwaway test wallet key there — never a wallet holding real money.** You do not need to fill it in to compile or test.

---

## Part 10 — Saving your future work to GitHub

Every time you change something and want it backed up online, run these three commands from `C:\dev\taxmate`:

```powershell
git add .
git commit -m "Describe what you changed here"
git push
```

That is the whole loop. Repeat it as often as you like — small, frequent commits are better than one giant one.

To check what you have changed but not yet saved:

```powershell
git status
```

---

## Troubleshooting

| What you see | What it means and how to fix it |
|---|---|
| `npm : File ... npm.ps1 cannot be loaded because running scripts is disabled` | You skipped Part 1.1. Open PowerShell **as Administrator** and run `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force`, then reopen PowerShell. |
| `'git' / 'node' / 'npm' is not recognized` | That program is not installed, or you did not reopen PowerShell after installing. Close all PowerShell windows, open a new one, and try again. If it still fails, reinstall it from Part 1.2. |
| `'psql' is not recognized` | Redo Part 1.5, then close and reopen PowerShell. Or use the pgAdmin click-through method in Part 7.1. |
| `database "taxmate" does not exist` | Redo Part 7.1, then Part 7.2. |
| `password authentication failed for user "postgres"` | The password in `backend\.env` (`DATABASE_URL`) does not match the one you set when installing PostgreSQL. Fix the `.env` line and try again. |
| `ECONNREFUSED ... 5432` | PostgreSQL is not running. Press Windows key → type `services.msc` → find `postgresql-x64-17` → right-click → **Start**. |
| `EADDRINUSE ... 4000` (or 3000) | Something is already using that port — most likely a server you left running in another window. Find it and press `Ctrl`+`C`, or restart your computer. |
| `Invalid environment variables` on backend start | A required value in `backend\.env` is missing. Check `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET` and `NEXT_PUBLIC_APP_URL` all have values after the `=`. |
| The `frontend` folder is empty | Redo Part 2.4. If it errors with "not found", you need access to the frontend repo — ask the project owner. |
| `Cannot find module ...` when starting | Dependencies did not install fully. Re-run Part 5.1 and 5.2. |
| Website loads but every action fails | The backend is not running. Check Window 1 from Part 8.1 — it must still be open and running. |
| `remote: Repository not found` on push | The URL in Part 4.2 has a typo, or you are signed into the wrong GitHub account. Check with `git remote -v`, and fix with `git remote set-url origin https://github.com/YOUR-USERNAME/taxmate.git`. |
| `Updates were rejected` on push | Your GitHub repo was not empty. Delete it on GitHub and recreate it, ticking **nothing** (Part 4.1). |
| Something is badly broken and you want to start over | Delete the folder (`Remove-Item -Recurse -Force C:\dev\taxmate`) and restart from Part 2. Your code on GitHub is safe. |

---

## Command cheat sheet

Everything, in order, for reference once you understand the steps:

```powershell
# --- one-time machine setup (Administrator PowerShell for the first line) ---
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
winget install --id Git.Git -e --source winget
winget install --id OpenJS.NodeJS.LTS -e --source winget
winget install --id PostgreSQL.PostgreSQL.17 -e --source winget
winget install --id Microsoft.VisualStudioCode -e --source winget
# reopen PowerShell, then:
$pgBin = (Get-ChildItem "C:\Program Files\PostgreSQL\*\bin" | Select-Object -Last 1).FullName
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";" + $pgBin, "User")
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
git config --global init.defaultBranch main

# --- get the code (reopen PowerShell first) ---
mkdir C:\dev
cd C:\dev
git clone https://github.com/Taxmateng/proxy-contract.git taxmate
cd C:\dev\taxmate
git config submodule.frontend.url https://github.com/Taxmateng/frontend.git
git submodule update --init --recursive

# --- make it yours ---
Remove-Item -Recurse -Force .git
Remove-Item -Recurse -Force frontend\.git
Remove-Item -Force .gitmodules
git init
git branch -M main
git add .
git commit -m "Initial commit: Taxmate project"
git remote add origin https://github.com/YOUR-USERNAME/taxmate.git
git push -u origin main

# --- install dependencies ---
npm install
cd frontend; npm install; cd ..

# --- config files ---
Copy-Item backend\.env.example backend\.env
Copy-Item proxy-contract\.env.example proxy-contract\.env
Set-Content -Path frontend\.env.local -Value "NEXT_PUBLIC_API_URL=http://localhost:4000/api"
node -e "const c=require('crypto');console.log('JWT_SECRET=' + c.randomBytes(32).toString('hex'));console.log('JWT_REFRESH_SECRET=' + c.randomBytes(32).toString('hex'));"
# then edit backend\.env: paste the two secrets, fix the DATABASE_URL password

# --- database ---
psql -U postgres -h localhost -c "CREATE DATABASE taxmate;"
npm run db:migrate --workspace backend

# --- run (two separate PowerShell windows) ---
npm run dev:backend     # window 1  -> http://localhost:4000/api
npm run dev:frontend    # window 2  -> http://localhost:3000

# --- save your work, any time ---
git add .
git commit -m "What I changed"
git push
```
