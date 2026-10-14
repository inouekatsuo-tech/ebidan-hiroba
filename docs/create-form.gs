/**
 * 推しトピアの改善アンケートを、Googleフォームとして自動で作るスクリプト。
 *
 * 使い方
 *  1. https://script.google.com/home/projects/create を開く
 *  2. 画面の中身を全部消して、このファイルの中身を貼り付ける
 *  3. 上の「実行」ボタン（▶）を押す。初回だけ「承認」を求められるので許可する
 *     （「このアプリは確認されていません」と出たら「詳細」→「安全ではないページに移動」）
 *  4. 下の「実行ログ」に、アンケートのURL（回答用）と編集用URLが出る
 */
function createForm() {
  var form = FormApp.create('推しトピアに足りないところ、教えてください');

  form.setDescription(
    'スタダ男子（EBiDAN）の情報をまとめている非公式ファンサイト「推しトピア」（https://ositopia.com）の改善アンケートです。\n' +
    '先にサイトを少しのぞいてから答えていただけると助かります。2分・匿名・ログイン不要です。\n' +
    'いただいた声は、このサイトの改善だけに使います。お名前やメールアドレスは集めません。\n' +
    '※スターダストプロモーション／EBiDANとは関係のない、ファンが個人でつくったサイトです。'
  );
  form.setCollectEmail(false);            // メールアドレスは集めない
  form.setLimitOneResponsePerUser(false); // ログインなしで答えられるようにする
  form.setProgressBar(true);
  form.setConfirmationMessage('ありがとうございました！いただいた声をもとに、サイトを直していきます。\nhttps://ositopia.com');

  form.addScaleItem()
    .setTitle('推しトピアを見てみて、全体の第一印象は？')
    .setBounds(1, 5).setLabels('使いづらい', '使いやすい').setRequired(true);

  form.addCheckboxItem().setTitle('どのページを見ましたか（いくつでも）')
    .setChoiceValues(['ホーム', '情報（グループ×カテゴリの一覧）', 'グループのページ', '掲示板・スレッド',
      '実況スレ', 'コミュニティ', 'イベント（オフ会）', 'マイページ・会員証', 'まだほとんど見ていない']);

  form.addCheckboxItem().setTitle('「分かりにくい」「迷った」ところはありましたか（いくつでも）')
    .setChoiceValues(['どこに何があるか分かりにくい', '文字が小さい・読みにくい', 'カテゴリの分け方がピンとこない',
      'ボタンの意味が分からなかった', '情報が多すぎる', '情報が少なすぎる', '表示が遅い・途中で止まった',
      'ログインが必要かどうか分かりにくい', '特になかった'])
    .showOtherOption(true);

  form.addCheckboxItem().setTitle('情報について。足りないと思うものはどれですか（いくつでも）')
    .setChoiceValues(['テレビ・ラジオの出演情報', '雑誌の掲載情報', 'ライブ・イベントの日程', 'チケットの先行・締切',
      'グッズの発売情報', 'YouTube・配信の更新', 'SNSで話題の投稿', 'メンバー個人の情報', '過去の出演のまとめ',
      '十分そろっている'])
    .showOtherOption(true);

  form.addMultipleChoiceItem().setTitle('掲示板について、いちばん近いものは？')
    .setChoiceValues(['書き込んでみたい', '読むだけで十分', '荒れそうで不安', '人が少なそうで書きづらい',
      '掲示板そのものに興味がない'])
    .showOtherOption(true);

  form.addCheckboxItem().setTitle('コミュニティ・オフ会について、あてはまるもの（いくつでも）')
    .setChoiceValues(['参加してみたい', '興味はあるけど不安', '知らない人と会うのは怖い', '近くに人がいなさそう',
      '年齢制限の分け方は安心できる', '年齢制限の分け方が分かりにくい', '自分でコミュニティを作ってみたい',
      '使わないと思う']);

  form.addCheckboxItem().setTitle('どんなお知らせなら受け取りたいですか（いくつでも）')
    .setChoiceValues(['推しの出演当日のお知らせ', '公式の新着情報', '実況スレが立ったとき',
      '自分の書き込みに返信がついたとき', 'コミュニティ・イベントのお知らせ', '通知はいらない']);

  form.addMultipleChoiceItem()
    .setTitle('いま、いちばん直してほしいのはどれですか（1つだけ）')
    .setHelpText('ここがいちばん知りたいところです。ひとつだけ選んでください。')
    .setChoiceValues(['情報の量をもっと増やす', '情報の正確さ・新しさ', '画面の見やすさ・デザイン', '動作の速さ',
      '掲示板のにぎやかさ', 'コミュニティ・オフ会', '通知のしくみ', '安全対策（荒らし・個人情報）',
      'スマホでの使いやすさ', '特にない'])
    .setRequired(true);

  form.addParagraphTextItem()
    .setTitle('「これがあったら毎日開く」という機能があれば教えてください')
    .setHelpText('例：推しメンだけの通知、グッズの発売カレンダー、チケット先行の締切リマインド、過去の出演まとめ など');

  form.addParagraphTextItem()
    .setTitle('使ってみて、不安に感じたことはありますか')
    .setHelpText('荒らし、個人情報、非公式であること、情報の正しさ、オフ会の安全など、何でもどうぞ');

  form.addMultipleChoiceItem().setTitle('スマホのホーム画面に追加しましたか')
    .setChoiceValues(['追加した', 'やり方が分からなかった', '必要を感じなかった', 'うまくいかなかった',
      'パソコンで見ている']);

  form.addScaleItem().setTitle('また使いたいと思いますか')
    .setBounds(1, 5).setLabels('思わない', 'また使いたい');

  form.addParagraphTextItem().setTitle('その他、ひとことご自由にどうぞ');

  form.addSectionHeaderItem().setTitle('ここから先は任意です')
    .setHelpText('答えたくない場合は、そのまま送信してください。');

  form.addCheckboxItem().setTitle('応援しているグループ（いくつでも）')
    .setChoiceValues(['超特急', 'M!LK', 'SUPER★DRAGON', 'さくらしめじ', "ONE N' ONLY", '原因は自分にある。',
      'BUDDiiS', 'ICEx', 'Lienel', 'iiONDO'])
    .showOtherOption(true);

  form.addMultipleChoiceItem().setTitle('年代')
    .setChoiceValues(['10代未満', '10代', '20代', '30代', '40代', '50代以上']);

  form.addTextItem().setTitle('続きの質問に協力してもいい方は、Xのアカウント名をどうぞ')
    .setHelpText('書かなくて大丈夫です。書いていただいた場合も、こちらから勝手にフォロー・DMはしません。');

  // 回答をスプレッドシートに貯める
  var sheet = SpreadsheetApp.create('推しトピア アンケート回答');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId());

  Logger.log('■ 回答用URL（Xに貼るのはこちら）: ' + form.getPublishedUrl());
  Logger.log('■ 編集用URL: ' + form.getEditUrl());
  Logger.log('■ 回答のスプレッドシート: ' + sheet.getUrl());
}
