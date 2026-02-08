# ツールリファレンス

OrcaSlicer MCP Server が提供する全 7 ツールの詳細な使い方です。

> AI に話しかけるだけでツールは自動的に選ばれますが、
> どんなツールがあるかを知っておくと、より的確な指示が出せます。

---

## 目次

- [A. 設定探索・管理](#a-設定探索管理)
  - [list_profiles](#list_profiles)
  - [search_settings](#search_settings)
  - [get_profile_content](#get_profile_content)
  - [update_profile_setting](#update_profile_setting)
- [B. スライス実行・解析](#b-スライス実行解析)
  - [slice_model](#slice_model)
  - [analyze_gcode_metadata](#analyze_gcode_metadata)
- [C. システム診断](#c-システム診断)
  - [health_check](#health_check)

---

## A. 設定探索・管理

### list_profiles

プロファイルの一覧を取得します。

**「どんなプリンター設定があるか見たい」** というときに使います。

#### 引数

| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `type` | `"machine"` \| `"filament"` \| `"process"` | はい | 取得したいプロファイルの種別 |

#### プロファイル種別の意味

| 値 | 意味 | 含まれる設定の例 |
|---|---|---|
| `machine` | プリンター本体の設定 | ベッドサイズ、ノズル径、最大速度 |
| `filament` | フィラメントの設定 | 素材タイプ、温度、ファン速度 |
| `process` | 印刷品質・条件の設定 | レイヤー高さ、インフィル、速度 |

#### 戻り値の例

```json
{
  "type": "machine",
  "profiles": [
    "Bambu Lab X1 Carbon 0.4 nozzle.json",
    "Prusa MK4.json",
    "my_custom_printer.json"
  ]
}
```

#### AI への話しかけ方の例

- 「使えるプリンターの一覧を見せて」
- 「フィラメントのプロファイルは何がある？」
- 「プロセス設定の一覧を出して」

---

### search_settings

**設定項目のキー名がわからなくても、キーワードで検索できるツール** です。
OrcaSlicer には数百の設定項目がありますが、このツールを使えば
「インフィルに関する設定」「速度に関する設定」などを手軽に探せます。

#### 引数

| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `query` | 文字列 | はい | 検索キーワード（例: `"infill"`, `"speed"`, `"temperature"`） |
| `type` | `"machine"` \| `"filament"` \| `"process"` | いいえ | 検索範囲をプロファイル種別で絞り込む |

#### 戻り値の例

`query: "infill"` で検索した場合:

```json
{
  "query": "infill",
  "matches": [
    {
      "type": "process",
      "profile": "standard_quality.json",
      "key": "infill_density",
      "value": 20
    },
    {
      "type": "process",
      "profile": "standard_quality.json",
      "key": "infill_pattern",
      "value": "grid"
    }
  ]
}
```

#### AI への話しかけ方の例

- 「インフィルに関する設定を探して」
- 「速度に関係する項目を全部見たい」
- 「温度設定はフィラメントプロファイルのどこ？」
- 「サポートに関する設定をプロセスプロファイルから探して」

---

### get_profile_content

プロファイルの全内容を JSON として読み込みます。

#### 引数

| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `type` | `"machine"` \| `"filament"` \| `"process"` | はい | プロファイル種別 |
| `name` | 文字列 | はい | プロファイルのファイル名（`.json` 付き） |

#### 戻り値の例

```json
{
  "layer_height": 0.2,
  "infill_density": 20,
  "infill_pattern": "grid",
  "print_speed": 60,
  "travel_speed": 120,
  "support_enabled": false
}
```

#### AI への話しかけ方の例

- 「standard_quality.json の中身を見せて」
- 「PLA Generic のフィラメント設定を読み込んで」

> **ヒント**: まず `list_profiles` でファイル名を確認してから使うとスムーズです。

---

### update_profile_setting

プロファイルの設定値を 1 つ変更します。

#### 安全機能: dry_run モード

デフォルトでは **元のファイルを上書きしません**。
代わりに `_tuned` という接尾辞のついたコピーファイルに保存されます。

例: `standard_quality.json` → `standard_quality_tuned.json`

これにより、元の設定はいつでも戻せます。

#### 引数

| 名前 | 型 | 必須 | デフォルト | 説明 |
|---|---|---|---|---|
| `type` | `"machine"` \| `"filament"` \| `"process"` | はい | - | プロファイル種別 |
| `name` | 文字列 | はい | - | 元のプロファイルのファイル名 |
| `key` | 文字列 | はい | - | 変更したい設定キー |
| `value` | 任意 | はい | - | 新しい値 |
| `dry_run` | 真偽値 | いいえ | `true` | `true`: コピーに保存 / `false`: 元ファイルを直接上書き |

#### 戻り値の例

```json
{
  "success": true,
  "profile": "standard_quality_tuned.json",
  "key": "infill_density",
  "oldValue": 20,
  "newValue": 40,
  "dry_run": true
}
```

#### AI への話しかけ方の例

- 「インフィル密度を 40% に上げて」
- 「レイヤー高さを 0.1mm にして高品質にしたい」
- 「ノズル温度を 215 度に変更して、元のファイルは残して」
- 「印刷速度を 80mm/s にして、今回は元ファイルを直接書き換えて」（dry_run=false）

#### 変更履歴

すべての変更は作業ディレクトリの `tuning_history.log` に記録されます。
いつ、どの設定を、どう変えたかを後から確認できます。

---

## B. スライス実行・解析

### slice_model

OrcaSlicer を呼び出して STL / 3MF ファイルをスライスし、G-code を生成します。

#### 引数

| 名前 | 型 | 必須 | デフォルト | 説明 |
|---|---|---|---|---|
| `input_file` | 文字列 | はい | - | 入力ファイル名（作業フォルダ内の STL / 3MF） |
| `output_file` | 文字列 | はい | - | 出力する G-code のファイル名 |
| `profile_machine` | 文字列 | いいえ | - | 使用するマシンプロファイルのファイル名 |
| `profile_filament` | 文字列 | いいえ | - | 使用するフィラメントプロファイルのファイル名 |
| `profile_process` | 文字列 | いいえ | - | 使用するプロセスプロファイルのファイル名 |
| `timeout_ms` | 数値 | いいえ | `300000` | タイムアウト（ミリ秒）。デフォルト 5 分 |

#### ファイルの置き場所

- 入力ファイル（STL / 3MF）は **作業フォルダ** に置いてください
- 出力される G-code も作業フォルダに保存されます

#### 戻り値の例

```json
{
  "success": true,
  "output_file": "benchy.gcode",
  "stdout": "...(OrcaSlicer の出力)...",
  "stderr": ""
}
```

#### AI への話しかけ方の例

- 「benchy.stl をスライスして」
- 「test_cube.stl を PLA 設定でスライスして、G-code を cube_output.gcode にして」
- 「この STL を高品質設定でスライスしてほしい。マシンは Bambu Lab X1 で」

#### タイムアウトについて

大きなモデルのスライスには時間がかかることがあります。
デフォルトは 5 分（300,000 ミリ秒）ですが、必要に応じて延長できます。

---

### analyze_gcode_metadata

G-code ファイルの末尾に記録された統計情報（メタデータ）を読み取り、
構造化された JSON として返します。

#### 引数

| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `file` | 文字列 | はい | G-code のファイル名（作業フォルダ内） |

#### 取得できる情報

| フィールド | 型 | 説明 |
|---|---|---|
| `estimatedTime` | 文字列 | 推定印刷時間（例: `"2h 15m 30s"`） |
| `filamentUsedMm` | 数値 | フィラメント使用量（mm） |
| `filamentUsedG` | 数値 | フィラメント使用量（グラム） |
| `filamentCost` | 数値 | フィラメントコスト |
| `layerCount` | 数値 | 総レイヤー数 |

※ OrcaSlicer / PrusaSlicer 形式のメタデータコメントに対応しています。

#### 戻り値の例

```json
{
  "estimatedTime": "2h 15m 30s",
  "filamentUsedMm": 12345.67,
  "filamentUsedG": 37.5,
  "filamentCost": 1.23,
  "layerCount": 150
}
```

#### AI への話しかけ方の例

- 「さっき生成した G-code の印刷時間を教えて」
- 「benchy.gcode のフィラメント使用量は？」
- 「スライス結果を分析して、コストとレイヤー数を教えて」

---

## C. システム診断

### health_check

サーバーの動作環境を診断します。引数はありません。

#### 確認される項目

| 項目 | 説明 |
|---|---|
| `orcaSlicerPath` | OrcaSlicer バイナリのパス |
| `binaryFound` | バイナリが見つかったかどうか |
| `userDir` | OrcaSlicer 設定フォルダのパス |
| `userDirAccessible` | 設定フォルダにアクセスできるかどうか |
| `workDir` | 作業フォルダのパス |
| `workDirAccessible` | 作業フォルダにアクセスできるかどうか |

#### 戻り値の例

```json
{
  "orcaSlicerPath": "/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer",
  "binaryFound": true,
  "userDir": "/Users/yourname/Library/Application Support/OrcaSlicer",
  "userDirAccessible": true,
  "workDir": "/Users/yourname/3DPrinting",
  "workDirAccessible": true
}
```

#### AI への話しかけ方の例

- 「環境を診断して」
- 「OrcaSlicer はちゃんと使える状態？」
- 「ヘルスチェックして」

---

次のステップ: [実践ワークフロー](examples.md) で具体的な使い方の流れを確認しましょう。
