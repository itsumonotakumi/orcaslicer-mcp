# トラブルシューティング

よくあるエラーとその解決方法をまとめました。

---

## エラーの種類

サーバーが返すエラーは、原因に応じて以下の 4 種類に分類されています。

| エラー表示 | 意味 |
|---|---|
| `[403 Forbidden]` | アクセスが許可されていないパスへの操作 |
| `[404 Not Found]` | 指定されたファイルが見つからない |
| `[Parse Error]` | ファイルの中身が正しい JSON ではない |
| `[CLI Error]` | OrcaSlicer の実行に失敗した |

---

## よくある問題と解決方法

### OrcaSlicer のバイナリが見つからない

**症状**: `health_check` で `binaryFound: false` と表示される

**原因**: OrcaSlicer が標準の場所にインストールされていない

**解決方法**:

1. OrcaSlicer がインストールされているか確認する
2. インストール先のパスを特定する
3. 環境変数で指定する

```bash
# 例: macOS でインストール先が異なる場合
export ORCA_SLICER_PATH="/path/to/OrcaSlicer"
npm start
```

または `.env` ファイルに記述:

```
ORCA_SLICER_PATH=/path/to/OrcaSlicer
```

---

### 設定フォルダにアクセスできない

**症状**: `health_check` で `userDirAccessible: false` と表示される

**原因**:
- OrcaSlicer を一度も起動していない（設定フォルダがまだ作られていない）
- 設定フォルダの場所が標準と異なる

**解決方法**:

1. まず OrcaSlicer を一度起動して閉じる（設定フォルダが自動生成されます）
2. それでも解決しない場合は環境変数で指定:

```bash
export ORCA_USER_DIR="/path/to/OrcaSlicer/settings"
```

---

### プロファイルが一覧に表示されない

**症状**: `list_profiles` の結果が空の配列 `[]`

**原因**:
- 設定フォルダ内にプロファイルの JSON ファイルがない
- サーバーが参照している設定フォルダが間違っている

**解決方法**:

1. `health_check` で `userDir` のパスを確認する
2. そのフォルダの中に `machine/`, `filament/`, `process/` サブフォルダがあるか確認する
3. サブフォルダ内に `.json` ファイルがあるか確認する

> **ヒント**: OrcaSlicer の GUI でプロファイルを保存すると、
> 対応するフォルダに JSON ファイルが生成されます。

---

### 「403 Forbidden」エラーが出る

**症状**: ファイルの読み書きで `[403 Forbidden]` が返される

**原因**: アクセスしようとしたパスが、許可されたフォルダ（作業フォルダまたは設定フォルダ）の外にある

**解決方法**:

- ファイルが作業フォルダ内にあるか確認する
- `--workdir` で正しい作業フォルダを指定しているか確認する
- ファイル名に `../` などの不正な文字が含まれていないか確認する

---

### 「404 Not Found」でファイルが見つからない

**症状**: ファイルを指定したのに `[404 Not Found]` が返される

**原因**:
- ファイル名のスペルミス
- ファイルが作業フォルダ内にない
- 拡張子の指定漏れ

**解決方法**:

1. `list_profiles` でファイル名を正確に確認する（拡張子 `.json` も含める）
2. STL / G-code ファイルの場合、作業フォルダに置かれているか確認する
3. ファイル名は大文字小文字を区別するので注意する

---

### スライスがタイムアウトする

**症状**: `slice_model` で `[CLI Error]` が返され、タイムアウトのメッセージが含まれる

**原因**:
- モデルが非常に大きく、スライスに 5 分以上かかる
- OrcaSlicer のプロセスがハングアップしている

**解決方法**:

1. タイムアウトを延長する（AI に「タイムアウトを 10 分にして」と伝える）
2. より小さなモデルで動作確認する
3. OrcaSlicer の GUI でスライスが正常に完了するか確認する

---

### スライスは成功するが G-code が生成されない

**症状**: `slice_model` が成功を返すのに、ファイルが見つからない

**原因**:
- 出力ファイル名が意図と異なる
- OrcaSlicer が別の場所にファイルを出力した

**解決方法**:

1. 出力ファイル名（`output_file`）を確認する
2. 作業フォルダの中身を確認する

---

### JSON のパースエラー

**症状**: `[Parse Error] Failed to parse JSON from ...`

**原因**:
- プロファイルの JSON ファイルが壊れている
- ファイルの内容が JSON 形式ではない

**解決方法**:

1. OrcaSlicer の GUI でプロファイルを再保存する
2. テキストエディタでファイルを開き、JSON として正しいか確認する
3. `_tuned` コピーが壊れた場合は、削除して元ファイルから再作成する

---

### サーバーが起動しない

**症状**: `npm start` でエラーが出る

**よくある原因と対処**:

| エラーメッセージ | 対処 |
|---|---|
| `Cannot find module` | `npm install` を実行する |
| `dist/index.js not found` | `npm run build` を実行する |
| `SyntaxError: Cannot use import` | Node.js のバージョンが 18 未満。アップデートする |

```bash
# 基本の復旧手順
npm install && npm run build && npm start
```

---

### ログを見て原因を調べたい

デバッグレベルのログを有効にすると、すべてのツール呼び出しと引数が表示されます。

```bash
MCP_LOG_LEVEL=debug npm start
```

ログは標準エラー出力（stderr）に JSON 形式で出力されます:

```json
{"ts":"2025-01-15T10:30:00.000Z","level":"debug","message":"Tool called: list_profiles","args":{"type":"machine"}}
```

---

## それでも解決しない場合

1. `health_check` の結果をすべて確認する
2. `MCP_LOG_LEVEL=debug` でログを取得する
3. [GitHub Issues](https://github.com/itsumonotakumi/orcaslicer-mcp/issues) で報告する

報告時は以下の情報を含めてください:
- OS とバージョン
- Node.js のバージョン（`node --version`）
- OrcaSlicer のバージョン
- `health_check` の出力結果
- エラーメッセージの全文

---

次のステップ: [実践ワークフロー](examples.md) で具体的な使い方を見てみましょう。
