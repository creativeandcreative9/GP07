# 初版の検証記録

確認日：2026-10-16（日本時間）。対象はこの記録を含む初版実装と、`evidence/source-sha256.txt` に記録したソースです。開発開始時の commit は `92a8522952f745d67c7e615ebdcd3d6f529c8cf0`。実装担当は一名です。

## 確認できたこと

| コマンド / 対象 | 結果 |
| --- | --- |
| `npm ci --cache=/tmp/gp07-npm-cache --no-fund --no-audit` | 成功。lockfile による再インストールを確認 |
| `npm run lint` | 成功 |
| `npm run typecheck` | 成功 |
| `npm test` | 単体・結合 25 件成功。失敗・skip・todo なし |
| `npm run build` | 成功。大きな JS chunk に対する Vite のサイズ警告あり |
| `npm run test:e2e` | Chromium で 6 件成功。失敗・skip なし |
| 開発サーバー | 実際に起動し、ブラウザでデモを取り込み、読み込み完了を確認 |
| `npm run fixtures` | 再生成前後で同一 SHA-256 |
| `npm audit --omit=dev --audit-level=moderate` | 実行時依存物の既知脆弱性 0 件。包括的な安全性保証ではない |

環境：Linux、Node.js 24.19.0、npm 11.9.0、Chromium 154.0.8037.57。ブラウザ試験は SwiftShader による WebGL 2 ソフトウェア描画。desktop 1440×1080、mobile 幅 390 px を使用。

## 試験した内容

- 実際の gzip/tar、YAML、FBXLoader を通し、mesh GUID / fileID `4300000`、3 個の材質スロット、MainTex の参照を期待値と比較。Orbit は 9,396 頂点。
- 欠落した参照、曖昧な fileID、未知 shader、未対応プロパティ、非 identity Transform、FBX の外部／埋め込み画像 node を確認。
- 危険パス、リンク、重複 entry / pathname、meta GUID 不一致、gzip 破損、tar checksum / truncation / 終端後データ、展開合計・entry 数・単体サイズ超過を拒否。
- YAML のタグ・alias・anchor・重複キー・深さ超過、画像ヘッダーの大きすぎる寸法を拒否。
- デモ／ローカル選択、読み込み・失敗・閉じる・再読み込み・クリア、キャンセル後の新しい選択、古い取得結果の無効化、15 秒の deadline、レスポンシブ画面を確認。
- 実際の canvas の画像を比較し、基本色・単段影・輪郭線・回転・ズームが描画を変えることを確認。カメラのリセットとドラッグ・スクロールも試験対象。
- ローカルファイル処理中のブラウザ request を記録。観測された通信は同一 origin の Worker JS の GET のみで、body は null。外部宛て通信、素材の送信、localStorage / sessionStorage の利用は観測されず。これはこの試験経路での結果であり、包括的なセキュリティ監査ではない。

## 証拠

- [desktop](evidence/orbit-desktop.png) / [mobile](evidence/orbit-mobile.png)
- [標準トゥーン](evidence/toon-default.png) / [影なし](evidence/toon-no-shadow.png) / [輪郭線なし](evidence/toon-no-outline.png) / [基本色の変更](evidence/toon-orange.png)
- [ローカル選択時の通信記録](evidence/local-import-network.json)

`test-results/` には各ローカル実行の transient report を出力します。CI は同じコマンドを実行し、スクリーンショット等を artifact に保存する定義を追加しました。GitHub Actions 上での実行結果は今回のローカル確認に含みません。

## 残る確認と次の作業

この段階は、機械生成した自己完結パッケージによる限定的な縦断試作です。M1 全条件の完了、一般的な unitypackage 互換、公開サービスとしての品質は宣言しません。

1. Unity が出力した再配布可能な静的 fixture で import / export の往復、座標系、subasset fileID、UV・色空間を検証する。今回の fixture は Unity 自体では生成・再取り込みしていません。
2. 各予算の境界値全組み合わせ、壊れた画像デコード、極端な FBX/YAML、長時間の連続読み込み・GPU メモリー解放を追加で検証する。初版の試験は代表ケースです。
3. 実機 GPU、Firefox / Safari、タッチ操作、支援技術での操作を確認する。今回の mobile 試験は Chromium の viewport 変更です。
4. バイナリ FBX、スキニング、ネストした Prefab、透過等は別の対応段階として評価する。
5. 正当な同一モデル・同一条件の Unity 基準画像を用意して外観比較を行う。現在は基準画像がなく、一致率を測定していません。

公開・デプロイ・費用の発生は未実施です。クラウド環境の `install_script` / `start_skill` は更新済みのドラフトで、公開は環境設定から行う必要があります。
