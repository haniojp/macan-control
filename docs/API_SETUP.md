# 初めてのAPI接続設定

この変更をマージするだけでは実車の情報は表示されません。GitHub Pagesは画面を配信する場所、RenderはPorsche IDを使って車両情報を取得する場所です。以下の設定を一度行います。

今回は個人向けの非公式ライブラリ `pyporscheconnectapi` 0.2.9を利用します。Macan Electric（2024年以降）と有効なPorsche Connect契約が対象です。公式の公開APIではなく、認証方式や地域・アカウントによって利用できないことがあります。SMSやパスキーだけを使う認証には対応を確認できていません。

## 1. GitHubの変更を公開する

1. このAPI対応のPull Requestを開きます。
2. チェックが緑になったら **Merge pull request → Confirm merge** を押します。
3. **Actions → Test and deploy Pages** が緑になるまで待ちます。

## 2. Renderにサーバーを作る

1. [Render](https://dashboard.render.com/)を開き、アカウントを作ります。GitHubでのログインを選べます。
2. Renderの **New + → Blueprint** を選びます。
3. GitHub接続を求められたら、`haniojp/macan-control` を選んで接続します。アクセス対象を選べる場合は、このリポジトリだけを選びます。
4. リポジトリの **Connect** を押します。ブランチは **main**、設定ファイルは **render.yaml** のまま進みます。
5. Blueprintの名前には `macan-control` など分かりやすい名前を入力します。
6. 入力を求められる値を次の表のとおり設定します。**パスワードを入力するのはRenderの設定画面だけです。GitHubやチャットへ書かないでください。**

| 項目 | 入力するもの |
| --- | --- |
| PORSCHE_EMAIL | My Porscheで使っているメールアドレス |
| PORSCHE_PASSWORD | My Porscheのパスワード |

7. 作成予定のサービスが `macan-control-api`、プランが **Free** であることを確認し、**Deploy Blueprint**（画面によってはApply）を押します。有料プランへの変更は不要です。料金の表示が想定と違う場合は、その時点で止めて確認してください。
8. サービスが **Live** になるまで待ちます。
9. サービス画面に表示される `https://～.onrender.com` をコピーします。これがアプリに入力する **接続先URL** です。
10. サービスの **Environment** を開きます。`BRIDGE_ACCESS_KEY` の値を表示し、コピーします。これが **接続キー** です。Porscheのパスワードとは別の、Renderが自動生成した値です。他の人には渡さないでください。

`ALLOWED_ORIGIN` は最初から `https://haniojp.github.io` に設定しています。末尾の `/` や `/macan-control/` は付けません。

## 3. iPhoneのアプリを接続する

1. Safariで [Macan Control](https://haniojp.github.io/macan-control/) を開きます。ホーム画面に追加済みなら、そのアイコンから開いてください。
2. 新しく表示される **Porsche Connect連携** を探します。見つからなければアプリとSafariのタブをいったんすべて閉じ、もう一度開きます。
3. **接続先URL** にRenderでコピーしたURLを貼り付けます。
4. **接続キー** に `BRIDGE_ACCESS_KEY` の値を貼り付けます。
5. **接続して取得** を押します。初回はRenderの起動に1分程度かかる場合があります。タイムアウトしたら、少し待って **今すぐ取得** を押します。
6. 認証画像が出た場合は画像の文字を入力し、**認証して取得** を押します。
7. バッテリー残量などが表示されたら接続完了です。**API取得日時** と **車両データ日時** を確認します。取得日時が新しくても、車両からPorsche側へ送られたデータは古い場合があります。

接続中は画面を開いている間、5分ごとに取得します。車を起こす更新や充電・施錠・空調の操作は行いません。取得できない項目は「—」で表示します。

接続キーはブラウザ内へ保存しないため、アプリの再読み込みや終了後には再入力が必要です。URLと取得済みの車両記録は端末内に保存します。整備履歴・CSV・JSONの機能はそのまま使えます。

## 表示されない場合

| 表示・症状 | 確認すること |
| --- | --- |
| 接続キーが一致しません | Render → EnvironmentのBRIDGE_ACCESS_KEYをコピーし直す |
| Porscheの認証が完了しません | PORSCHE_EMAIL/PORSCHE_PASSWORDを確認。My Porscheで追加認証が必要か確認。繰り返し試さず5分待つ |
| 画像認証の期限切れ | 「今すぐ取得」でやり直す |
| 複数の車両があります | Render → EnvironmentでPORSCHE_VINに対象車両の17桁VINを設定し、保存・再デプロイする |
| 接続できません | URLが正しいか、RenderがLiveか、ALLOWED_ORIGINが上記と完全一致しているか確認 |
| 車両データが取得できません | 契約・車両の通信状態・プライバシー設定を確認 |
| 古い値／測定時刻不明 | My Porscheでも値が更新されているか確認。アプリは不明な時刻を現在時刻として扱いません |
| 取得回数制限 | 5分以上待ってから再試行 |

Renderの無料サーバーは15分アクセスがないと停止し、次のアクセスで再起動します。認証トークンはサーバーのメモリにのみ保持するため、再起動後はPorscheへの再ログインや画像認証が必要になる場合があります。無料枠の制限は[Render公式説明](https://render.com/docs/free)で確認できます。サーバーを常時起動させるための定期アクセスは設定していません。

RenderがLiveでも、Porsche側がクラウドからのログインを拒否する場合は接続できません。エラーの文面だけを相談してください。Porscheのパスワード・接続キー・VINをチャットに貼る必要はありません。

## 停止・更新

使わなくなった場合は、アプリの **接続を解除** を押し、Render側でサービスを停止または削除します。キーが漏れた場合はRenderのBRIDGE_ACCESS_KEYを32文字以上の新しいランダム値に変更して再デプロイします。

Render側の自動デプロイは無効にしています。バックエンドの更新をマージしたら、Renderの **Manual Deploy → Deploy latest commit** で反映してください。GitHub Pages側はmainへのマージで自動更新します。

## 調査元

- [Porsche Developer Portal FAQ](https://developer.porsche.com/faq)：公式APIはパートナー向け。
- [pyporscheconnectapi](https://github.com/CJNE/pyporscheconnectapi)：対応モデル・契約条件・非公式であること。
- [Render Blueprint仕様](https://render.com/docs/blueprint-spec)：render.yaml、秘密変数、自動生成キー。
