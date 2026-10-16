# v0.3 の対応プロファイル

この文書は実装の条件を定義します。一般的な Unity / lilToon importer の互換性を示すものではありません。読み込めない条件はエラーまたは警告にします。

## 入力と予算

| 項目 | 制限 |
| --- | --- |
| gzip 入力 | 32 MiB |
| 展開合計 | 128 MiB。ストリーム中に加算して超過を拒否 |
| tar entry | 2,000。通常ファイルと GUID ディレクトリのみ |
| 単体 asset | 32 MiB |
| YAML / meta | 各 1 MiB、深さ 32、20,000 ノード |
| FBX | 入力 16 MiB、ASCII／バイナリ 7.4、静的、三角形、1–32 メッシュ |
| バイナリ FBX の正規化後 | 64 MiB、配列要素合計 4,500,000、各配列 1,500,000 以下 |
| バイナリ FBX の構造 | 深さ 64、20,000 node record、1 node の property 20,000、合計 property 100,000 以下 |
| Prefab 階層 | GameObject 128、深さ 32、表示する MeshRenderer 32 以下 |
| 材質 | 1 renderer のスロット 32、全体の一意な材質 GUID 128 以下 |
| 頂点 | 解析する全 FBX の合計と表示インスタンスの合計が、それぞれ非 indexed 展開後 500,000 以下 |
| 画像 | PNG / JPEG、各辺 4096 以下、参照画像の合計 32M pixels 以下 |
| 処理時間 | ファイル取得・解析・画像デコードを含め 15 秒 |

gzip の trailer / CRC と tar のチェックサム、長さ、終端を検査します。tar の各 entry と asset の pathname の両方で絶対パス、ドライブ、バックスラッシュ、制御文字、`.` / `..`、空 segment、末尾ドット／空白、重複と Unicode NFC・大文字小文字の衝突を拒否します。リンク、PAX/GNU 拡張、特殊 entry、終端後の別アーカイブは未対応です。OS に asset を展開しません。

各 GUID は `asset` / `asset.meta` / `pathname` を持ち、meta の GUID がディレクトリと一致する必要があります。フォルダーだけの asset は初版の対象外です。

## Unity テキストと参照

Unity YAML の document header (`--- !u!<classID> &<fileID>`) と directive を取り除き、YAML core schema でデータとして読みます。残るタグ、anchor、alias、重複キーは拒否します。

Prefab は一つの root を持つ GameObject (1) と Transform (4) のツリーを対象にします。GameObject ごとに Transform が一つ、描画する部品は MeshFilter (33) と MeshRenderer (23) が一組必要です。component / GameObject の fileID と所属を照合し、親子の相互参照、重複、欠落、循環、root から到達できないノードを拒否します。単一 Prefab 内の GameObject 階層に対応しますが、別 Prefab を埋め込む PrefabInstance、Variant、ほかのコンポーネントは未対応です。

ローカルの位置・quaternion・スケールを親から順に合成します。位置は各軸 ±1,000,000 以下、スケールは各軸の絶対値 0.001–1000、quaternion の長さの二乗は 1±0.001 が必要です。合成後の行列要素は絶対値 1e9 以下、行列式の絶対値は 1e-12 以上に制限します。負スケールには面の向きと法線の補正を行います。非アクティブな GameObject の子孫と無効な renderer は警告付きで描画から除外します。非表示部分も階層・component の構造を検査します。

各 MeshFilter の GUID で FBX を解決し、`ModelImporter.internalIDToNameTable` の class 43 / fileID が一意に示す **geometry 名** と照合します。同じ geometry 名が複数ある場合も曖昧として拒否し、名前の類似で割り当てません。MeshRenderer ごとの材質配列を FBX の materialIndex と照合し、結合時に一意な材質 GUID へ再マッピングします。同一 FBX の解析と同一材質の読み取りは再利用します。再利用する geometry の元配列はインスタンスの変換で変更しません。

材質は fileID `2100000`、画像は `2800000`、既知シェーダーは `4800000` を対象にします。参照が欠落または曖昧なら失敗します。これらの値は本プロファイルの条件であり、すべての Unity importer の subasset ID に一般化しません。

