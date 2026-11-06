# SpeedWatch

YaprのWebサイトの変化を、毎日のスクリーンショットと表示速度で記録します。Stage: **poc**。

Node.jsのバッチ + Playwright + PageSpeed Insights + private R2。常駐サーバー・DB・課金サービスは不要です。静的HTMLでPC/スマホ別のPerformance/LCP履歴、直近画像比較、計測一覧を表示し、日次・週間サマリー、JSON/CSVを出力します。

## ローカルで試す

Node.js 22以上。

```sh
npm ci --ignore-scripts
npm test
npm run demo
# 表示された output/demo-*/index.html を開く。明示的な架空データです。
npx playwright install chromium
npm run collect
npm run report
npm run report -- --public
```

実計測は `config/sites.json` の `https://yapr.jp/` だけ。画像と記録はgit対象外の `data/` に保存。APIキーなしではPageSpeed側の割当制限で失敗する場合があります。実計測できない値は空欄のままです。レポートは `output/private` と `output/public`。**出力先は空でなければ拒否**します。再生成には `OUTPUT_DIR=output/review-02 npm run report` のように新しい出力先を指定してください。

- `CONFIG`: 審査済みサイト設定JSONのパス（既定 `config/sites.json`）
- `DATA_DIR`: ローカルデータ保管先（既定 `data`）
- `OUTPUT_DIR`: 空のレポート出力先
- `STORAGE=r2`: R2を使用（設定は[運用手順](docs/operations.md)）

## データと公開

画像は非公開が既定です。`public: true` は数値レポートへの掲載、`screenshotsPublic: true` は画像掲載への追加承認です。初期設定ではyapr.jpの数値のみ公開候補、画像は非公開。公開版を生成してもデプロイはしません。privateレポートを公開ホストやpublicリポジトリのActions artifactへ置かないでください。

取得失敗は `status: error`、正常な0点と区別します。ラボ値（LCP/FCP/TBTはms、CLSは単位なし）と、取得できた場合だけのCrUX INPを区別します。GoogleはPSIのCrUX提供終了を予告しており、fieldはnullを許容します。Raw APIレスポンスは保存しません。

[設計と制約](docs/design.md) / [運用・費用・停止方法](docs/operations.md)

## 開発

```sh
npm test
npm run check
npm run demo
```

CIテンプレートは `docs/workflow-templates/ci.yml` にあります。現在のGitHub認証にworkflow書き込み権限がないため、CIは未設定です。CIテスト自体はネットワーク計測・秘密情報不要。実ブラウザ/R2の結合確認は別途行います。通常PRでレビューし、マージ・定期運用開始・本番公開はそれぞれ承認後に実施します。
