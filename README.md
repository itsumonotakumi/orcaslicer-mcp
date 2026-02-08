# OrcaSlicer MCP Server

OrcaSlicer を AI エージェントから操作するための MCP (Model Context Protocol) サーバーです。

プロファイルの探索・設定変更・スライス実行・G-code 解析までを、
Claude などの AI アシスタントを通して安全に行えます。

---

## できること

| やりたいこと | 使うツール |
|---|---|
| どんなプロファイルがあるか確認したい | `list_profiles` |
| 設定項目をキーワードで探したい | `search_settings` |
| プロファイルの中身を読みたい | `get_profile_content` |
| 印刷設定を調整したい | `update_profile_setting` |
| STL/3MF をスライスしたい | `slice_model` |
| G-code の印刷時間やフィラメント量を確認したい | `analyze_gcode_metadata` |
| サーバーの動作環境を診断したい | `health_check` |

## クイックスタート

```bash
# 1. インストール & ビルド
npm install && npm run build

# 2. 起動（カレントディレクトリが作業フォルダになります）
npm start

# 作業フォルダを指定して起動する場合
npm start -- --workdir="./my_3d_projects"
```

## ドキュメント

| ドキュメント | 内容 |
|---|---|
| [セットアップガイド](docs/setup-guide.md) | OS 別のインストール手順、OrcaSlicer の準備 |
| [設定ガイド](docs/configuration.md) | 環境変数、`.env` ファイル、起動オプション |
| [ツールリファレンス](docs/tools-reference.md) | 全 7 ツールの引数・戻り値・使い方 |
| [実践ワークフロー](docs/examples.md) | 「探索→調整→スライス→評価」の具体例 |
| [安全性について](docs/safety.md) | サンドボックス、ファイル保護の仕組み |
| [トラブルシューティング](docs/troubleshooting.md) | よくあるエラーと解決方法 |

## 対応環境

- Node.js 18 以上
- Windows 11 / macOS (Intel & Apple Silicon)
- OrcaSlicer がインストール済みであること

## ライセンス

AGPL-3.0
