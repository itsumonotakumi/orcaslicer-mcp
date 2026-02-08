# セットアップガイド

OrcaSlicer MCP Server を使い始めるまでの手順を、OS 別に説明します。

---

## 前提条件

- **Node.js 18 以上** がインストールされていること
- **OrcaSlicer** がインストールされていること
- **Git**（ソースから取得する場合）

Node.js がまだの場合は [公式サイト](https://nodejs.org/) からインストールしてください。

```bash
# バージョン確認
node --version   # v18.x.x 以上であること
npm --version
```

---

## 1. ソースコードの取得

```bash
git clone https://github.com/itsumonotakumi/orcaslicer-mcp.git
cd orcaslicer-mcp
```

## 2. 依存パッケージのインストール

```bash
npm install
```

## 3. ビルド

TypeScript のコンパイルを行います。

```bash
npm run build
```

`dist/` フォルダにコンパイル済みの JavaScript が生成されます。

## 4. 動作確認

```bash
npm start
```

起動するとサーバーは stdio（標準入出力）で MCP プロトコルの接続を待ちます。
これは正常な動作です。AI クライアント（Claude Desktop など）から接続して使います。

---

## OS 別の OrcaSlicer パス

サーバーは OrcaSlicer のバイナリを自動検知しますが、
インストール先が標準と異なる場合は環境変数で指定してください。

### Windows

標準の検知パス:

```
C:\Program Files\OrcaSlicer\orca-slicer.exe
C:\Program Files\OrcaSlicer\orca-slicer-console.exe
```

カスタムパスの指定（PowerShell の場合）:

```powershell
$env:ORCA_SLICER_PATH = "D:\Tools\OrcaSlicer\orca-slicer-console.exe"
npm start
```

> **ヒント**: Windows では `orca-slicer-console.exe` を使うとコンソール出力が取得しやすくなります。

### macOS

標準の検知パス:

```
/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer
```

カスタムパスの指定:

```bash
export ORCA_SLICER_PATH="/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer"
npm start
```

### Linux

標準の検知パス:

```
/usr/bin/orca-slicer
/usr/local/bin/orca-slicer
```

---

## OrcaSlicer の設定フォルダ

サーバーはプロファイル（machine / filament / process）を
OrcaSlicer の設定フォルダから読み込みます。

| OS | デフォルトパス |
|---|---|
| Windows | `%APPDATA%\OrcaSlicer` |
| macOS | `~/Library/Application Support/OrcaSlicer` |
| Linux | `~/.config/OrcaSlicer` |

設定フォルダが標準と異なる場合:

```bash
export ORCA_USER_DIR="/path/to/your/OrcaSlicer/settings"
npm start
```

---

## Claude Desktop への接続設定

Claude Desktop の MCP 設定ファイルに以下を追加してください。

### 設定ファイルの場所

| OS | パス |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

### 設定例

```json
{
  "mcpServers": {
    "orcaslicer": {
      "command": "node",
      "args": [
        "/path/to/orcaslicer-mcp/dist/index.js",
        "--workdir=/path/to/your/3d_projects"
      ],
      "env": {
        "ORCA_SLICER_PATH": "/path/to/orca-slicer",
        "MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

各パスは自分の環境に合わせて書き換えてください。

### Windows の場合の設定例

```json
{
  "mcpServers": {
    "orcaslicer": {
      "command": "node",
      "args": [
        "C:\\Users\\YourName\\orcaslicer-mcp\\dist\\index.js",
        "--workdir=C:\\Users\\YourName\\3DPrinting"
      ],
      "env": {
        "ORCA_SLICER_PATH": "C:\\Program Files\\OrcaSlicer\\orca-slicer-console.exe"
      }
    }
  }
}
```

### macOS の場合の設定例

```json
{
  "mcpServers": {
    "orcaslicer": {
      "command": "node",
      "args": [
        "/Users/yourname/orcaslicer-mcp/dist/index.js",
        "--workdir=/Users/yourname/3DPrinting"
      ]
    }
  }
}
```

設定を保存したら Claude Desktop を再起動してください。

---

## 正しくセットアップできたか確認する

Claude Desktop に接続できたら、以下のように話しかけてみてください:

> 「OrcaSlicer の環境を診断して」

AI が `health_check` ツールを呼び出し、以下のような結果を返します:

```
- バイナリ: 見つかった
- 設定フォルダ: アクセス可能
- 作業フォルダ: アクセス可能
```

すべて正常であれば、セットアップ完了です。

---

次のステップ: [ツールリファレンス](tools-reference.md) で各ツールの使い方を確認しましょう。
