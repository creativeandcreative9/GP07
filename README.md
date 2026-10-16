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

v0.3 の限定試作です。**一般的なアバターの unitypackage に対応した完成品ではありません。**

- gzip/tar の入力を Worker で検査し、GUID・fileID で FBX、材質、画像を解決します。
- 単一 Prefab 内の GameObject の親子階層と、最大32部品の静的メッシュに対応します。位置・回転・拡大縮小・鏡像と、有効／無効状態を反映します。
- 静的・三角形 FBX 7.4（ASCII／バイナリ）の複数 geometry を meta の fileID で選び、PNG/JPEG と材質を結びます。FBX の単位をメートルへ揃え、インポート時の倍率も反映します。
- lilToon 2.3.2 の `Hidden/lilToonOutline` の GUID を識別し、基本色・MainTex・単段影・輪郭線を近似します。未知のシェーダーは警告付きの代替表示です。
- スキニング、FBX 7.5、別 Prefab の埋め込み、Prefab Variant、アニメーション、透過、一般的な Unity importer の互換性は未対応です。
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

デモは `public/fixtures/orbit-hierarchy.unitypackage` を読み込みます。ロボットと二つの付属部品で、親子の回転や異なるスケール・材質を確認できます。単一メッシュの ASCII 版 `orbit.unitypackage` とバイナリ版 `orbit-binary.unitypackage` も同梱しています。すべて本リポジトリの [生成スクリプト](scripts/generate-fixture.mjs) で作る自作素材です。`npm run fixtures` で同じバイト列を再生成できます。第三者のモデル・テクスチャを含みません。Unity が書き出したパッケージではなく、対応プロファイルの機械生成テスト素材です。

[依存物・描画仕様の出典](docs/dependencies.md) とライセンス表示を同梱しています。
