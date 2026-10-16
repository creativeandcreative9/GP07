# v0.2 の検証記録

確認日：2026-10-16（日本時間）。対象はこの記録を含む v0.2 実装と、`evidence/source-sha256.txt` に記録したソースです。今回の開発開始時の commit は `d9bd5394f921645114db2f86a42ac3ea8ddb4b9f`。実装担当は一名です。

v0.2 では静的なバイナリ FBX 7.4 を追加しました。圧縮された配列を上限付きで検査し、非圧縮に正規化してから FBXLoader に渡します。デモも同じ自作モデルのバイナリ版に変更しました。

## 確認できたこと

| コマンド / 対象 | 結果 |
| --- | --- |
| 依存物 | 追加なし。前回導入済みの固定依存物を利用 |
| `npm run lint` | 成功 |
| `npm run typecheck` | 成功 |
| `npm test` | 単体・結合 52 件成功（既存25件、新規27件）。失敗・skip・todo なし |
| `npm run build` | 成功。大きな JS chunk に対する Vite のサイズ警告あり |
| `npm run test:e2e` | Chromium で 7 件成功。失敗・skip なし |
| preview サーバー | 実際に起動し、ブラウザで圧縮バイナリ版デモを取り込み、読み込み完了を確認 |
| `npm run fixtures` | ASCII／バイナリ両方で再生成前後の SHA-256 一致 |

新しい外部依存物は導入していません。前回の npm audit では実行時依存物の既知脆弱性は 0 件でしたが、今回は監査を再実行していません。

環境：Linux、Node.js 24.19.0、npm 11.9.0、Chromium 154.0.8037.57。ブラウザ試験は SwiftShader による WebGL 2 ソフトウェア描画。desktop 1440×1080、mobile 幅 390 px を使用。

## 試験した内容

- 実際の gzip/tar、YAML、FBXLoader を通し、mesh GUID / fileID `4300000`、3 個の材質スロット、MainTex の参照を期待値と比較。Orbit は 9,396 頂点。
- 同じ形状を、ASCII／圧縮バイナリ／非圧縮バイナリの三形式で取り込み、頂点・法線・UV の全バイト列、素材スロット・材質・GUID/fileID が一致することを確認。ブラウザでも ASCII／圧縮バイナリの canvas 画像が一致。
- バイナリの version、node offset、property count / length、配列 count / 圧縮方式 / packed length、実際の展開長、zlib checksum、深さ、非有限数値、安全な整数範囲外の ID、raw blob、危険キー・未対応 node を検査。宣言長より大きく展開されるデータ、配列要素合計超過、描画頂点上限超過を拒否。
- 正規化後に配列が非圧縮であることと元バイト列が不変であることを確認。壊れたバイナリのエラー表示後に、正常な非圧縮バイナリを再選択して復帰。
- 欠落した参照、曖昧な fileID、未知 shader、未対応プロパティ、非 identity Transform、FBX の外部／埋め込み画像 node を確認。
- 危険パス、リンク、重複 entry / pathname、meta GUID 不一致、gzip 破損、tar checksum / truncation / 終端後データ、展開合計・entry 数・単体サイズ超過を拒否。
- YAML のタグ・alias・anchor・重複キー・深さ超過、画像ヘッダーの大きすぎる寸法を拒否。
- デモ／ローカル選択、読み込み・失敗・閉じる・再読み込み・クリア、キャンセル後の新しい選択、古い取得結果の無効化、15 秒の deadline、レスポンシブ画面を確認。
- 実際の canvas の画像を比較し、基本色・単段影・輪郭線・回転・ズームが描画を変えることを確認。カメラのリセットとドラッグ・スクロールも試験対象。
- ローカルファイル処理中のブラウザ request を記録。観測された通信は同一 origin の Worker JS の GET のみで、body は null。外部宛て通信、素材の送信、localStorage / sessionStorage の利用は観測されず。これはこの試験経路での結果であり、包括的なセキュリティ監査ではない。

## 証拠

- [desktop](evidence/orbit-desktop.png) / [mobile](evidence/orbit-mobile.png)
- [バイナリ FBX の取り込み](evidence/orbit-binary.png)
- [標準トゥーン](evidence/toon-default.png) / [影なし](evidence/toon-no-shadow.png) / [輪郭線なし](evidence/toon-no-outline.png) / [基本色の変更](evidence/toon-orange.png)
- [ローカル選択時の通信記録](evidence/local-import-network.json)

`test-results/` には各ローカル実行の transient report を出力します。CI は同じコマンドを実行し、スクリーンショット等を artifact に保存する定義を追加しました。GitHub Actions 上での実行結果は今回のローカル確認に含みません。

## 残る確認と次の作業

この段階は、機械生成した自己完結パッケージによる限定的な縦断試作です。M1 全条件の完了、一般的な unitypackage 互換、公開サービスとしての品質は宣言しません。

1. Unity が出力した再配布可能な静的 fixture で import / export の往復、座標系、subasset fileID、UV・色空間を検証する。今回の fixture は Unity 自体では生成・再取り込みしていません。
2. 各予算の境界値全組み合わせ、壊れた画像デコード、極端な FBX/YAML、長時間の連続読み込み・GPU メモリー解放を追加で検証する。初版の試験は代表ケースです。
3. 実機 GPU、Firefox / Safari、タッチ操作、支援技術での操作を確認する。今回の mobile 試験は Chromium の viewport 変更です。
4. FBX 7.5、スキニング、ネストした Prefab、透過等は別の対応段階として評価する。今回のバイナリ対応は 7.4 の静的・単一メッシュを対象にしたものです。
5. 正当な同一モデル・同一条件の Unity 基準画像を用意して外観比較を行う。現在は基準画像がなく、一致率を測定していません。

Web サービスのデプロイ・費用の発生は未実施です。クラウド環境の再利用手順は環境設定のドラフトとして管理します。「開発環境の公開」は Codex の後続タスクで使う確定版を作る操作で、Web サービスを一般公開する操作とは別です。
