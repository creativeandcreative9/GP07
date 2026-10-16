# 依存物と出典

採用バージョンは package.json と package-lock.json で固定します。npm の integrity / TLS 検証は有効なまま導入しています。

| 用途 | 採用物 | ライセンス |
| --- | --- | --- |
| 描画・静的 FBX loader・操作 | Three.js 0.186.1 | MIT（[表示](licenses/three-MIT.txt)） |
| Unity テキストの限定 YAML 解析 | yaml 2.9.1 | ISC（[表示](licenses/yaml-ISC.txt)） |
| gzip 展開 | ブラウザ標準 DecompressionStream | ブラウザの実装 |
| tar 読み取り | src/core/archive.ts | 本プロジェクト実装 |
| ビルド・型 | Vite 8.3.4、TypeScript 6.0.3 | MIT / Apache-2.0 |
| テスト | Vitest 5.0.5、Playwright 1.64.1 | MIT / Apache-2.0 |
| 静的検査・整形 | ESLint 10.12.0、typescript-eslint 8.71.2、Prettier 3.9.10 | MIT |

開発時の依存物は製品のモデル読み込み処理には入りません。各依存物の実際のライセンス全文はインストール先にも含まれます。Blender importer や第三者モデルは導入していません。

ビルド成果物にも `public/THIRD_PARTY_NOTICES.txt` をコピーし、実行時依存物と参照仕様の表示を保持します。

## lilToon の参照

- [lilToon 2.3.2](https://github.com/lilxyzw/lilToon/tree/56d5095b02e795bc60b5f80f72558d7835c5c14e)
- 対象 commit: `56d5095b02e795bc60b5f80f72558d7835c5c14e`
- 参照ファイル: `Assets/lilToon/Shader/lts_o.shader`、同 `.meta`、`ltspass_opaque.shader`。
- 確認項目: shader GUID、`_Color` / `_MainTex` / `_UseShadow` / `_ShadowColor` / `_ShadowBorder` / `_OutlineColor` / `_OutlineWidth` の名前と既定値。
- ShaderLab / HLSL の移植はせず、ブラウザ用の小さな段階影・hull outline を独自に実装。描画仕様の差は [対応プロファイル](supported-profile.md) に記載。
- [MIT 表示](licenses/lilToon-MIT.txt) を保持しています。Unity 側コードや素材へ利用許諾を拡張するものではありません。

Unity の [テキスト形式](https://docs.unity3d.com/Manual/FormatDescription.html)・[meta](https://docs.unity3d.com/Manual/AssetMetadata.html) を設計上の参照先としています。今回のクラウドから Unity ドキュメントへの取得は HTTP 403 で、現行文書の再取得はできませんでした。本実装は自作の限定プロファイルで試験し、Unity エディターの出力との互換性は未検証です。

## 自作素材

Orbit の geometry、UV、PNG、Prefab、meta、材質、tar は `scripts/generate-fixture.mjs` で生成します。形状は球・円柱・箱から構成したオリジナルのロボットです。PNG はスクリプトで生成した 8×8 チェッカーです。第三者のキャラクターや有料素材は含みません。生成物はこのプロジェクトの開発・試験用として再生成・改変できます。
