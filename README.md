# Obsidian OpenTimestamps Plugin

A free, privacy-respecting plugin that proves your files existed at a specific point in time — anchored permanently to the Bitcoin blockchain. No account required. No files ever leave your computer.

---

## Why this matters

### For authors and writers

You've spent months writing a novel, a screenplay, or a non-fiction manuscript. How do you prove that chapter three existed before someone else published something similar? How do you show an agent, a publisher, or a court that your work predates a dispute?

Traditional copyright registration is slow, costs money, and requires you to remember to do it. This plugin does it automatically, every time you create a new note — silently working in the background while you write.

- Timestamp individual chapters as you draft them
- Prove your outline existed before your manuscript was completed
- Build a timestamped record of your creative process over time
- Protect yourself if your work is ever plagiarized or disputed

### For researchers

Research moves fast. Ideas get scooped. Data gets disputed. A timestamped record of your notes, hypotheses, and findings creates an independently verifiable trail of when you knew what.

- Prove when a hypothesis was first recorded
- Establish priority on a discovery or finding
- Protect unpublished data and methodology notes
- Create an audit trail for collaborative or grant-funded work

### For anyone with important files

Contracts, correspondence, designs, source code, financial records — anything where proving *when* something existed has value. If the file is in your Obsidian vault, it can be timestamped.

---

## How it works

This plugin uses [OpenTimestamps](https://opentimestamps.org/), an open standard for Bitcoin-based timestamping.

1. **Your file is fingerprinted** using SHA-256, a one-way cryptographic hash. This produces a unique identifier for the exact contents of your file. The file itself is never sent anywhere.
2. **The fingerprint is submitted** to public OpenTimestamps calendar servers.
3. **The servers anchor your hash to Bitcoin** by bundling thousands of hashes together and recording them in a single Bitcoin transaction.
4. **A proof file (`.ots`) is saved** in your vault. This is your permanent evidence.
5. **Anyone can verify the proof** independently — no account, no central authority, no trust required.

Because Bitcoin blocks are permanent and publicly auditable, the proof cannot be faked, altered, or revoked.

### It works automatically

The moment you create a new note, the plugin timestamps it for you — no extra steps. You write, it protects.

### Existing files can be timestamped in bulk

Already have a vault full of notes? Use the **Bulk Timestamp** command to submit every file at once.

---

## Installation

### Step 1 — Download the plugin

1. Go to **https://github.com/phluschott/obs_ots**
2. Click the green **Code** button → **Download ZIP**
3. Unzip the file on your computer

### Step 2 — Copy it into your vault

1. Open Obsidian
2. Go to **Settings** (bottom-left gear icon) → **Community plugins**
3. Click the folder icon next to "Installed plugins" — this opens your vault's plugin folder
4. Create a new folder inside called `obsidian-ots`
5. Copy `main.js` and `manifest.json` from the unzipped download into that folder

### Step 3 — Enable the plugin

1. Go back to **Settings → Community plugins**
2. Turn off **Safe mode** if prompted
3. Find **OpenTimestamps** in the list and toggle it on

The plugin is now active. Any new note you create will be automatically timestamped.

---

## Usage

### Automatic — new files

Nothing to do. Every time you create a new note, the plugin automatically submits it to the OpenTimestamps calendars within a few seconds. You'll see a brief notice in the top-right corner confirming the submission.

### Timestamp a single existing file

Right-click any file in the **file explorer** (left sidebar) or inside the **editor** and choose:

> **Get Timestamp (OTS)**

### Timestamp all existing files at once

If you have an existing vault and want to timestamp everything:

1. Press `Ctrl+P` (Windows/Linux) or `Cmd+P` (Mac) to open the command palette
2. Type **Bulk timestamp** and select **OpenTimestamps: Bulk timestamp all files**
3. A dialog will show how many files will be submitted — click **Timestamp All**
4. Progress is shown as each file is submitted

### Check and upgrade pending proofs

When first submitted, a proof is **pending** — your hash has been accepted by the calendar servers but not yet anchored to a Bitcoin block. This usually resolves within a few hours.

To check for confirmations:

1. Open the command palette (`Ctrl+P` / `Cmd+P`)
2. Run **OpenTimestamps: Upgrade pending OTS proofs**

Once confirmed, the proof will show the Bitcoin block number it was anchored to.

---

## What gets stored in your vault

The plugin keeps everything organised into two places:

### OTS Log.md — visible in your vault

A note called **OTS Log.md** is created at the root of your vault. This is your human-readable record — it lists every timestamped file, its submission date, and its current status (pending or confirmed with a Bitcoin block number and link). You can open it any time from the file explorer like any other note.

### .ots/ — hidden folder

All proof files and the machine-readable index are stored in a hidden `.ots/` folder. Folders that start with a dot are hidden from the Obsidian sidebar automatically — you won't see it cluttering your file explorer. However, you can still access it through your operating system's file manager (you may need to enable "show hidden files" in your OS settings).

```
Your Vault/
  OTS Log.md          ← visible in Obsidian sidebar
  .ots/               ← hidden from sidebar, visible in OS file manager
    timestamps.json   ← machine-readable proof index
    proofs/
      Chapter_1.md.ots
      Chapter_2.md.ots
      My_Research.md.ots
```

> Do not manually edit `timestamps.json` or the `.ots` files — they are binary cryptographic proofs.

---

## Verifying a proof

### Option 1 — Web (no install required)

1. Go to **https://opentimestamps.org/**
2. Drag and drop any `.ots` file from your `.ots/proofs/` folder onto the page
3. The site will confirm whether the proof is pending or anchored, and show the Bitcoin block number if confirmed

### Option 2 — Command line

```bash
pip install opentimestamps-client
ots verify .ots/proofs/Chapter_1.md.ots
```

---

## What the proof actually proves

When you verify a proof, you are establishing two things:

1. **Your file's exact contents existed** — the SHA-256 hash in the proof matches your file. If even a single character had changed, the hash would be completely different.
2. **They existed before a specific Bitcoin block** — the Bitcoin blockchain is a public, immutable ledger. The block your proof is anchored to has a timestamp, and every block that came after it proves yours came first.

This means that if a dispute ever arose — plagiarism, a priority claim, a contract disagreement — you could hand someone your original file and its `.ots` proof, and they could verify independently, using nothing but open-source tools and the public Bitcoin blockchain, that your file existed on that date. No lawyers, no notaries, no central authority needed.

---

## Privacy

Only the SHA-256 hash of your file is ever sent to the calendar servers — never the file itself, never its name, never its contents. The hash is a one-way fingerprint: it cannot be reversed to recover your file. Your writing stays on your computer.

---

## Submitting to Obsidian Community Plugins

This plugin is not yet listed in the Obsidian community plugin directory. If you find it useful, contributions and feedback are welcome via [GitHub Issues](https://github.com/phluschott/obs_ots/issues).
