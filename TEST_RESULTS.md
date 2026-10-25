# 接続キー保存の追加：テスト結果（2026-10-25）

デスクトップ／iPhoneサイズChromiumで既存機能を含む **32件成功**。

任意保存と再読込後の自動接続、保存オフ・接続解除・専用削除ボタンでの保存キー削除、誤った接続キーの自動保存解除、保存キーを保存時の接続先に紐付けて別のURLへ送らないこと、CSV／JSONバックアップにキーを含めないこと、全削除時のキー消去、保存失敗の通知を確認。

Porsche資格情報・OAuthトークンは引き続きサーバーだけで扱う。保存されるアプリ専用キーは同じサイトのlocalStorage内で利用可能なため、自分専用の端末で明示的に保存を選ぶ仕様。既定では保存せず、キーはソース・GitHub・配信ファイルには含めない。

画面側だけの変更で、既存Renderサーバーの更新は不要。実機Safariでの保存領域（Safari／ホーム画面アプリ）の扱いは端末での確認が必要。

---

## 以前のテスト記録

# 走行統計の追加：テスト結果（2026-10-25）

- バックエンド全体：**41件成功**。
- デスクトップ／iPhoneサイズChromiumの全体：**24件成功**。
- 最後の表示修正後、走行統計の4ブラウザテストを再実行し成功。
- JavaScript構文チェック・差分チェック成功。

追加で確認した内容：短期・長期・充電サイクルの4指標と単位、電費のkm/kWh換算、未取得と0の区別、負の消費電力量、非数値・異常値・不明時刻、単位不明値の除外、位置や識別子を返さないこと、統計取得のHTTPエラー／タイムアウトでも車両情報と5分キャッシュを維持すること、旧サーバーとの互換表示、通信失敗後も前回値と分かる表示、接続解除時の統計消去。

PPAの公開実装を参照したフィールド名と単位で模擬データを作成。SDKの実際のGET形式もMockTransportで確認。**この車両での走行統計の実取得は未確認**。Render更新後に確認が必要。今回の変更でPorsche資格情報や接続キーの再設定は不要。

更新手順・取得項目の詳細は [docs/TRIP_STATISTICS.md](docs/TRIP_STATISTICS.md)。GitHub ActionsでもWebKitを含めて検証する（WebKitオフライン1件は既存の制約でスキップ）。

---

## 以前のテスト記録

# API連携のテスト結果（2026-10-24）

新規のPorsche Connect読み取り専用サーバーと接続画面を追加。

- バックエンド：`python -m pytest backend/tests -q` **26件成功**。
- ブラウザ：Chromiumのデスクトップ・iPhoneサイズで **20件成功**（既存機能12件を含む）。
- JavaScript構文チェック・git diff --check成功。

バックエンド検証：実際にインストールしたpyporscheconnectapi 0.2.9とhttpx.MockTransportによるHTTP形式確認、必要measurementだけのGET、5分キャッシュ・同時取得の抑制、取得失敗・タイムアウト・認証失敗・回数制限、CAPTCHAのPKCE transaction再開、値欠損と充電状態、CORS・Bearer認証・no-store、VIN／位置／トークンを返さないこと。

ブラウザ検証：模擬APIからの車両表示、5分更新、API取得／測定時刻表示、キーをlocalStorage・バックアップへ書かないこと、画像認証、失敗表示、欠損値、接続解除・通信キャンセル、HTTPS以外のURL拒否、および既存の整備CRUD・CSV・JSON・オフライン。

GitHub ActionsはWebKitを含む3ブラウザ設定とバックエンドテストを実行する。WebKitでのオフラインテストはPlaywrightの制約によりスキップ。

**実車のPorscheアカウントによる認証・取得、Renderへの設置、iPhone実機での取得は未検証。** Renderのアカウント作成とPorsche IDの秘密変数設定は利用者が行う必要がある。非公式APIのため、認証方式・地域・契約・クラウドIPによる制限で接続できない場合がある。設置手順はdocs/API_SETUP.md。

---

## 前回のPWA対応のテスト記録



実施日：2026-10-24（日本時間）

## ローカル実行

`CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm test -- --project=chromium --project=mobile-chromium`

**12件成功、失敗0件**（6シナリオ × 2環境）。iPhone 13相当の画面・タッチ設定を適用したChromiumと、デスクトップChromiumを使用。GitHub Pagesと同じ `/macan-control/` 配下で実行。

| 検証 | 結果 |
| --- | --- |
| 車両手入力、表示、再読込後の保存、CSV、JSONバックアップ・復元 | 成功 |
| ワイパー整備登録、再読込、編集、CSV、JSON復元、同ID更新、削除、全削除時の編集解除 | 成功 |
| 不正な数値JSONの一括取込拒否、保存容量不足の通知、既存記録保持 | 成功 |
| 横はみ出しなし、非表示ボタン、manifest・アイコン取得、実行時例外なし | 成功 |
| サブパスでサービスワーカー登録、オフライン再読込、記録表示 | 成功 |
| randomUUID未対応時のID生成、不正日付拒否、編集／削除キャンセル | 成功 |

`node --check app.js`、`node --check sw.js`、`git diff --check` も成功。

## GitHub Actionsでの結果

[実行結果](https://github.com/haniojp/macan-control/actions/runs/40078311751)：**17件成功、失敗0件、1件スキップ**。iPhoneサイズWebKit・iPhoneサイズChromium・デスクトップChromiumで確認。スキップはWebKitのオフラインテストのみ。デプロイジョブはPR上では実行しない設定のためスキップ。

## WebKit / 実機の範囲

この環境ではWebKitの配布ドメインがネットワークポリシーで403（Domain forbidden）となり、ローカルWebKitテストは実行できなかった。GitHub Actionsで同じシナリオをiPhoneサイズのWebKitでも実行する設定を追加済み。WebKitではPlaywrightのサービスワーカー制御に制限があるためオフラインテスト1件を明示的にスキップする。

実機iPhone Safari、共有メニューによるホーム画面追加、ホーム画面からの起動、Safari／「ファイル」アプリでのダウンロード保存は未検証。公開後に実機で確認する。自動テストのエミュレーションは実機検証の代替ではない。

## 公開

Pagesワークフローを追加。mainへのマージとSettings → Pages → Source「GitHub Actions」の設定後に公開できる。今回の作業ではmainへのマージと本番公開は行わない。
