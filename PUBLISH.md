**✅ Here's a clear, up-to-date guide on how to publish your VS Code extension to the Visual Studio Marketplace.**

### Step-by-Step: Publish Your AutoDev Extension

#### 1. Prepare Your Extension

Make sure your project is ready:

- Update `package.json` with proper metadata:
```json
{
  "name": "autodev-ai-prompts",
  "displayName": "AutoDev AI Prompts",
  "description": "Send code to Copilot or Claude with predefined prompts and track status",
  "version": "0.1.0",
  "publisher": "YOUR_PUBLISHER_NAME",        // ← Change this
  "icon": "media/icon.png",                  // Recommended (128x128)
  "repository": "https://github.com/yourusername/autodev-vscode",
  "categories": ["AI", "Chat", "Programming Languages"],
  "keywords": ["copilot", "claude", "ai", "chat", "prompt"],
  "license": "MIT"
}
```

- Add a good `README.md` (very important for Marketplace)

#### 2. Create a Microsoft Publisher Account

1. Go to: [https://dev.azure.com/](https://dev.azure.com/)
2. Sign in with your Microsoft account (or create one).
3. Go to **Visual Studio Marketplace Publisher Portal**: [https://marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage)
4. Click **"New publisher"** and create one (choose a short, unique name like `yourname` or `autodev-ai`).

#### 3. Install VSCE (VS Code Extension Publisher)

Run this command:

```bash
npm install -g @vscode/vsce
```

#### 4. Package & Publish

In your extension folder (`h:/ai/autodev-vscode-extension/`), run:

```bash
# 1. Package the extension (creates .vsix file)
vsce package

# 2. Publish to Marketplace
vsce publish
```

You will be asked to log in the first time — follow the browser login process.

---

### Alternative (Easier): Use GitHub + Azure Token

**Recommended way in 2026:**

1. Create a Personal Access Token (PAT) in Azure DevOps:
   - Go to [https://dev.azure.com/](https://dev.azure.com/)
   - User Settings → Personal Access Tokens → New Token
   - Scope: **Marketplace** → `Publish`

2. Then publish using the token:

```bash
vsce publish -p YOUR_PERSONAL_ACCESS_TOKEN
```

---

### Useful Commands

```bash
# Validate before publishing
vsce package --no-dependencies

# Publish with specific version
vsce publish minor     # bumps version 0.1.0 → 0.2.0

# See all options
vsce --help
```

---

### After Publishing

- Your extension will appear on: `https://marketplace.visualstudio.com/items?itemName=YOUR_PUBLISHER_NAME.autodev-ai-prompts`
- It usually takes 5–30 minutes to become public.

---

Would you like me to:

1. Give you the **recommended `package.json`** updates for publishing?
2. Help you create a proper `README.md` for the marketplace?
3. Show you how to add icons, gallery images, and better description?

Just say what you need and I’ll help you step by step.