Unity エディターでの import / export round trip は未実施です。自作フィクスチャは Unity 形式に合わせて生成したものです。

## FBX と座標系

Three.js の FBXLoader を Worker 内で利用します。ASCII／バイナリ 7.4 の静的データを対象とし、配列数値・個数、構造予算、三角形を確認します。Video / Texture / Deformer / animation node を拒否し、LoadingManager でも外部 URL を拒否します。FBX 内の画像は読みません。

バイナリでは 23-byte magic、version、32-bit node offset、propertyListLen、property count、型、配列長、親子境界、NULL 終端を照合します。zlib 配列はブラウザ標準 DecompressionStream で逐次展開し、宣言長を超えた時点で中断します。実際の展開長と trailer / checksum を検証してから、非圧縮配列と再計算した offset を持つ FBX をメモリー内に構成します。FBXLoader に渡すデータには圧縮配列を残しません。元ファイルは変更しません。

64-bit node record の FBX 7.5、raw blob property（R）、1 MiB を超える文字列、安全な整数範囲外の object ID は対象外です。footer は 160–176 byte の不透明データとして保持・padding し、表示用途のローダーには内容を解釈させません。一般的な exporter 全種類への互換性や、正規化データの再エクスポートを保証する機能ではありません。

Y-up の静的 FBX を想定し、FBX world transform を焼き込みます。FBX の `UnitScaleFactor` を cm/単位として `UnitScaleFactor / 100` を掛け、Prefab の位置と同じメートルに揃えます。明示値 0.1–10000 が必要です。ModelImporter の `globalScale` は既定1、0.001–1000 に対応します。`useFileScale: 0` は未対応として拒否します。

X を反転して FBX を表示側の座標系へ変換し、Prefab の world matrix は `C × world × C`（C は X 反転）で変換して適用します。法線には inverse transpose、負の行列式には三角形の winding 補正を適用します。全インスタンスを結合後、最大辺を表示空間の 2.5 に正規化し、床の高さと中心を揃えます。物理寸法を測定するビューアではありません。異なる axis 設定、Unity importer 全体、bone の対応は未検証です。

## 限定描画

参照版は lilToon 2.3.2。既知の outline shader GUID は `efa77a80ca0344749b4f19fdd5891cbe` です。Unity の ShaderLab/HLSL は実行しません。

- `_Color` と `_MainTex`、UV scale / offset を反映します。色は sRGB から linear に変換し、出力を sRGB にします。
- `_UseShadow`（省略時 0）、`_ShadowColor`、`_ShadowBorder` を一段の Lambert 閾値に近似します。影色は基本色への乗算であり、lilToon の描画式とは異なります。
- `_OutlineColor` と `_OutlineWidth` を反映します。後ろ向き法線の膨張 hull を使い、幅は正規化後の表示空間で `clamp(width, 0, 0.15) × 0.15 × UI倍率`。Unity と同じ単位ではありません。
- 画像は ImageBitmap の `flipY` で取り込みます。MainTex の UV は FBXLoader の出力です。
- 不透明・片面描画、固定 perspective camera、単一方向ライト、トーンマッピングなし。グリッドは補助表示です。
- 未知 shader は紫の代替材質、未知プロパティ・keyword・透過は警告します。高度な影、発光、rim、normal、matcap、透過等は再現しません。

UI の基本色変更は先頭の材質スロットを変更します。変更は保存されず、元のパッケージも書き換えません。

## データの扱い

依存物はビルドに含めます。解析は Worker、画像デコードと GPU 表示はブラウザで行います。アカウント、分析 SDK、アップロード API、永続ストレージは使用しません。デモボタンのみ同梱 fixture を取得します。ローカル選択した素材を fetch URL や request body に使いません。

キャンセル・新しい選択・タイムアウトで Worker を終了し、世代 ID で古い非同期結果を無効にします。クリア時に画像、geometry、material、texture を破棄します。WebGL renderer 自体は画面の再利用に残します。

Vite 開発／preview サーバーは CSP を設定します。独自の静的配信へ移す場合は `vite.config.ts` の policy を配信側のヘッダーにも設定し、HTTPS・WebGL 2・DecompressionStream・Worker・createImageBitmap を使えるブラウザで再検証してください。サービスの公開は今回の作業に含みません。
