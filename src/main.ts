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

const OTS_DIR = "_ots";
const PROOFS_DIR = `${OTS_DIR}/proofs`;
const INDEX_FILE = `${OTS_DIR}/timestamps.json`;
const LOG_FILE = `${OTS_DIR}/README.md`;


interface TimestampEntry {
	file: string;
	sha256: string;
	submittedAt: string;
	status: "pending" | "confirmed";
	bitcoinBlock?: number;
	proofFile: string;
}

interface OtsIndex {
	entries: TimestampEntry[];
}

export default class OtsPlugin extends Plugin {
	private autoTimestampDelay = 3000;

	async onload() {
		this.ensureOtsDir();

		// Auto-timestamp on file create
		this.registerEvent(
			this.app.vault.on("create", (file: TAbstractFile) => {
				if (!(file instanceof TFile)) return;
				if (this.isOtsPath(file.path)) return;
				setTimeout(() => this.timestampFile(file, false), this.autoTimestampDelay);
			})
		);

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

	private isOtsPath(path: string): boolean {
		return path.startsWith(OTS_DIR + "/");
	}

	private async ensureOtsDir() {
		const adapter = this.app.vault.adapter;
		for (const dir of [OTS_DIR, PROOFS_DIR]) {
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

			// Build OTS stamp — fromHash takes raw hash bytes, stamp() uses public calendars by default
			const hashBytes = Buffer.from(sha256, "hex");

			const detached = OpenTimestamps.DetachedTimestampFile.fromHash(
				new OpenTimestamps.Ops.OpSHA256(),
				hashBytes
			);

			await OpenTimestamps.stamp(detached);

			const otsBytes: Uint8Array = detached.serializeToBytes();

			// Save proof file
			const safeName = file.path.replace(/\//g, "_");
			const proofPath = `${PROOFS_DIR}/${safeName}.ots`;
			await this.app.vault.adapter.writeBinary(proofPath, otsBytes.buffer);

			// Update index
			const entry: TimestampEntry = {
				file: file.path,
				sha256,
				submittedAt: new Date().toISOString(),
				status: "pending",
				proofFile: proofPath,
			};
			await this.addIndexEntry(entry);
			await this.regenerateLog();

			if (notify) new Notice(`✓ Timestamped: ${file.name} (pending Bitcoin anchor)`);
			return true;
		} catch (err) {
			console.error("OTS stamp error:", err);
			if (notify) new Notice(`OTS error for ${file.name}: ${err}`);
			return false;
		}
	}

	async upgradeAllProofs() {
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
		new Notice(`Upgraded ${upgraded} proof(s) to confirmed.`);
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
		// Replace existing entry for same file if present
		const idx = index.entries.findIndex((e) => e.file === entry.file);
		if (idx >= 0) index.entries[idx] = entry;
		else index.entries.unshift(entry);
		await this.saveIndex(index);
	}

	private async regenerateLog() {
		const index = await this.loadIndex();
		const rows = index.entries
			.map((e) => {
				const status = e.status === "confirmed" ? `✅ Block #${e.bitcoinBlock}` : "⏳ Pending";
				return `| [[${e.file}]] | \`${e.sha256.slice(0, 12)}…\` | ${e.submittedAt.slice(0, 10)} | ${status} |`;
			})
			.join("\n");

		const md = `# OpenTimestamps Log

> Auto-generated by the OTS plugin. Do not edit manually.

| File | SHA-256 (prefix) | Submitted | Status |
|------|-----------------|-----------|--------|
${rows}

---

## How to verify your proof

Each \`.ots\` file in the \`proofs/\` folder is a cryptographic proof that your file existed at a specific point in time, anchored to the Bitcoin blockchain.

### Option 1 — Web (no install required)

1. Go to **https://opentimestamps.org/**
2. Drag and drop the \`.ots\` proof file from the \`proofs/\` folder onto the page
3. The site will show whether the proof is pending or confirmed, and if confirmed, which Bitcoin block it was anchored to

### Option 2 — Command line

\`\`\`
pip install opentimestamps-client
ots verify _ots/proofs/<yourfile>.ots
\`\`\`

---

## How verification proves existence

When you timestamped a file, only its **SHA-256 hash** — a unique fingerprint of the file's exact contents — was submitted to the OpenTimestamps servers. Your actual file never left your computer.

The servers bundled that hash into a Merkle tree (a tamper-proof chain of hashes) and recorded the root of that tree in a Bitcoin transaction. Once mined into a block, that record is permanent and immutable.

When you verify later, the \`.ots\` proof file mathematically demonstrates that your file's hash was included in that Bitcoin block. Since Bitcoin blocks are timestamped and irreversible, this proves your file existed **before that block was mined** — without trusting any central authority.

Anyone can repeat this verification independently using nothing but the \`.ots\` file, your original file, and the public Bitcoin blockchain.
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
			.filter((f) => !f.path.startsWith(OTS_DIR + "/"));

		contentEl.createEl("p", {
			text: `This will submit ${files.length} file(s) to OpenTimestamps calendars. Continue?`,
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
			"A .ots proof file is saved in your vault — this is your evidence.",
			"Anyone can independently verify the proof using the free OTS CLI tool.",
		].forEach((s) => steps.createEl("li", { text: s }));

		// Usage
		containerEl.createEl("h3", { text: "Usage" });

		new Setting(containerEl)
			.setName("Timestamp a specific file")
			.setDesc("Right-click any file in the file explorer or editor and choose: Get Timestamp (OTS).");

		new Setting(containerEl)
			.setName("Auto-timestamp on create")
			.setDesc("New files are automatically submitted to OTS calendars 3 seconds after creation.");

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
				"_ots/\n" +
				"  README.md          ← auto-generated timestamp log\n" +
				"  timestamps.json    ← machine-readable proof index\n" +
				"  proofs/\n" +
				"    My_Note.md.ots   ← binary proof file per note",
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
			text: "pip install opentimestamps-client\nots verify _ots/proofs/My_Note.md.ots",
		});

		// Settings header
		containerEl.createEl("h3", { text: "Settings" });

		new Setting(containerEl)
			.setName("Proof storage folder")
			.setDesc("Folder inside your vault where .ots proof files and the log are stored.")
			.addText((text) =>
				text
					.setPlaceholder("_ots")
					.setValue(OTS_DIR)
					.setDisabled(true)
			);

		new Setting(containerEl)
			.setName("Auto-timestamp new files")
			.setDesc("Automatically submit newly created files to OTS calendars.")
			.addToggle((toggle) => toggle.setValue(true).setDisabled(true));
	}
}
