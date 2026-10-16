# GP07 — ブラウザキャラクタービューア

Unity を起動せず、手元の `.unitypackage` のキャラクターをブラウザで開き、元の見た目に近く表示する試作プロジェクトです。

## 初期方針

- 初版は lilToon の基本色・影・輪郭線を対象にします。完全互換ではありません。
- 読み込む素材はブラウザ内で処理する方針です。パッケージ内のスクリプトは実行しません。
- 対応範囲と未対応機能を明示します。
- Unity の同一モデル・同一条件の基準画像を用意できるまでは、再現性の比較を検証済みとは扱いません。
- 第三者のモデルや有料素材をこの公開リポジトリに再配布しません。

## 起動

Node.js 24.19.0、npm 11.9.0 で確認しています。Unity、サーバー側の変換処理、API キーは不要です。

```sh
npm ci
npm run dev
```

「Orbit を読み込む」で自作フィクスチャを取り込みます。手元のファイルは選択またはドラッグ＆ドロップできます。回転・ズーム・リセット、基本色・影・輪郭線・ライトの調整、キャンセル・クリアに対応しています。

## 現在の対応範囲

初版の縦断試作です。**一般的なアバターの unitypackage に対応した完成品ではありません。**

- gzip/tar の入力を Worker で検査し、GUID・fileID で FBX、材質、画像を解決します。
- 単一 GameObject の Prefab、単一の静的・三角形 ASCII FBX 7.4、PNG/JPEG を対象にします。
- lilToon 2.3.2 の `Hidden/lilToonOutline` の GUID を識別し、基本色・MainTex・単段影・輪郭線を近似します。未知のシェーダーは警告付きの代替表示です。
- スキニング、バイナリ FBX、ネスト、Prefab Variant、アニメーション、透過、一般的な Unity importer の互換性は未対応です。
- 素材はメモリー内で処理し、保存・送信しません。パッケージ内のコードは実行しません。

詳細は [対応プロファイル](docs/supported-profile.md)、設計意図は [開発方針書](docs/development-plan.md)、結果と残る確認は [検証記録](docs/validation.md) を参照してください。Unity との外観比較は未検証で、M1 全体の完了は宣言していません。

## 開発・検証

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

ブラウザ試験は Linux の `/usr/bin/chromium` を使用します。別の場所にある Chromium を使う場合は `CHROMIUM_PATH` に実行ファイルのパスを指定してください。ヘッドレス試験では SwiftShader を使い、GPU がなくても描画を検証します。

`npm run preview` はビルド成果物を確認するためのローカルサーバーです。公開先の設定・デプロイは含みません。

## フィクスチャと権利

`public/fixtures/orbit.unitypackage` は本リポジトリの [生成スクリプト](scripts/generate-fixture.mjs) で作る自作ロボットです。`npm run fixtures` で同じバイト列を再生成できます。第三者のモデル・テクスチャを含みません。Unity が書き出したパッケージではなく、対応プロファイルの機械生成テスト素材です。

[依存物・描画仕様の出典](docs/dependencies.md) とライセンス表示を同梱しています。
