import {
	App,
	Editor,
	Menu,
	MenuItem,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	TAbstractFile,
} from "obsidian";

// @ts-ignore — no type definitions for this package
import * as OpenTimestamps from "javascript-opentimestamps";

const OTS_DIR = ".ots";
const PROOFS_DIR = `${OTS_DIR}/proofs`;
const SNAPSHOTS_DIR = `${OTS_DIR}/snapshots`;
const INDEX_FILE = `${OTS_DIR}/timestamps.json`;
const LOG_FILE = "OTS Log.md";

interface TimestampEntry {
	file: string;
	sha256: string;
	submittedAt: string;
	status: "pending" | "confirmed";
	bitcoinBlock?: number;
	proofFile: string;
	snapshotFile: string;
}

interface OtsIndex {
	entries: TimestampEntry[];
}

interface OtsSettings {
	// reserved for future settings
}

const DEFAULT_SETTINGS: OtsSettings = {};

export default class OtsPlugin extends Plugin {
	settings: OtsSettings;
	private statusBarItem: HTMLElement;

	async onload() {
		await this.loadSettings();
		this.ensureOtsDir();

		// Status bar button
		this.statusBarItem = this.addStatusBarItem();
		this.statusBarItem.style.cursor = "pointer";
		this.statusBarItem.addEventListener("click", async () => {
			const index = await this.loadIndex();
			const pending = index.entries.filter((e) => e.status !== "confirmed").length;
			if (pending > 0) {
				this.upgradeAllProofs();
			} else {
				const file = this.app.workspace.getActiveFile();
				if (file) this.timestampFile(file, true);
				else new Notice("No active file to timestamp.");
			}
		});
		await this.refreshStatusBar();

		// Run a silent upgrade check on startup once the workspace is ready
		this.app.workspace.onLayoutReady(() => this.startupUpgradeCheck());

		// Right-click menu in file explorer
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
				if (!(file instanceof TFile)) return;
				menu.addItem((item: MenuItem) => {
					item
						.setTitle("Get Timestamp (OTS)")
						.setIcon("clock")
						.onClick(() => this.timestampFile(file, true));
				});
			})
		);

		// Right-click menu in editor
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu: Menu, _editor: Editor, _view: any) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return;
				menu.addItem((item: MenuItem) => {
					item
						.setTitle("Get Timestamp (OTS)")
						.setIcon("clock")
						.onClick(() => this.timestampFile(file, true));
				});
			})
		);

		// Command: timestamp current file
		this.addCommand({
			id: "timestamp-current-file",
			name: "Timestamp current file",
			callback: () => {
				const file = this.app.workspace.getActiveFile();
				if (file) this.timestampFile(file, true);
				else new Notice("No active file.");
			},
		});

		// Command: bulk timestamp
		this.addCommand({
			id: "bulk-timestamp",
			name: "Bulk timestamp all files",
			callback: () => new BulkTimestampModal(this.app, this).open(),
		});

		// Command: upgrade/verify proofs
		this.addCommand({
			id: "upgrade-proofs",
			name: "Upgrade pending OTS proofs",
			callback: () => this.upgradeAllProofs(),
		});

		this.addSettingTab(new OtsSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async refreshStatusBar() {
		const index = await this.loadIndex();
		const pending = index.entries.filter((e) => e.status !== "confirmed").length;
		if (pending > 0) {
			this.statusBarItem.setText(`⏱ OTS · ${pending} pending`);
			this.statusBarItem.title = `Click to check for Bitcoin confirmations (${pending} pending)`;
		} else {
			this.statusBarItem.setText("⏱ OTS");
			this.statusBarItem.title = "Click to timestamp the active file";
		}
	}

	private async startupUpgradeCheck() {
		const index = await this.loadIndex();
		const pendingCount = index.entries.filter((e) => e.status !== "confirmed").length;
		if (pendingCount === 0) return;

		const upgraded = await this.upgradeAllProofs(true);
		const stillPending = pendingCount - upgraded;

		if (upgraded > 0) {
			new Notice(`✅ OTS: ${upgraded} proof${upgraded > 1 ? "s" : ""} confirmed on Bitcoin!`);
		}
		if (stillPending > 0) {
			new Notice(
				`⏳ OTS: ${stillPending} proof${stillPending > 1 ? "s are" : " is"} still pending Bitcoin confirmation. ` +
				`Run "Upgrade pending OTS proofs" from the command palette to check again.`,
				8000
			);
		}
	}

	private isOtsPath(path: string): boolean {
		return path.startsWith(OTS_DIR + "/") || path === LOG_FILE;
	}

	private async ensureOtsDir() {
		const adapter = this.app.vault.adapter;
		for (const dir of [OTS_DIR, PROOFS_DIR, SNAPSHOTS_DIR]) {
			if (!(await adapter.exists(dir))) {
				await adapter.mkdir(dir);
			}
		}
	}

	async timestampFile(file: TFile, notify: boolean): Promise<boolean> {
		await this.ensureOtsDir();

		try {
			// Read file bytes
			const content = await this.app.vault.readBinary(file);
			const bytes = new Uint8Array(content);

			// SHA-256 via Web Crypto
			const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
			const sha256 = Array.from(new Uint8Array(hashBuffer))
				.map((b) => b.toString(16).padStart(2, "0"))
				.join("");

			if (notify) new Notice(`Submitting ${file.name} to OTS calendars…`);

			// Build OTS stamp
			const hashBytes = Buffer.from(sha256, "hex");
			const detached = OpenTimestamps.DetachedTimestampFile.fromHash(
				new OpenTimestamps.Ops.OpSHA256(),
				hashBytes
			);
			await OpenTimestamps.stamp(detached);

			const otsBytes: Uint8Array = detached.serializeToBytes();

			// Save proof file
			const safeName = file.path.replace(/\//g, "_");
			const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
			const proofPath = `${PROOFS_DIR}/${safeName}_${timestamp}.ots`;
			await this.app.vault.adapter.writeBinary(proofPath, otsBytes.buffer);

			// Save snapshot of the exact version that was stamped
			const ext = file.extension ? `.${file.extension}` : "";
			const baseName = file.basename;
			const snapshotPath = `${SNAPSHOTS_DIR}/${baseName}_${timestamp}${ext}`;
			await this.app.vault.adapter.writeBinary(snapshotPath, content);

			// Update index
			const entry: TimestampEntry = {
				file: file.path,
				sha256,
				submittedAt: new Date().toISOString(),
				status: "pending",
				proofFile: proofPath,
				snapshotFile: snapshotPath,
			};
			await this.addIndexEntry(entry);
			await this.regenerateLog();
			await this.refreshStatusBar();

			if (notify) new Notice(`✓ Timestamped: ${file.name} (pending Bitcoin anchor)`);
			return true;
		} catch (err) {
			console.error("OTS stamp error:", err);
			if (notify) new Notice(`OTS error for ${file.name}: ${err}`);
			return false;
		}
	}

	async upgradeAllProofs(silent = false): Promise<number> {
		const index = await this.loadIndex();
		let upgraded = 0;

		for (const entry of index.entries) {
			if (entry.status === "confirmed") continue;
			try {
				const data = await this.app.vault.adapter.readBinary(entry.proofFile);
				const detached = OpenTimestamps.DetachedTimestampFile.deserialize(new Uint8Array(data));
				await OpenTimestamps.upgrade(detached);

				const info = OpenTimestamps.verifyTimestamp(detached.timestamp);
				if (info && info.height) {
					entry.status = "confirmed";
					entry.bitcoinBlock = info.height;
					upgraded++;
				}

				const updated: Uint8Array = detached.serializeToBytes();
				await this.app.vault.adapter.writeBinary(entry.proofFile, updated.buffer);
			} catch (_) {
				// proof not yet anchored — skip silently
			}
		}

		await this.saveIndex(index);
		await this.regenerateLog();
		await this.refreshStatusBar();
		if (!silent) new Notice(`Upgraded ${upgraded} proof(s) to confirmed.`);
		return upgraded;
	}

	private async loadIndex(): Promise<OtsIndex> {
		try {
			const raw = await this.app.vault.adapter.read(INDEX_FILE);
			return JSON.parse(raw) as OtsIndex;
		} catch {
			return { entries: [] };
		}
	}

	private async saveIndex(index: OtsIndex) {
		await this.app.vault.adapter.write(INDEX_FILE, JSON.stringify(index, null, 2));
	}

	private async addIndexEntry(entry: TimestampEntry) {
		const index = await this.loadIndex();
		index.entries.unshift(entry);
		await this.saveIndex(index);
	}

	private async regenerateLog() {
		const index = await this.loadIndex();

		const confirmed = index.entries.filter((e) => e.status === "confirmed");
		const pending = index.entries.filter((e) => e.status !== "confirmed");

		const verifiedSection = confirmed.length === 0
			? ""
			: `---

## ✅ Verified Proofs

These files are permanently anchored to the Bitcoin blockchain. Click a block number to view the transaction on the public ledger.

| File | Version snapshot | SHA-256 (prefix) | Timestamped | Bitcoin Block |
|------|-----------------|-----------------|-------------|---------------|
${confirmed
	.map((e) =>
		`| [[${e.file}]] | [[${e.snapshotFile}\\|view snapshot]] | \`${e.sha256.slice(0, 12)}…\` | ${e.submittedAt.slice(0, 10)} | [Block #${e.bitcoinBlock}](https://mempool.space/block-height/${e.bitcoinBlock}) |`
	)
	.join("\n")}

`;

		const pendingSection = pending.length === 0
			? ""
			: `---

## ⏳ Pending Proofs

These files have been submitted but are not yet anchored to a Bitcoin block. Run **OpenTimestamps: Upgrade pending OTS proofs** from the command palette to check for updates.

| File | Version snapshot | SHA-256 (prefix) | Submitted |
|------|-----------------|-----------------|-----------|
${pending
	.map((e) =>
		`| [[${e.file}]] | [[${e.snapshotFile}\\|view snapshot]] | \`${e.sha256.slice(0, 12)}…\` | ${e.submittedAt.slice(0, 10)} |`
	)
	.join("\n")}

`;

		const md = `# OpenTimestamps Log

> Auto-generated by the OTS plugin. Do not edit manually. Proof files and snapshots are stored in the hidden \`.ots/\` folder.
>
> **How long does verification take?** After submission, the OpenTimestamps servers batch your proof and anchor it to Bitcoin approximately once per hour. The Bitcoin network then mines that transaction into a block, which takes around 10 minutes on average. In practice, most proofs are confirmed within **2–6 hours**. In rare cases it can take up to 24 hours. Run **OpenTimestamps: Upgrade pending OTS proofs** from the command palette to check for updates.

**${confirmed.length} verified** · **${pending.length} pending**

${verifiedSection}${pendingSection}---

## How to verify your proof

Each \`.ots\` file in \`.ots/proofs/\` is a cryptographic proof that a specific version of your file existed at that point in time. The matching snapshot in \`.ots/snapshots/\` is the exact copy of the file that was stamped.

### Option 1 — Web (no install required)

1. Go to **https://opentimestamps.org/**
2. Drag and drop any \`.ots\` file from \`.ots/proofs/\` onto the page
3. The site will confirm whether the proof is pending or anchored, and show the Bitcoin block number if confirmed

### Option 2 — Command line

\`\`\`
pip install opentimestamps-client
ots verify .ots/proofs/<yourfile>.ots
\`\`\`

---

## How verification proves existence

When you timestamped a file, the plugin saved two things: a \`.ots\` proof file and a snapshot of the exact version of your document at that moment. Together they prove:

1. **Your file's exact contents existed** — the SHA-256 hash in the proof matches the snapshot. If even a single character had changed, the hash would be completely different.
2. **They existed before a specific Bitcoin block** — the Bitcoin blockchain is a public, immutable ledger. The block your proof is anchored to has a timestamp, and every block that came after it proves yours came first.

If a dispute ever arose, you could hand someone the snapshot and its \`.ots\` proof, and they could verify independently — using nothing but open-source tools and the public Bitcoin blockchain — that your file existed on that date. No lawyers, no notaries, no central authority needed.
`;
		await this.app.vault.adapter.write(LOG_FILE, md);
	}
}

