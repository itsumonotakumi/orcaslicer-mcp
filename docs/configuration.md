# 設定ガイド

サーバーの動作を環境変数、`.env` ファイル、起動引数で制御する方法を説明します。

---

## 環境変数一覧

| 変数名 | 説明 | デフォルト |
|---|---|---|
| `ORCA_SLICER_PATH` | OrcaSlicer バイナリのフルパス | OS に応じて自動検知 |
| `ORCA_USER_DIR` | OrcaSlicer の設定フォルダのパス | OS に応じて自動検知 |
| `MCP_LOG_LEVEL` | ログの出力レベル | `info` |

---

## 環境変数の詳細

### ORCA_SLICER_PATH

OrcaSlicer のバイナリが標準のインストール先にない場合に指定します。

指定しない場合、OS に応じて以下の順に自動検知します:

**Windows:**
1. `C:\Program Files\OrcaSlicer\orca-slicer.exe`
2. `C:\Program Files\OrcaSlicer\orca-slicer-console.exe`

**macOS:**
1. `/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer`

**Linux:**
1. `/usr/bin/orca-slicer`
2. `/usr/local/bin/orca-slicer`

```bash
# 例: ポータブル版を使う場合
export ORCA_SLICER_PATH="/opt/OrcaSlicer/orca-slicer"
```

### ORCA_USER_DIR

OrcaSlicer がプロファイル（machine / filament / process）を保存しているフォルダです。

指定しない場合の自動検知先:

| OS | デフォルトパス |
|---|---|
| Windows | `%APPDATA%\OrcaSlicer` |
| macOS | `~/Library/Application Support/OrcaSlicer` |
| Linux | `~/.config/OrcaSlicer` |

```bash
# 例: テスト用の設定フォルダを使う場合
export ORCA_USER_DIR="$HOME/orca-test-profiles"
```

### MCP_LOG_LEVEL

サーバーのログ出力レベルを制御します。ログは標準エラー出力（stderr）に出力されます。

| 値 | 説明 |
|---|---|
| `debug` | すべてのログを出力。ツール呼び出しの引数なども表示される |
| `info` | 通常の動作ログ（起動、ファイル書き込みなど）を出力 |
| `error` | エラーのみ出力 |

```bash
# 問題を調査するとき
export MCP_LOG_LEVEL="debug"

# 本番利用時
export MCP_LOG_LEVEL="error"
```

---

## .env ファイル

プロジェクトルートに `.env` ファイルを作成すると、
環境変数を毎回指定しなくても自動的に読み込まれます。

### .env ファイルの作成例

```bash
# orcaslicer-mcp/.env

# OrcaSlicer のバイナリパス
ORCA_SLICER_PATH=/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer

# OrcaSlicer の設定フォルダ（省略すると自動検知）
# ORCA_USER_DIR=/path/to/settings

# ログレベル
MCP_LOG_LEVEL=info
```

> **注意**: `.env` ファイルは `.gitignore` に含まれているので、
> Git リポジトリにはコミットされません。

---

## 起動引数

### --workdir

作業ディレクトリ（STL / 3MF / G-code の置き場所）を指定します。

```bash
# カレントディレクトリを使う場合（デフォルト）
npm start

# 特定のフォルダを指定する場合
npm start -- --workdir="./my_3d_projects"

# 絶対パスでの指定
npm start -- --workdir="/Users/yourname/3DPrinting"
```

指定しない場合は `npm start` を実行したディレクトリが作業フォルダになります。

#### 作業フォルダの役割

- `slice_model` の入力ファイル（STL / 3MF）はここから読み込まれます
- `slice_model` の出力ファイル（G-code）はここに保存されます
- `analyze_gcode_metadata` で解析する G-code もここから読み込まれます
- `tuning_history.log`（変更履歴）もここに保存されます

---

## 設定の優先順位

同じ設定が複数の方法で指定された場合、以下の優先順位で適用されます:

1. **環境変数**（直接指定、最優先）
2. **`.env` ファイル**
3. **自動検知**（デフォルト）

起動引数（`--workdir`）はそれ専用のオプションなので、常にそのまま適用されます。

---

## npm スクリプト一覧

| コマンド | 説明 |
|---|---|
| `npm start` | サーバーを起動する |
| `npm run build` | TypeScript をコンパイルする |
| `npm run dev` | ファイル変更を監視して自動コンパイル（開発用） |
| `npm test` | テストを実行する |
| `npm run test:watch` | ファイル変更を監視して自動テスト（開発用） |
| `npm run lint` | 型チェックのみ実行する（コンパイルはしない） |

---

次のステップ: [安全性について](safety.md) でサンドボックスの仕組みを確認しましょう。
