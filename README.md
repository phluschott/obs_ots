# Obsidian OpenTimestamps Plugin

Prove the existence of your writing at a specific point in time by anchoring it to the Bitcoin blockchain — no account, no central authority, no trust required. Built for writers who want to protect their intellectual property.

## How it works

1. Your note is hashed using SHA-256 (a fingerprint of its exact contents)
2. That hash is submitted to public [OpenTimestamps](https://opentimestamps.org/) calendar servers
3. The servers bundle your hash into a Merkle tree and anchor it to a Bitcoin block
4. A `.ots` proof file is saved in your vault — this is your evidence
5. Anyone can independently verify the proof using the open-source OTS CLI

The Bitcoin blockchain is immutable and public, so the proof can never be faked or revoked.

---

## Installation

1. Download this repository — click **Code → Download ZIP** on GitHub and unzip it
2. Copy the folder into your vault's plugin directory:
   ```
   YourVault/.obsidian/plugins/obsidian-ots/
   ```
   Make sure the folder contains at minimum `main.js` and `manifest.json`
3. Open Obsidian and go to **Settings → Community plugins**
4. Turn off **Safe mode** if prompted
5. Find **OpenTimestamps** in the list and enable it

> **Note:** Always download from the `claude/zealous-gauss-bbwwgd` branch (or main, once merged) — not the default GitHub view, which may show an older branch.

---

## Usage

### Automatic timestamping

Every time you create a new note, the plugin automatically submits it to the OTS calendars after a 3-second delay. You'll see a confirmation notice in the top-right corner.

### Timestamp a specific file

Right-click any file in the **file explorer** or inside the **editor** and choose:

> **Get Timestamp (OTS)**

### Timestamp all files at once

1. Press `Ctrl+P` (Windows/Linux) or `Cmd+P` (Mac) to open the command palette
2. Type **Bulk timestamp** and select **OpenTimestamps: Bulk timestamp all files**
3. Confirm in the dialog — the plugin will submit every file and show progress

### Upgrade pending proofs

Newly submitted proofs are **pending** until a Bitcoin block is mined that includes them (usually within a few hours). To check for confirmations:

1. Open the command palette (`Ctrl+P` / `Cmd+P`)
2. Select **OpenTimestamps: Upgrade pending OTS proofs**

Confirmed proofs will show the Bitcoin block number in your log.

---

## What gets stored in your vault

```
_ots/
  README.md          ← auto-generated log of all timestamps
  timestamps.json    ← machine-readable proof index
  proofs/
    My_Note.md.ots   ← binary proof file for each timestamped note
```

The `_ots/` folder is created automatically the first time you timestamp a file. Do not edit `timestamps.json` or the `.ots` files manually.

---

## Verifying a proof independently

You (or anyone else) can verify a proof without this plugin using the official OTS command-line tool:

```bash
pip install opentimestamps-client
ots verify _ots/proofs/My_Note.md.ots
```

This confirms exactly which Bitcoin block your file's hash was included in, proving it existed before that block was mined.

---

## FAQ

**Does this upload my files anywhere?**
No. Only the SHA-256 hash (a fixed-length fingerprint) is sent to the calendar servers — never the file content itself.

**What if a calendar server is down?**
The plugin contacts multiple public servers. As long as one responds, the stamp succeeds.

**Can I timestamp non-Markdown files?**
Yes — any file in your vault can be timestamped, including images, PDFs, and attachments.

**How long until a proof is confirmed?**
Typically a few hours, depending on Bitcoin block times. Run **Upgrade pending OTS proofs** to check.