class BulkTimestampModal extends Modal {
	plugin: OtsPlugin;

	constructor(app: App, plugin: OtsPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Bulk Timestamp Files" });

		const files = this.app.vault
			.getFiles()
			.filter((f) => !f.path.startsWith(OTS_DIR + "/") && f.path !== LOG_FILE);

		contentEl.createEl("p", {
			text: `This will submit ${files.length} file(s) to OpenTimestamps calendars and save a snapshot of each. Continue?`,
		});

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Timestamp All")
					.setCta()
					.onClick(async () => {
						this.close();
						const notice = new Notice(`Timestamping 0 / ${files.length}…`, 0);
						let done = 0;
						for (const file of files) {
							await this.plugin.timestampFile(file, false);
							done++;
							notice.setMessage(`Timestamping ${done} / ${files.length}…`);
						}
						notice.hide();
						new Notice(`Done! Timestamped ${done} files.`);
					})
			)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => this.close())
			);
	}

	onClose() {
		this.contentEl.empty();
	}
}

class OtsSettingTab extends PluginSettingTab {
	plugin: OtsPlugin;

	constructor(app: App, plugin: OtsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "OpenTimestamps" });
		containerEl.createEl("p", {
			text: "Prove the existence of your writing by anchoring it to the Bitcoin blockchain — no account, no central authority required.",
		});

		// How it works
		containerEl.createEl("h3", { text: "How it works" });
		const steps = containerEl.createEl("ol");
		[
			"Your note is hashed using SHA-256 (a fingerprint of its exact contents).",
			"The hash is submitted to public OpenTimestamps calendar servers.",
			"The servers bundle your hash into a Merkle tree anchored to a Bitcoin block.",
			"A .ots proof file and a snapshot of your document are saved in the hidden .ots/ folder.",
			"Anyone can independently verify the proof using the free OTS CLI tool or opentimestamps.org.",
		].forEach((s) => steps.createEl("li", { text: s }));

		// Usage
		containerEl.createEl("h3", { text: "Usage" });

		new Setting(containerEl)
			.setName("Status bar button")
			.setDesc('Click the "⏱ OTS" button in the bottom bar to timestamp the currently open file.');

		new Setting(containerEl)
			.setName("Timestamp a specific file")
			.setDesc("Right-click any file in the file explorer or editor and choose: Get Timestamp (OTS).");

		new Setting(containerEl)
			.setName("Bulk timestamp all files")
			.setDesc('Open the command palette (Ctrl+P / Cmd+P) and run: "OpenTimestamps: Bulk timestamp all files".');

		new Setting(containerEl)
			.setName("Upgrade pending proofs")
			.setDesc('Run "OpenTimestamps: Upgrade pending OTS proofs" from the command palette to check for Bitcoin block confirmations.');

		// Storage
		containerEl.createEl("h3", { text: "What gets stored in your vault" });
		const pre = containerEl.createEl("pre");
		pre.style.background = "var(--background-secondary)";
		pre.style.padding = "10px";
		pre.style.borderRadius = "6px";
		pre.style.fontSize = "0.85em";
		pre.createEl("code", {
			text:
				"OTS Log.md            ← visible in Obsidian sidebar\n" +
				".ots/                 ← hidden from sidebar, visible in OS file manager\n" +
				"  timestamps.json     ← machine-readable proof index\n" +
				"  proofs/\n" +
				"    My_Note_<date>.ots     ← proof file per stamp\n" +
				"  snapshots/\n" +
				"    My_Note_<date>.md      ← exact copy of file at time of stamp",
		});

		// Verify
		containerEl.createEl("h3", { text: "Verify a proof independently" });
		containerEl.createEl("p", {
			text: "Anyone can verify your proof without this plugin using the official OTS CLI:",
		});
		const pre2 = containerEl.createEl("pre");
		pre2.style.background = "var(--background-secondary)";
		pre2.style.padding = "10px";
		pre2.style.borderRadius = "6px";
		pre2.style.fontSize = "0.85em";
		pre2.createEl("code", {
			text: "pip install opentimestamps-client\nots verify .ots/proofs/My_Note_<date>.ots",
		});
	}
}
